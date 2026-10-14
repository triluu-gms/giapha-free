import { z } from 'zod';
import type { Locale } from '../auth/cookies';
import { query } from '../db';
import { exportCsv, exportFileStem, exportJson, loadTreeExport } from './exportTree';
import { open, seal } from './secretBox';
import { DriveAccessLost, openDrive, revokeDriveToken } from './userDrive';

// Scheduled backups of a tree to the Google Drive of one of its admins.
//
// (:User {driveRefreshToken (sealed), driveEmail, driveConnectedAt})
//   the user's Drive connection, shared by every tree they back up.
// (:Tree {backupFrequency, backupKeep, backupUserId, backupLocale, backupFolderId, backupFolderUrl,
//         backupLastRunAt, backupLastStatus, backupLastError})
//   the tree's schedule: which admin's Drive, how often, and how the last run went.
//   Stored on the tree, so deleting the tree removes it too.
//
// Due backups run from the daily cron job; admins can also run one at any time.

export const backupFrequencies = ['manual', 'daily', 'weekly', 'monthly'] as const;
export type BackupFrequency = (typeof backupFrequencies)[number];

export const backupUpdateSchema = z.object({
  /** 'off' removes the schedule; 'manual' keeps it for "Back up now" only. */
  frequency: z.enum(['off', ...backupFrequencies]),
  /** How many backups to keep in the folder; older ones are deleted. */
  keep: z.number().int().min(1).max(100).optional(),
});

export const DEFAULT_KEEP = 10;

/** Why the last run failed, for the UI's error.<code> messages. */
export type BackupError = 'driveNotConnected' | 'driveAccessLost' | 'backupNotManager' | 'backupFailed';

export interface BackupStatus {
  frequency: BackupFrequency | 'off';
  keep: number;
  /** The admin whose Drive receives the backups. */
  owner: { id: string; name: string | null; driveEmail: string | null } | null;
  folderUrl: string | null;
  lastRunAt: string | null;
  lastStatus: 'ok' | 'error' | null;
  lastError: BackupError | null;
  /** When the daily job will next run it (null for manual or off). */
  nextRunAt: string | null;
}

// ---------- Drive connections ----------

export interface DriveConnection {
  email: string | null;
  connectedAt: string;
}

export async function getDriveConnection(userId: string): Promise<DriveConnection | null> {
  const [row] = await query<{ connection: DriveConnection | null }>(
    `MATCH (u:User {id: $userId})
     RETURN CASE WHEN u.driveRefreshToken IS NULL THEN null
                 ELSE {email: u.driveEmail, connectedAt: u.driveConnectedAt} END AS connection`,
    { userId },
  );
  return row?.connection ?? null;
}

/** Stores a new connection, revoking the one it replaces. */
export async function saveDriveConnection(userId: string, refreshToken: string, email: string | null): Promise<void> {
  const [row] = await query<{ previous: string | null }>(
    `MATCH (u:User {id: $userId})
     WITH u, u.driveRefreshToken AS previous
     SET u.driveRefreshToken = $sealed, u.driveEmail = $email, u.driveConnectedAt = $now
     RETURN previous`,
    { userId, sealed: seal(refreshToken), email, now: new Date().toISOString() },
    'WRITE',
  );
  const previous = row?.previous ? open(row.previous) : null;
  if (previous) await revokeDriveToken(previous);
}

/** Forgets and revokes the connection. Schedules using it fail until someone reconnects. */
export async function removeDriveConnection(userId: string): Promise<void> {
  const [row] = await query<{ token: string | null }>(
    `MATCH (u:User {id: $userId})
     WITH u, u.driveRefreshToken AS token
     REMOVE u.driveRefreshToken, u.driveEmail, u.driveConnectedAt
     RETURN token`,
    { userId },
    'WRITE',
  );
  const token = row?.token ? open(row.token) : null;
  if (token) await revokeDriveToken(token);
}

// ---------- Schedules ----------

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const INTERVAL_MS: Record<Exclude<BackupFrequency, 'manual'>, number> = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: MONTH_MS,
};
/** The daily job's minute varies within the hour, so a run counts as due a little early. */
const SLACK_MS = 2 * 60 * 60 * 1000;

function nextRunAt(frequency: BackupStatus['frequency'], lastRunAt: string | null): string | null {
  if (frequency === 'off' || frequency === 'manual') return null;
  if (!lastRunAt) return new Date().toISOString();
  return new Date(Date.parse(lastRunAt) + INTERVAL_MS[frequency]).toISOString();
}

export function isDue(frequency: BackupStatus['frequency'], lastRunAt: string | null, now: Date): boolean {
  if (frequency === 'off' || frequency === 'manual') return false;
  if (!lastRunAt) return true;
  const next = nextRunAt(frequency, lastRunAt);
  return next !== null && Date.parse(next) - SLACK_MS <= now.getTime();
}

const STATUS_CYPHER = `{
  frequency: coalesce(t.backupFrequency, 'off'),
  keep: coalesce(t.backupKeep, ${DEFAULT_KEEP}),
  owner: CASE WHEN o IS NULL THEN null ELSE {id: o.id, name: o.name, driveEmail: o.driveEmail} END,
  folderUrl: t.backupFolderUrl,
  lastRunAt: t.backupLastRunAt,
  lastStatus: t.backupLastStatus,
  lastError: t.backupLastError
}`;

export async function getBackupStatus(treeId: string): Promise<BackupStatus> {
  const [row] = await query<{ status: Omit<BackupStatus, 'nextRunAt'> }>(
    `MATCH (t:Tree {id: $treeId})
     OPTIONAL MATCH (o:User {id: t.backupUserId})
     RETURN ${STATUS_CYPHER} AS status`,
    { treeId },
  );
  const status = row.status;
  return { ...status, nextRunAt: nextRunAt(status.frequency, status.lastRunAt) };
}

/**
 * Saves the schedule. Backups go to the Drive of the admin who saves it. A
 * different admin than before starts a new folder (the old one stays in the
 * previous admin's Drive).
 */
export async function updateBackupSchedule(
  treeId: string,
  userId: string,
  changes: z.infer<typeof backupUpdateSchema>,
  locale: Locale,
): Promise<BackupStatus> {
  if (changes.frequency === 'off') {
    await query(
      `MATCH (t:Tree {id: $treeId})
       REMOVE t.backupFrequency, t.backupKeep, t.backupUserId, t.backupLocale, t.backupFolderId, t.backupFolderUrl,
              t.backupLastRunAt, t.backupLastStatus, t.backupLastError`,
      { treeId },
      'WRITE',
    );
  } else {
    await query(
      `MATCH (t:Tree {id: $treeId})
       FOREACH (_ IN CASE WHEN coalesce(t.backupUserId, '') <> $userId THEN [1] ELSE [] END |
         REMOVE t.backupFolderId, t.backupFolderUrl, t.backupLastRunAt, t.backupLastStatus, t.backupLastError)
       SET t.backupFrequency = $frequency, t.backupKeep = $keep, t.backupUserId = $userId, t.backupLocale = $locale`,
      { treeId, userId, frequency: changes.frequency, keep: changes.keep ?? DEFAULT_KEEP, locale },
      'WRITE',
    );
  }
  return getBackupStatus(treeId);
}

// ---------- Running ----------

interface RunContext {
  treeName: string;
  frequency: BackupStatus['frequency'];
  keep: number;
  locale: Locale;
  folderId: string | null;
  sealedToken: string | null;
  isManager: boolean;
}

async function recordRun(treeId: string, result: { error: BackupError | null; folder?: { id: string; url: string } }) {
  await query(
    `MATCH (t:Tree {id: $treeId})
     SET t.backupLastRunAt = $now, t.backupLastStatus = $status, t.backupLastError = $error,
         t.backupFolderId = coalesce($folderId, t.backupFolderId), t.backupFolderUrl = coalesce($folderUrl, t.backupFolderUrl)`,
    {
      treeId,
      now: new Date().toISOString(),
      status: result.error ? 'error' : 'ok',
      error: result.error,
      folderId: result.folder?.id ?? null,
      folderUrl: result.folder?.url ?? null,
    },
    'WRITE',
  );
}

const folderName = (locale: Locale, treeName: string) =>
  locale === 'vi' ? `Sao lưu gia phả – ${treeName}` : `Family tree backups – ${treeName}`;

/**
 * Backs the tree up now: a CSV (the import template) and a JSON file, uploaded to
 * the schedule owner's Drive. Older backups beyond `keep` are deleted. The owner
 * must still be the tree's owner or an admin.
 */
export async function runBackup(treeId: string): Promise<BackupStatus> {
  const [ctx] = await query<RunContext>(
    `MATCH (t:Tree {id: $treeId})
     OPTIONAL MATCH (o:User {id: t.backupUserId})-[m:MEMBER_OF]->(t)
     RETURN t.name AS treeName, coalesce(t.backupFrequency, 'off') AS frequency,
            coalesce(t.backupKeep, ${DEFAULT_KEEP}) AS keep, coalesce(t.backupLocale, 'vi') AS locale,
            t.backupFolderId AS folderId, o.driveRefreshToken AS sealedToken,
            coalesce(m.role IN ['owner', 'admin'], false) AS isManager`,
    { treeId },
  );
  if (!ctx || ctx.frequency === 'off') return getBackupStatus(treeId);

  let error: BackupError | null = null;
  let folder: { id: string; url: string } | undefined;
  const token = ctx.sealedToken ? open(ctx.sealedToken) : null;
  if (!ctx.isManager) error = 'backupNotManager';
  else if (!ctx.sealedToken) error = 'driveNotConnected';
  else if (!token) error = 'driveAccessLost';
  else {
    try {
      const drive = await openDrive(token);
      folder = await drive.ensureFolder(ctx.folderId, folderName(ctx.locale, ctx.treeName));
      const at = new Date();
      const data = await loadTreeExport(treeId);
      const stem = exportFileStem(ctx.treeName, at);
      await drive.upload(folder.id, `${stem}.csv`, 'text/csv', exportCsv(data, ctx.locale), treeId);
      await drive.upload(folder.id, `${stem}.json`, 'application/json', exportJson(data, at.toISOString()), treeId);

      // Keep the newest `keep` backups of each kind.
      const files = await drive.listBackups(folder.id);
      const old = ['.csv', '.json'].flatMap((ext) => files.filter((f) => f.name.endsWith(ext)).slice(ctx.keep));
      for (const file of old) await drive.remove(file.id);
    } catch (err) {
      error = err instanceof DriveAccessLost ? 'driveAccessLost' : 'backupFailed';
      console.error(`Backup of tree ${treeId} failed:`, err);
    }
  }
  await recordRun(treeId, { error, folder });
  return getBackupStatus(treeId);
}

/**
 * Runs every scheduled backup that is due, one after another, until the time
 * budget is used up (the rest run on the next day's job). Called by the daily cron.
 */
export async function runDueBackups(now = new Date(), budgetMs = 40_000): Promise<{ ran: number; failed: number; postponed: number }> {
  const trees = await query<{ id: string; frequency: BackupStatus['frequency']; lastRunAt: string | null }>(
    `MATCH (t:Tree) WHERE t.backupFrequency IN ['daily', 'weekly', 'monthly']
     RETURN t.id AS id, t.backupFrequency AS frequency, t.backupLastRunAt AS lastRunAt
     ORDER BY t.backupLastRunAt`,
  );
  const due = trees.filter((t) => isDue(t.frequency, t.lastRunAt, now));
  const started = Date.now();
  let ran = 0;
  let failed = 0;
  for (const tree of due) {
    if (Date.now() - started > budgetMs) break;
    const status = await runBackup(tree.id);
    ran++;
    if (status.lastStatus === 'error') failed++;
  }
  return { ran, failed, postponed: due.length - ran };
}

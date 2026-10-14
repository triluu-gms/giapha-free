import neo4j from 'neo4j-driver';
import { z } from 'zod';
import type { Locale } from '../auth/cookies';
import { createLinkToken, hashLinkToken } from '../auth/secureTokens';
import type { AuthUser } from '../auth/users';
import { open, seal } from '../backups/secretBox';
import { config } from '../config';
import { query } from '../db';
import { sendEmail } from '../email/mailer';
import { accessDecisionEmail, accessRequestEmail, type AccessRequestItem } from '../email/templates';
import { HttpError } from '../errors';
import type { EditScope } from '../schemas';

// "Request access" links: a URL the owner or an admin shares anywhere (Zalo,
// Facebook, a family group). Opening it never grants anything by itself: a
// signed-in visitor asks for access, the tree's owner and admins are notified,
// and one of them approves (choosing the role) or declines.
//
// (:Tree {accessLinkHash, accessLinkToken (sealed, so admins can copy it again),
//         accessLinkCreatedBy, accessLinkCreatedAt, accessLinkExpiresAt?, accessRequestsNotifiedAt?})
//   one link per tree; a new one replaces it.
// (:User)-[:REQUESTS_ACCESS {message?, locale, createdAt}]->(:Tree)
//   one pending request per person and tree. Deleting the tree or the account removes it.

export const accessLinkSchema = z.object({
  /** null: until it is turned off. */
  expiresInDays: z.union([z.literal(7), z.literal(30), z.null()]),
});

export const accessRequestSchema = z.object({
  token: z.string().min(1).max(200),
  message: z.string().trim().max(500).optional(),
});

/** A person can wait on at most this many trees at once. */
const MAX_PENDING_PER_USER = 10;
/** And a tree collects at most this many pending requests (a leaked link can't flood it). */
const MAX_PENDING_PER_TREE = 200;
/** Owners and admins get at most one email per tree in this window, listing every pending request. */
const NOTIFY_EVERY_MS = 60 * 60 * 1000;
/** People named in that email; the rest are counted. */
const NOTIFY_LIST = 10;

const DAY_MS = 24 * 60 * 60 * 1000;
const now = () => new Date().toISOString();
const joinUrl = (token: string) => `${config.auth.publicAppUrl}/join/${encodeURIComponent(token)}`;

export interface AccessLink {
  /** Null if it can no longer be shown (JWT_SECRET changed): make a new one. */
  url: string | null;
  createdAt: string;
  createdByName: string | null;
  expiresAt: string | null;
  expired: boolean;
}

export async function getAccessLink(treeId: string): Promise<AccessLink | null> {
  const [row] = await query<{ link: (Omit<AccessLink, 'url'> & { sealed: string }) | null }>(
    `MATCH (t:Tree {id: $treeId})
     OPTIONAL MATCH (by:User {id: t.accessLinkCreatedBy})
     RETURN CASE WHEN t.accessLinkHash IS NULL THEN null ELSE {
       sealed: t.accessLinkToken, createdAt: t.accessLinkCreatedAt, createdByName: coalesce(by.name, by.email),
       expiresAt: t.accessLinkExpiresAt, expired: coalesce(t.accessLinkExpiresAt <= $now, false)
     } END AS link`,
    { treeId, now: now() },
  );
  const link = row?.link;
  if (!link) return null;
  const { sealed, ...rest } = link;
  const token = open(sealed, 'access-link');
  return { ...rest, url: token ? joinUrl(token) : null };
}

/** Makes a new link for the tree; the previous one stops working. */
export async function createAccessLink(treeId: string, userId: string, expiresInDays: 7 | 30 | null): Promise<AccessLink> {
  const { token, hash } = createLinkToken();
  await query(
    `MATCH (t:Tree {id: $treeId})
     SET t.accessLinkHash = $hash, t.accessLinkToken = $sealed, t.accessLinkCreatedBy = $userId,
         t.accessLinkCreatedAt = $now, t.accessLinkExpiresAt = $expiresAt`,
    {
      treeId,
      userId,
      hash,
      sealed: seal(token, 'access-link'),
      now: now(),
      expiresAt: expiresInDays ? new Date(Date.now() + expiresInDays * DAY_MS).toISOString() : null,
    },
    'WRITE',
  );
  return (await getAccessLink(treeId))!;
}

/** Turns the link off. Requests already made stay, for the owner and admins to answer. */
export async function revokeAccessLink(treeId: string): Promise<void> {
  await query(
    `MATCH (t:Tree {id: $treeId})
     REMOVE t.accessLinkHash, t.accessLinkToken, t.accessLinkCreatedBy, t.accessLinkCreatedAt, t.accessLinkExpiresAt`,
    { treeId },
    'WRITE',
  );
}

export type AccessStatus = 'member' | 'pending' | 'none';

export interface JoinPreview {
  treeId: string;
  treeName: string;
  sharedBy: string | null;
  expired: boolean;
}

/** What the /join page shows: the tree's name and who shared it, nothing else. */
export async function previewAccessLink(token: string): Promise<JoinPreview | null> {
  const [row] = await query<JoinPreview>(
    `MATCH (t:Tree {accessLinkHash: $hash})
     OPTIONAL MATCH (by:User {id: t.accessLinkCreatedBy})
     RETURN t.id AS treeId, t.name AS treeName, coalesce(by.name, by.email) AS sharedBy,
            coalesce(t.accessLinkExpiresAt <= $now, false) AS expired`,
    { hash: hashLinkToken(token), now: now() },
  );
  return row ?? null;
}

export async function accessStatus(treeId: string, userId: string): Promise<AccessStatus> {
  const [row] = await query<{ status: AccessStatus }>(
    `MATCH (u:User {id: $userId}), (t:Tree {id: $treeId})
     RETURN CASE WHEN EXISTS { (u)-[:MEMBER_OF]->(t) } THEN 'member'
                 WHEN EXISTS { (u)-[:REQUESTS_ACCESS]->(t) } THEN 'pending'
                 ELSE 'none' END AS status`,
    { userId, treeId },
  );
  return row?.status ?? 'none';
}

/**
 * Asks for access through a link. Members are told so; a repeated request keeps
 * the first one (with the newer message). Notifies the owner and admins.
 */
export async function requestAccess(
  token: string,
  user: AuthUser,
  message: string | undefined,
  locale: Locale,
): Promise<{ status: AccessStatus; treeId: string }> {
  const link = await previewAccessLink(token);
  if (!link) throw new HttpError(404, 'This link is no longer valid. Ask for a new one.', 'accessLinkInvalid');
  if (link.expired) throw new HttpError(410, 'This link has expired. Ask for a new one.', 'accessLinkExpired');

  const [row] = await query<{ status: AccessStatus | 'userLimit' | 'treeLimit' }>(
    `MATCH (u:User {id: $userId}), (t:Tree {id: $treeId})
     WITH u, t,
          EXISTS { (u)-[:MEMBER_OF]->(t) } AS member,
          EXISTS { (u)-[:REQUESTS_ACCESS]->(t) } AS pending,
          COUNT { (u)-[:REQUESTS_ACCESS]->(:Tree) } AS mine,
          COUNT { (:User)-[:REQUESTS_ACCESS]->(t) } AS waiting
     OPTIONAL CALL (u, t, member, pending, mine, waiting) {
       WITH * WHERE NOT member AND (pending OR (mine < $maxUser AND waiting < $maxTree))
       MERGE (u)-[r:REQUESTS_ACCESS]->(t)
       ON CREATE SET r.createdAt = $now
       SET r.message = $message, r.locale = $locale
       RETURN true AS saved
     }
     RETURN CASE WHEN member THEN 'member'
                 WHEN saved IS NOT NULL THEN 'pending'
                 WHEN mine >= $maxUser THEN 'userLimit'
                 ELSE 'treeLimit' END AS status`,
    {
      userId: user.id,
      treeId: link.treeId,
      message: message || null,
      locale,
      now: now(),
      maxUser: MAX_PENDING_PER_USER,
      maxTree: MAX_PENDING_PER_TREE,
    },
    'WRITE',
  );
  if (row?.status === 'userLimit') {
    throw new HttpError(429, `You can wait on at most ${MAX_PENDING_PER_USER} trees at once.`, 'accessRequestLimit');
  }
  if (row?.status === 'treeLimit') {
    throw new HttpError(429, 'This tree has too many pending requests. Try again later.', 'accessRequestsFull');
  }
  const status = (row?.status ?? 'none') as AccessStatus;
  if (status === 'pending') {
    // The request is saved and shows on Share; a failed heads-up email must not undo that for the visitor.
    try {
      await notifyManagers(link.treeId, locale);
    } catch (err) {
      console.error('Failed to notify the tree managers of an access request:', err);
    }
  }
  return { status, treeId: link.treeId };
}

/** The requester withdraws their own pending request. */
export async function cancelAccessRequest(treeId: string, userId: string): Promise<void> {
  await query(
    'MATCH (:User {id: $userId})-[r:REQUESTS_ACCESS]->(:Tree {id: $treeId}) DELETE r',
    { userId, treeId },
    'WRITE',
  );
}

export interface AccessRequest {
  userId: string;
  name: string | null;
  email: string | null;
  message: string | null;
  createdAt: string;
}

export async function listAccessRequests(treeId: string): Promise<AccessRequest[]> {
  const rows = await query<{ request: AccessRequest }>(
    `MATCH (u:User)-[r:REQUESTS_ACCESS]->(:Tree {id: $treeId})
     RETURN {userId: u.id, name: u.name, email: u.email, message: r.message, createdAt: r.createdAt} AS request
     ORDER BY r.createdAt`,
    { treeId },
  );
  return rows.map((r) => r.request);
}

/**
 * Emails the owner and admins about the pending requests, at most once an hour
 * per tree (claimed atomically, so concurrent requests send one email).
 */
async function notifyManagers(treeId: string, fallbackLocale: Locale): Promise<void> {
  const [row] = await query<{
    treeName: string;
    total: number;
    requests: AccessRequestItem[];
    managers: { email: string; locale: Locale | null }[];
  }>(
    `MATCH (t:Tree {id: $treeId})
     WHERE coalesce(t.accessRequestsNotifiedAt, '') < $cutoff
     SET t.accessRequestsNotifiedAt = $now
     RETURN t.name AS treeName,
            COUNT { (:User)-[:REQUESTS_ACCESS]->(t) } AS total,
            COLLECT {
              MATCH (u:User)-[r:REQUESTS_ACCESS]->(t)
              RETURN {name: coalesce(u.name, u.email, '?'), email: u.email, message: r.message}
              ORDER BY r.createdAt DESC LIMIT $list
            } AS requests,
            COLLECT {
              MATCH (m:User)-[mm:MEMBER_OF]->(t)
              WHERE mm.role IN ['owner', 'admin'] AND m.email IS NOT NULL
              RETURN {email: m.email, locale: m.locale}
            } AS managers`,
    // LIMIT needs a Cypher integer; plain JS numbers are sent as floats (10.0).
    { treeId, now: now(), cutoff: new Date(Date.now() - NOTIFY_EVERY_MS).toISOString(), list: neo4j.int(NOTIFY_LIST) },
    'WRITE',
  );
  if (!row) return;
  const shareUrl = `${config.auth.publicAppUrl}/share`;
  for (const manager of row.managers) {
    try {
      await sendEmail(
        accessRequestEmail(manager.email, manager.locale ?? fallbackLocale, row.treeName, row.requests, row.total, shareUrl),
      );
    } catch (err) {
      // The request is saved and shows on Share; the email is only a heads-up.
      console.error('Failed to send access request email:', err);
    }
  }
}

async function tellRequester(to: { email: string | null; locale: Locale }, treeName: string, decision: Parameters<typeof accessDecisionEmail>[3]) {
  if (!to.email) return;
  try {
    await sendEmail(accessDecisionEmail(to.email, to.locale, treeName, decision, config.auth.publicAppUrl));
  } catch (err) {
    console.error('Failed to send access decision email:', err);
  }
}

/**
 * Approves a request with the given role (the caller's right to grant it is
 * checked by the route). Like accepting an invitation, the wider of the existing
 * and the new access is kept. Returns false if there is no such request.
 */
export async function approveAccessRequest(
  treeId: string,
  userId: string,
  role: 'admin' | 'editor' | 'viewer',
  scope: EditScope | null,
  fallbackLocale: Locale,
): Promise<boolean> {
  const branch = role === 'editor' ? scope : null;
  const [row] = await query<{ email: string | null; locale: Locale | null; treeName: string; role: 'admin' | 'editor' | 'viewer' }>(
    `MATCH (u:User {id: $userId})-[r:REQUESTS_ACCESS]->(t:Tree {id: $treeId})
     WITH u, t, r, r.locale AS requestLocale
     MERGE (u)-[m:MEMBER_OF]->(t)
     ON CREATE SET m.since = $now
     WITH u, t, r, requestLocale, m, coalesce(m.role, '') AS oldRole, m.scopeRootId AS oldRoot, m.scopeDepth AS oldDepth
     WITH u, t, r, requestLocale, m, oldRoot, oldDepth,
          CASE
            WHEN oldRole = 'owner' THEN 'owner'
            WHEN oldRole = 'admin' OR $role = 'admin' THEN 'admin'
            WHEN oldRole = 'editor' OR $role = 'editor' THEN 'editor'
            ELSE 'viewer'
          END AS role,
          (oldRole = 'editor' AND oldRoot IS NULL) OR ($role = 'editor' AND $scopeRootId IS NULL) AS wholeTree
     WITH u, t, r, requestLocale, m, role,
          CASE WHEN role <> 'editor' OR wholeTree THEN null
               WHEN $role = 'editor' THEN [$scopeRootId, $scopeDepth]
               ELSE [oldRoot, oldDepth] END AS branch
     SET m.role = role, m.scopeRootId = branch[0], m.scopeDepth = branch[1]
     DELETE r
     RETURN u.email AS email, coalesce(u.locale, requestLocale) AS locale, t.name AS treeName, role`,
    { treeId, userId, role, scopeRootId: branch?.rootId ?? null, scopeDepth: branch?.depth ?? null, now: now() },
    'WRITE',
  );
  if (!row) return false;
  await tellRequester(
    { email: row.email, locale: row.locale ?? fallbackLocale },
    row.treeName,
    row.role === 'admin' || row.role === 'editor' ? row.role : 'viewer',
  );
  return true;
}

/** Declines (deletes) a request and tells the requester. Returns false if there is no such request. */
export async function declineAccessRequest(treeId: string, userId: string, fallbackLocale: Locale): Promise<boolean> {
  const [row] = await query<{ email: string | null; locale: Locale | null; treeName: string }>(
    `MATCH (u:User {id: $userId})-[r:REQUESTS_ACCESS]->(t:Tree {id: $treeId})
     WITH u, t, r, coalesce(u.locale, r.locale) AS locale
     DELETE r
     RETURN u.email AS email, locale, t.name AS treeName`,
    { treeId, userId },
    'WRITE',
  );
  if (!row) return false;
  await tellRequester({ email: row.email, locale: row.locale ?? fallbackLocale }, row.treeName, 'declined');
  return true;
}

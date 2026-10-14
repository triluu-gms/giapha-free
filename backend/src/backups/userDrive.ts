import { randomUUID } from 'node:crypto';
import { config } from '../config';

// A tree admin's own Google Drive, reached through the REST API (no SDK) with the
// `drive.file` scope: the app can only see and change files and folders it
// created itself, never anything else in the user's Drive.

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

export const DRIVE_SCOPES = 'openid email https://www.googleapis.com/auth/drive.file';

/** Marks the files backups create, so pruning never touches anything else. */
export const BACKUP_PROPERTY = 'familyTreeBackup';

/** The refresh token no longer works (revoked by the user, or expired): they need to reconnect. */
export class DriveAccessLost extends Error {}

export const driveCallbackUrl = () => `${config.auth.publicAppUrl}/api/drive/callback`;

/** Drive backups use the Google sign-in OAuth client. */
export function driveConfigured(): boolean {
  return Boolean(config.oauth.google.clientId && config.oauth.google.clientSecret);
}

function client() {
  const { clientId, clientSecret } = config.oauth.google;
  if (!clientId || !clientSecret) throw new Error('Google Drive backups need GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET');
  return { clientId, clientSecret };
}

async function fail(action: string, res: Response): Promise<never> {
  const detail = (await res.text().catch(() => '')).slice(0, 300);
  throw new Error(`Google Drive ${action} failed (${res.status}): ${detail}`);
}

export function driveAuthorizationUrl(state: string, codeChallenge: string): string {
  return `${AUTH_URL}?${new URLSearchParams({
    client_id: client().clientId,
    redirect_uri: driveCallbackUrl(),
    response_type: 'code',
    scope: DRIVE_SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    // A refresh token is only issued with offline access and the consent screen.
    access_type: 'offline',
    prompt: 'consent',
  })}`;
}

/** Exchanges the callback's code for a refresh token and the Google account's email. */
export async function exchangeDriveCode(code: string, codeVerifier: string): Promise<{ refreshToken: string; email: string | null }> {
  const { clientId, clientSecret } = client();
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: driveCallbackUrl(),
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    }),
  });
  if (!res.ok) await fail('sign-in', res);
  const token = (await res.json()) as { access_token: string; refresh_token?: string; scope?: string };
  if (!token.refresh_token) throw new Error('Google did not return a refresh token');
  // The user can untick Drive on Google's consent screen.
  if (!token.scope?.split(' ').includes('https://www.googleapis.com/auth/drive.file')) {
    await revokeDriveToken(token.refresh_token);
    throw new DriveAccessLost('Google Drive access was not granted');
  }
  const info = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${token.access_token}` } });
  const email = info.ok ? ((await info.json()) as { email?: string }).email ?? null : null;
  return { refreshToken: token.refresh_token, email };
}

export async function revokeDriveToken(refreshToken: string): Promise<void> {
  await fetch(`${REVOKE_URL}?${new URLSearchParams({ token: refreshToken })}`, { method: 'POST' }).catch(() => undefined);
}

/** A Drive session for one run: an access token from the stored refresh token. */
export async function openDrive(refreshToken: string) {
  const { clientId, clientSecret } = client();
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret }),
  });
  if (res.status === 400 || res.status === 401) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (body.error === 'invalid_grant') throw new DriveAccessLost('Google Drive access was revoked or has expired');
  }
  if (!res.ok) await fail('sign-in', res);
  const { access_token: accessToken } = (await res.json()) as { access_token: string };

  const driveFetch = (url: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${accessToken}`);
    return fetch(url, { ...init, headers });
  };
  const fileUrl = (id: string) => `${FILES_URL}/${encodeURIComponent(id)}`;

  return {
    /** The folder if it still exists (not trashed), else a new one with this name. */
    async ensureFolder(folderId: string | null, name: string): Promise<{ id: string; url: string }> {
      if (folderId) {
        const res = await driveFetch(`${fileUrl(folderId)}?fields=id,trashed,webViewLink`);
        if (res.ok) {
          const folder = (await res.json()) as { id: string; trashed?: boolean; webViewLink: string };
          if (!folder.trashed) return { id: folder.id, url: folder.webViewLink };
        } else if (res.status !== 404) await fail('folder lookup', res);
      }
      const res = await driveFetch(`${FILES_URL}?fields=id,webViewLink`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, mimeType: FOLDER_MIME }),
      });
      if (!res.ok) await fail('folder creation', res);
      const folder = (await res.json()) as { id: string; webViewLink: string };
      return { id: folder.id, url: folder.webViewLink };
    },

    async upload(folderId: string, name: string, contentType: string, body: Buffer, treeId: string): Promise<{ id: string; url: string }> {
      const boundary = `ft-${randomUUID()}`;
      const metadata = JSON.stringify({
        name,
        parents: [folderId],
        mimeType: contentType,
        appProperties: { [BACKUP_PROPERTY]: '1', treeId },
      });
      const payload = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
            `--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`,
        ),
        body,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      const res = await driveFetch(`${UPLOAD_URL}?uploadType=multipart&fields=id,webViewLink`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body: new Uint8Array(payload),
      });
      if (!res.ok) await fail('upload', res);
      const file = (await res.json()) as { id: string; webViewLink: string };
      return { id: file.id, url: file.webViewLink };
    },

    /** Backup files in the folder, newest first. */
    async listBackups(folderId: string): Promise<{ id: string; name: string }[]> {
      const q = `'${folderId.replace(/['\\]/g, '')}' in parents and trashed = false and appProperties has { key='${BACKUP_PROPERTY}' and value='1' }`;
      const res = await driveFetch(`${FILES_URL}?${new URLSearchParams({ q, orderBy: 'createdTime desc', pageSize: '1000', fields: 'files(id,name)' })}`);
      if (!res.ok) await fail('listing', res);
      return ((await res.json()) as { files: { id: string; name: string }[] }).files;
    },

    async remove(id: string): Promise<void> {
      const res = await driveFetch(fileUrl(id), { method: 'DELETE' });
      if (!res.ok && res.status !== 404) await fail('delete', res);
    },
  };
}

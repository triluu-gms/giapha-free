import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { config } from '../config';
import type { FileStorage } from './index';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

function parseServiceAccount(value: string): ServiceAccount {
  const text = value.trim().startsWith('{') ? value : Buffer.from(value, 'base64').toString('utf8');
  let parsed: Partial<ServiceAccount>;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('GDRIVE_SERVICE_ACCOUNT_JSON must be the JSON key file, or that JSON in base64');
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error('GDRIVE_SERVICE_ACCOUNT_JSON is missing client_email or private_key');
  }
  return { client_email: parsed.client_email, private_key: parsed.private_key };
}

/**
 * Google Drive through its REST API (no SDK). Files go into GDRIVE_FOLDER_ID and
 * stay private to the Drive account; the API streams them to tree members.
 *
 * Auth is either a service account, whose folder must be on a shared drive
 * (service accounts have no storage quota of their own), or a user's refresh token.
 */
export function createGoogleDriveStorage(drive: typeof config.photos.gdrive): FileStorage {
  const { folderId, serviceAccountJson, clientId, clientSecret, refreshToken } = drive;
  if (!folderId) throw new Error('PHOTO_STORAGE=gdrive needs GDRIVE_FOLDER_ID');
  const account = serviceAccountJson ? parseServiceAccount(serviceAccountJson) : null;
  if (!account && !(refreshToken && clientId && clientSecret)) {
    throw new Error(
      'PHOTO_STORAGE=gdrive needs GDRIVE_SERVICE_ACCOUNT_JSON, or GDRIVE_REFRESH_TOKEN with an OAuth client ID and secret',
    );
  }

  // Access tokens last an hour; reuse one across warm invocations.
  let cached: { token: string; expiresAt: number } | null = null;

  async function accessToken(): Promise<string> {
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    const body = account
      ? new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion: jwt.sign({ scope: DRIVE_SCOPE }, account.private_key, {
            algorithm: 'RS256',
            issuer: account.client_email,
            audience: TOKEN_URL,
            expiresIn: '1h',
          }),
        })
      : new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: clientId,
          client_secret: clientSecret,
        });
    const res = await fetch(TOKEN_URL, { method: 'POST', body });
    if (!res.ok) await fail('sign-in', res);
    const data = (await res.json()) as { access_token: string; expires_in: number };
    cached = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
    return cached.token;
  }

  async function driveFetch(url: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${await accessToken()}`);
    return fetch(url, { ...init, headers });
  }

  async function fail(action: string, res: Response): Promise<never> {
    const detail = (await res.text().catch(() => '')).slice(0, 500);
    throw new Error(`Google Drive ${action} failed (${res.status}): ${detail}`);
  }

  // Ids come from Drive itself, but keep them out of URL syntax anyway.
  const fileUrl = (id: string) => `${FILES_URL}/${encodeURIComponent(id)}`;

  return {
    name: 'gdrive',

    async put(name, body, contentType) {
      // multipart/related: the JSON metadata, then the file bytes.
      const boundary = `ft-${randomUUID()}`;
      const metadata = JSON.stringify({ name, parents: [folderId], mimeType: contentType });
      const payload = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
            `--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`,
        ),
        body,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      const res = await driveFetch(`${UPLOAD_URL}?uploadType=multipart&supportsAllDrives=true&fields=id`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body: new Uint8Array(payload),
      });
      if (!res.ok) await fail('upload', res);
      return ((await res.json()) as { id: string }).id;
    },

    async get(id) {
      const res = await driveFetch(`${fileUrl(id)}?alt=media&supportsAllDrives=true`);
      if (res.status === 404) return null;
      if (!res.ok) await fail('download', res);
      return {
        body: Buffer.from(await res.arrayBuffer()),
        contentType: res.headers.get('content-type') ?? 'application/octet-stream',
      };
    },

    async remove(id) {
      const res = await driveFetch(`${fileUrl(id)}?supportsAllDrives=true`, { method: 'DELETE' });
      if (!res.ok && res.status !== 404) await fail('delete', res);
    },
  };
}

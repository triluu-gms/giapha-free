import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { config } from '../config';

// Google Drive refresh tokens let the server act on a user's Drive, so they are
// stored encrypted (AES-256-GCM). The key is derived from JWT_SECRET: changing
// JWT_SECRET makes stored tokens unreadable, and admins then reconnect Drive.

const VERSION = 'v1';

function key(): Buffer {
  const secret = config.auth.jwtSecret;
  if (secret.length < 32) throw new Error('JWT_SECRET must be set to a random string of at least 32 characters');
  return Buffer.from(hkdfSync('sha256', secret, 'family-tree', 'drive-refresh-token', 32));
}

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), data].map((p) => (typeof p === 'string' ? p : p.toString('base64url'))).join('.');
}

/** The plain text, or null if it can't be decrypted (e.g. JWT_SECRET changed). */
export function open(sealed: string): string | null {
  const [version, iv, tag, data] = sealed.split('.');
  if (version !== VERSION || !iv || !tag || !data) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

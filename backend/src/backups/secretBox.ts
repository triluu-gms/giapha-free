import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { config } from '../config';

// Secrets kept so they can be used or shown again later are stored encrypted
// (AES-256-GCM): Google Drive refresh tokens, which let the server act on a
// user's Drive, and "request access" link tokens, which admins copy again.
// The key is derived from JWT_SECRET and the purpose: changing JWT_SECRET makes
// them unreadable (admins then reconnect Drive, or make a new link).

const VERSION = 'v1';

export type SecretPurpose = 'drive-refresh-token' | 'access-link';

function key(purpose: SecretPurpose): Buffer {
  const secret = config.auth.jwtSecret;
  if (secret.length < 32) throw new Error('JWT_SECRET must be set to a random string of at least 32 characters');
  return Buffer.from(hkdfSync('sha256', secret, 'family-tree', purpose, 32));
}

export function seal(plain: string, purpose: SecretPurpose = 'drive-refresh-token'): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(purpose), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), data].map((p) => (typeof p === 'string' ? p : p.toString('base64url'))).join('.');
}

/** The plain text, or null if it can't be decrypted (e.g. JWT_SECRET changed). */
export function open(sealed: string, purpose: SecretPurpose = 'drive-refresh-token'): string | null {
  const [version, iv, tag, data] = sealed.split('.');
  if (version !== VERSION || !iv || !tag || !data) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(purpose), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

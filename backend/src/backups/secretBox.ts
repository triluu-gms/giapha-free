import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { config } from '../config';

// Secrets kept so they can be used or shown again later are stored encrypted
// (AES-256-GCM): Google Drive refresh tokens, which let the server act on a
// user's Drive, the Gmail sender's refresh token, "request access" link tokens, which
// admins copy again, the OAuth state cookie and the
// session cookie.
// The key is derived from JWT_SECRET and the purpose: changing JWT_SECRET makes
// them unreadable (admins then reconnect Drive, or make a new link).

const VERSION = 'v1';

export type SecretPurpose = 'drive-refresh-token' | 'access-link' | 'gmail-refresh-token' | 'oauth-state' | 'session-cookie';

function key(purpose: SecretPurpose): Buffer {
  const secret = config.auth.jwtSecret;
  if (secret.length < 32) throw new Error('JWT_SECRET must be set to a random string of at least 32 characters');
  return Buffer.from(hkdfSync('sha256', secret, 'family-tree', purpose, 32));
}

const IV_BYTES = 12;
const TAG_BYTES = 16;

export function seal(plain: string, purpose: SecretPurpose = 'drive-refresh-token'): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key(purpose), iv, { authTagLength: TAG_BYTES });
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), data].map((p) => (typeof p === 'string' ? p : p.toString('base64url'))).join('.');
}

/** The plain text, or null if it can't be decrypted (e.g. JWT_SECRET changed). */
export function open(sealed: string, purpose: SecretPurpose = 'drive-refresh-token'): string | null {
  const [version, iv, tag, data] = sealed.split('.');
  if (version !== VERSION || !iv || !tag || !data) return null;
  const ivBytes = Buffer.from(iv, 'base64url');
  const tagBytes = Buffer.from(tag, 'base64url');
  // Exactly the 16-byte tag seal() writes: GCM would also accept a shortened tag, which
  // makes forging a value (e.g. a cookie the browser sends back) far easier.
  if (ivBytes.length !== IV_BYTES || tagBytes.length !== TAG_BYTES) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(purpose), ivBytes, { authTagLength: TAG_BYTES });
    decipher.setAuthTag(tagBytes);
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

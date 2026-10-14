import { createHash, randomBytes } from 'node:crypto';

/**
 * Single-use tokens for email links. Only the SHA-256 hash is stored, so a
 * database leak does not expose usable links.
 */
export function createLinkToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashLinkToken(token) };
}

export const hashLinkToken = (token: string) => createHash('sha256').update(token).digest('hex');

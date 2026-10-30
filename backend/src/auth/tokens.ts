import { createHash, createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { open, seal } from '../backups/secretBox';
import { config } from '../config';

const ISSUER = 'family-tree-api';
const ACCESS_AUDIENCE = 'family-tree-web';
const STATE_AUDIENCE = 'family-tree-oauth-state';

function secret(): string {
  const value = config.auth.jwtSecret;
  if (value.length < 32) {
    throw new Error('JWT_SECRET must be set to a random string of at least 32 characters');
  }
  return value;
}

export function signAccessToken(userId: string): string {
  return jwt.sign({}, secret(), {
    algorithm: 'HS256',
    subject: userId,
    issuer: ISSUER,
    audience: ACCESS_AUDIENCE,
    expiresIn: config.auth.jwtExpiresIn as jwt.SignOptions['expiresIn'],
  });
}

/**
 * Returns the user id and when the token was issued (ms since epoch, at
 * one-second precision). Throws jwt.JsonWebTokenError (incl. TokenExpiredError) on a bad token.
 */
export function verifyAccessToken(token: string): { userId: string; issuedAt: number } {
  const key = secret();
  const payload = jwt.verify(token, key, {
    algorithms: ['HS256'],
    issuer: ISSUER,
    audience: ACCESS_AUDIENCE,
  }) as jwt.JwtPayload;
  if (!payload.sub) throw new jwt.JsonWebTokenError('Token has no subject');
  return { userId: payload.sub, issuedAt: (payload.iat ?? 0) * 1000 };
}

/** Short-lived state kept in a cookie between the login redirect and the OAuth callback. */
export interface OAuthState {
  provider: string;
  state: string;
  /** Same-site path to return to after login. */
  next: string;
  /**
   * Connecting Drive or the Gmail sender: a tag of the account that started it (see
   * flowOwnerTag), not the account id itself. The callback links the connection only to
   * that account, not to whoever is signed in on the browser by then.
   */
  owner?: string;
}

const flowOwnerKey = () => Buffer.from(hkdfSync('sha256', secret(), 'family-tree', 'oauth-flow-owner', 32));

/**
 * A tag that identifies the account that started an OAuth flow, for its state cookie:
 * an HMAC of the account id with a server-only key. The cookie then holds nothing that
 * names an account, and nobody without the key can make a tag for another one.
 */
export function flowOwnerTag(accountId: string): string {
  return createHmac('sha256', flowOwnerKey()).update(accountId).digest('base64url');
}

/** Whether the signed-in account is the one that started the flow (constant-time comparison). */
export function isFlowOwner(saved: OAuthState, accountId: string): boolean {
  if (!saved.owner) return false;
  const expected = Buffer.from(flowOwnerTag(accountId));
  const given = Buffer.from(saved.owner);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * The PKCE code verifier of an OAuth flow, derived from its random `state` with a
 * server-only key (HMAC-SHA256), instead of being stored in the state cookie. The
 * callback derives it again from the state; nobody without the server's key can, so it
 * stays secret, and the browser never holds it at all. 43 characters of base64url: a
 * valid verifier (RFC 7636 asks for 43-128).
 */
export function pkceVerifier(state: string): string {
  const key = Buffer.from(hkdfSync('sha256', secret(), 'family-tree', 'pkce-verifier', 32));
  return createHmac('sha256', key).update(state).digest('base64url');
}

/** The S256 code challenge sent to the provider for a verifier. */
export const pkceChallenge = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');

/**
 * The state cookie's value, encrypted (AES-256-GCM), not just signed, so nothing in it
 * (the state, where to return, which account started a Drive/Gmail connection) can be
 * read from the browser's cookie store. GCM also authenticates it, so a tampered or
 * forged value doesn't open. The PKCE verifier isn't in it at all (see pkceVerifier).
 */
export function sealOAuthState(data: OAuthState): string {
  return seal(JSON.stringify({ ...data, aud: STATE_AUDIENCE, exp: Date.now() + STATE_TTL_MS }), 'oauth-state');
}

/** The state, or null if the cookie was tampered with, made with another key, or expired. */
export function openOAuthState(sealed: string): OAuthState | null {
  const plain = open(sealed, 'oauth-state');
  if (!plain) return null;
  try {
    const { aud, exp, ...state } = JSON.parse(plain) as OAuthState & { aud?: string; exp?: number };
    if (aud !== STATE_AUDIENCE || typeof exp !== 'number' || exp < Date.now()) return null;
    return state;
  } catch {
    return null;
  }
}

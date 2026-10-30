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
  codeVerifier?: string;
}

const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * The state cookie's value, encrypted (AES-256-GCM), not just signed: it carries the
 * PKCE code verifier, a secret that must not be readable from the browser's cookie
 * store. GCM also authenticates it, so a tampered or forged value doesn't open.
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

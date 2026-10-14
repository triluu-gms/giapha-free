import jwt from 'jsonwebtoken';
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

export function signOAuthState(data: OAuthState): string {
  return jwt.sign(data, secret(), {
    algorithm: 'HS256',
    issuer: ISSUER,
    audience: STATE_AUDIENCE,
    expiresIn: '10m',
  });
}

export function verifyOAuthState(token: string): OAuthState | null {
  try {
    return jwt.verify(token, secret(), {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: STATE_AUDIENCE,
    }) as OAuthState;
  } catch (err) {
    if (err instanceof jwt.JsonWebTokenError) return null;
    throw err;
  }
}

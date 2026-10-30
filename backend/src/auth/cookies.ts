import type { CookieOptions, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { open, seal } from '../backups/secretBox';
import { config } from '../config';

export const SESSION_COOKIE = 'ft_session';
export const OAUTH_STATE_COOKIE = 'ft_oauth_state';

export function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

export type Locale = 'en' | 'vi';

/**
 * The UI language: the frontend's `lang` cookie (sent along through the same-site
 * /api proxy), else the browser's first language. Used for text the API creates,
 * such as a new account's default tree name.
 */
export function requestLocale(req: Request): Locale {
  const saved = readCookie(req, 'lang');
  if (saved === 'en' || saved === 'vi') return saved;
  return (req.get('accept-language') ?? '').trim().toLowerCase().startsWith('vi') ? 'vi' : 'en';
}

/**
 * Cookies are Secure whenever the site is served over HTTPS (PUBLIC_APP_URL), not only
 * when this request looks secure: behind a proxy that doesn't pass on the protocol,
 * req.secure would be false and the cookie could later travel over plain HTTP.
 */
export const secureCookie = (req: Request) => req.secure || config.auth.publicAppUrl.startsWith('https://');

// HttpOnly keeps the token away from page scripts; SameSite=Lax stops other
// sites from sending it on cross-site POST/PATCH/DELETE requests.
const sessionOptions = (req: Request): CookieOptions => ({
  httpOnly: true,
  secure: secureCookie(req),
  sameSite: 'lax',
  path: '/',
});

/**
 * Stores the session token in its cookie, encrypted (AES-256-GCM) rather than as the
 * bare signed JWT: the cookie sits in the browser's cookie store, and a JWT can be read
 * by anyone who sees it (base64), even though it can't be changed.
 */
export function setSessionCookie(req: Request, res: Response, token: string) {
  const { exp } = jwt.decode(token) as jwt.JwtPayload;
  res.cookie(SESSION_COOKIE, seal(token, 'session-cookie'), {
    ...sessionOptions(req),
    maxAge: exp ? exp * 1000 - Date.now() : undefined,
  });
}

/**
 * The session token from the cookie, or null if there is none or it doesn't decrypt.
 * `legacy` is set for a cookie made before cookies were encrypted (a plain JWT): it is
 * accepted once and the caller writes it back encrypted, so nobody is signed out.
 */
export function readSessionToken(req: Request): { token: string; legacy: boolean } | null {
  const value = readCookie(req, SESSION_COOKIE);
  if (!value) return null;
  if (value.startsWith('v1.')) {
    const token = open(value, 'session-cookie');
    return token ? { token, legacy: false } : null;
  }
  return /^[\w-]+\.[\w-]+\.[\w-]+$/.test(value) ? { token: value, legacy: true } : null;
}

export function clearSessionCookie(req: Request, res: Response) {
  res.clearCookie(SESSION_COOKIE, sessionOptions(req));
}

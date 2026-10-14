import type { CookieOptions, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

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

// HttpOnly keeps the token away from page scripts; SameSite=Lax stops other
// sites from sending it on cross-site POST/PATCH/DELETE requests.
const sessionOptions = (req: Request): CookieOptions => ({
  httpOnly: true,
  secure: req.secure,
  sameSite: 'lax',
  path: '/',
});

export function setSessionCookie(req: Request, res: Response, token: string) {
  const { exp } = jwt.decode(token) as jwt.JwtPayload;
  res.cookie(SESSION_COOKIE, token, {
    ...sessionOptions(req),
    maxAge: exp ? exp * 1000 - Date.now() : undefined,
  });
}

export function clearSessionCookie(req: Request, res: Response) {
  res.clearCookie(SESSION_COOKIE, sessionOptions(req));
}

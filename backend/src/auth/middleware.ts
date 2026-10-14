import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { HttpError } from '../errors';
import { clearSessionCookie, readCookie, SESSION_COOKIE } from './cookies';
import { verifyAccessToken } from './tokens';
import { findSessionUser } from './users';

/** Verifies the session cookie and loads the user, so role changes apply immediately. */
export const requireAuth: RequestHandler = async (req, res, next) => {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) throw new HttpError(401, 'Authentication required');

  let session: { userId: string; issuedAt: number };
  try {
    session = verifyAccessToken(token);
  } catch (err) {
    if (err instanceof jwt.JsonWebTokenError) {
      clearSessionCookie(req, res);
      throw new HttpError(401, 'Invalid or expired session');
    }
    throw err;
  }

  const found = await findSessionUser(session.userId);
  if (!found) {
    clearSessionCookie(req, res);
    throw new HttpError(401, 'Account no longer exists');
  }
  // Changing or resetting the password signs out every session issued before it.
  if (found.passwordChangedAt && session.issuedAt < Date.parse(found.passwordChangedAt)) {
    clearSessionCookie(req, res);
    throw new HttpError(401, 'Your password was changed. Please sign in again.');
  }
  req.user = found.user;
  next();
};

/** Email+password accounts must confirm their address before using trees or invitations. */
export const requireVerifiedEmail: RequestHandler = (req, _res, next) => {
  if (!req.user) throw new HttpError(401, 'Authentication required');
  if (req.user.verificationRequired) {
    throw new HttpError(403, 'Please verify your email address first. Check your inbox for the link.');
  }
  next();
};

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence in depth on top of SameSite=Lax: state-changing requests must
 * carry a custom header. Browsers only let other sites send custom headers
 * after a CORS preflight, which this API never approves.
 */
export const requireCsrfHeader: RequestHandler = (req, _res, next) => {
  if (!SAFE_METHODS.has(req.method) && req.get('x-requested-with') !== 'fetch') {
    throw new HttpError(403, 'Missing X-Requested-With header');
  }
  next();
};

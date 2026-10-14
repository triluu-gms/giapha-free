import type { Request, RequestHandler, Response } from 'express';
import jwt from 'jsonwebtoken';
import { HttpError } from '../errors';
import { findSessionUserWithTree, type TreeAccess } from '../trees/trees';
import { clearSessionCookie, readCookie, SESSION_COOKIE } from './cookies';
import { verifyAccessToken } from './tokens';
import { findSessionUser, type AuthUser } from './users';

/**
 * Verifies the session cookie and loads the user, so changes (password, consent,
 * deletion) apply immediately. With a treeId, the caller's access to that tree is
 * loaded in the same database round trip and left for loadTree.
 */
async function authenticate(req: Request, res: Response, treeId?: string): Promise<void> {
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

  const found: { user: AuthUser; passwordChangedAt: string | null; tree?: TreeAccess | null } | null = treeId
    ? await findSessionUserWithTree(session.userId, treeId)
    : await findSessionUser(session.userId);
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
  if (treeId) req.prefetchedTree = { id: treeId, access: found.tree ?? null };
}

export const requireAuth: RequestHandler = async (req, res, next) => {
  await authenticate(req, res);
  next();
};

/**
 * requireAuth for the /api/trees router: for /api/trees/:treeId/... it also loads
 * the caller's membership of that tree in the same query (used by loadTree).
 */
export const requireAuthForTrees: RequestHandler = async (req, res, next) => {
  const treeId = req.path.split('/')[1];
  await authenticate(req, res, treeId ? decodeURIComponent(treeId) : undefined);
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

/** Trees and invitations hold personal data: the user must have accepted the current agreement. */
export const requirePrivacyConsent: RequestHandler = (req, _res, next) => {
  if (!req.user) throw new HttpError(401, 'Authentication required');
  if (req.user.consentRequired) {
    throw new HttpError(403, 'Please read and accept the personal data agreement first.', 'consentRequired');
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

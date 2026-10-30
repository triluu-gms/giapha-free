import { randomBytes } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { OAUTH_STATE_COOKIE, secureCookie } from '../auth/cookies';
import { requireAuth, requirePrivacyConsent, requireVerifiedEmail } from '../auth/middleware';
import { flowOwnerTag, isFlowOwner, pkceChallenge, pkceVerifier, sealOAuthState, type OAuthState } from '../auth/tokens';
import { getDriveConnection, removeDriveConnection, saveDriveConnection } from '../backups/backups';
import { driveAuthorizationUrl, DriveAccessLost, driveConfigured, exchangeDriveCode } from '../backups/userDrive';
import { HttpError } from '../errors';

// Connecting a user's own Google Drive, for tree backups (see backups/backups.ts).
// Mounted at /api/drive.
//
// Google returns to the Google sign-in callback (/api/auth/google/callback), which
// is already an authorized redirect URI of the OAuth client, so Drive needs no
// extra URI. The state cookie says `provider: 'google-drive'`, and that callback
// hands the request to finishDriveConnect below.

export const driveRouter = Router();

driveRouter.use(requireAuth, requirePrivacyConsent, requireVerifiedEmail);

/** The state cookie's provider for a Drive connection (sign-in uses 'google'). */
export const DRIVE_STATE_PROVIDER = 'google-drive';
// The same path as sign-in's state cookie, so the shared callback receives it.
const STATE_COOKIE_PATH = '/api/auth';

/** Only same-site paths, so a crafted link can't redirect users elsewhere. */
function safeNextPath(value: unknown): string {
  const path = typeof value === 'string' ? value : '';
  return path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\') ? path : '/settings';
}

const withParam = (path: string, key: string, value: string) =>
  `${path}${path.includes('?') ? '&' : '?'}${key}=${encodeURIComponent(value)}`;

// GET /api/drive -> { configured, connection: { email, connectedAt } | null }
driveRouter.get('/', async (req, res) => {
  res.json({ configured: driveConfigured(), connection: await getDriveConnection(req.user!.id) });
});

// GET /api/drive/connect?next=/settings -> Google's consent screen (a full-page navigation)
driveRouter.get('/connect', (req, res) => {
  if (!driveConfigured()) throw new HttpError(503, 'Google Drive is not configured on this server');
  const state = randomBytes(16).toString('base64url');
  res.cookie(
    OAUTH_STATE_COOKIE,
    sealOAuthState({
      provider: DRIVE_STATE_PROVIDER,
      state,
      next: safeNextPath(req.query.next),
      owner: flowOwnerTag(req.user!.id),
    }),
    { httpOnly: true, secure: secureCookie(req), sameSite: 'lax', maxAge: 10 * 60 * 1000, path: STATE_COOKIE_PATH },
  );
  // PKCE: the verifier is derived from the state on the server, so the cookie doesn't carry it.
  res.redirect(driveAuthorizationUrl(state, pkceChallenge(pkceVerifier(state))));
});

/**
 * The end of a Drive connection, called from /api/auth/google/callback when its
 * state cookie (already read and cleared there) is a Drive one. Goes back to
 * `next` with ?drive=connected, or ?drive=<what went wrong>.
 */
export async function finishDriveConnect(req: Request, res: Response, saved: OAuthState): Promise<void> {
  const next = safeNextPath(saved.next);
  const back = (result: string) => res.redirect(withParam(next, 'drive', result));

  if (typeof req.query.error === 'string') {
    back(req.query.error === 'access_denied' ? 'cancelled' : 'failed');
    return;
  }
  if (typeof req.query.code !== 'string' || req.query.state !== saved.state) {
    back('failed');
    return;
  }
  // The same checks as the /api/drive routes: signed in, agreement accepted, email verified.
  try {
    await requireAuth(req, res, () => undefined);
  } catch {
    res.redirect(`/login?next=${encodeURIComponent(next)}`);
    return;
  }
  // Only the account that started connecting (another may have signed in on this browser since).
  if (!req.user || !isFlowOwner(saved, req.user.id) || req.user.consentRequired || req.user.verificationRequired) {
    back('failed');
    return;
  }
  try {
    const { refreshToken, email } = await exchangeDriveCode(req.query.code, pkceVerifier(saved.state));
    await saveDriveConnection(req.user.id, refreshToken, email);
    back('connected');
  } catch (err) {
    console.error('Google Drive connection failed:', err);
    back(err instanceof DriveAccessLost ? 'noAccess' : 'failed');
  }
}

// DELETE /api/drive -> disconnects (and revokes) the user's Drive
driveRouter.delete('/', async (req, res) => {
  await removeDriveConnection(req.user!.id);
  res.status(204).end();
});

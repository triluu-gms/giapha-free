import { createHash, randomBytes } from 'node:crypto';
import { Router } from 'express';
import { OAUTH_STATE_COOKIE, readCookie } from '../auth/cookies';
import { requireAuth, requirePrivacyConsent, requireVerifiedEmail } from '../auth/middleware';
import { signOAuthState, verifyOAuthState } from '../auth/tokens';
import { getDriveConnection, removeDriveConnection, saveDriveConnection } from '../backups/backups';
import { driveAuthorizationUrl, DriveAccessLost, driveConfigured, exchangeDriveCode } from '../backups/userDrive';
import { HttpError } from '../errors';

// Connecting a user's own Google Drive, for tree backups (see backups/backups.ts).
// Mounted at /api/drive. The OAuth callback is <PUBLIC_APP_URL>/api/drive/callback,
// which must be an authorized redirect URI of the Google OAuth client.

export const driveRouter = Router();

driveRouter.use(requireAuth, requirePrivacyConsent, requireVerifiedEmail);

const STATE_COOKIE_PATH = '/api/drive';
const PROVIDER = 'google-drive';

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
  const codeVerifier = randomBytes(32).toString('base64url');
  res.cookie(
    OAUTH_STATE_COOKIE,
    signOAuthState({ provider: PROVIDER, state, next: safeNextPath(req.query.next), codeVerifier }),
    { httpOnly: true, secure: req.secure, sameSite: 'lax', maxAge: 10 * 60 * 1000, path: STATE_COOKIE_PATH },
  );
  res.redirect(driveAuthorizationUrl(state, createHash('sha256').update(codeVerifier).digest('base64url')));
});

// GET /api/drive/callback?code=...&state=... -> back to `next` with ?drive=connected or ?drive=<error>
driveRouter.get('/callback', async (req, res) => {
  const raw = readCookie(req, OAUTH_STATE_COOKIE);
  const saved = raw ? verifyOAuthState(raw) : null;
  res.clearCookie(OAUTH_STATE_COOKIE, { path: STATE_COOKIE_PATH });
  const next = safeNextPath(saved?.next);

  if (!saved || saved.provider !== PROVIDER || !saved.codeVerifier) {
    res.redirect(withParam(next, 'drive', 'expired'));
    return;
  }
  if (typeof req.query.error === 'string') {
    res.redirect(withParam(next, 'drive', req.query.error === 'access_denied' ? 'cancelled' : 'failed'));
    return;
  }
  if (typeof req.query.code !== 'string' || req.query.state !== saved.state) {
    res.redirect(withParam(next, 'drive', 'failed'));
    return;
  }
  try {
    const { refreshToken, email } = await exchangeDriveCode(req.query.code, saved.codeVerifier);
    await saveDriveConnection(req.user!.id, refreshToken, email);
    res.redirect(withParam(next, 'drive', 'connected'));
  } catch (err) {
    console.error('Google Drive connection failed:', err);
    res.redirect(withParam(next, 'drive', err instanceof DriveAccessLost ? 'noAccess' : 'failed'));
  }
});

// DELETE /api/drive -> disconnects (and revokes) the user's Drive
driveRouter.delete('/', async (req, res) => {
  await removeDriveConnection(req.user!.id);
  res.status(204).end();
});

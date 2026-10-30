import { randomBytes } from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { OAUTH_STATE_COOKIE, secureCookie } from '../auth/cookies';
import { requireAuth, requirePrivacyConsent, requireVerifiedEmail } from '../auth/middleware';
import { pkceChallenge, pkceVerifier, sealOAuthState, type OAuthState } from '../auth/tokens';
import type { AuthUser } from '../auth/users';
import { config } from '../config';
import {
  exchangeGmailCode,
  getGmailConnection,
  GmailAccessLost,
  gmailAuthorizationUrl,
  gmailConfigured,
  removeGmailConnection,
  saveGmailConnection,
} from '../email/gmail';
import { HttpError } from '../errors';

// Connecting the Gmail account the app sends its emails from (EMAIL_PROVIDER=gmail).
// Mounted at /api/admin/email, for the verified accounts listed in ADMIN_EMAILS only.
//
// Like Drive connections, Google returns to the Google sign-in callback
// (/api/auth/google/callback), so no extra redirect URI is needed. The state
// cookie says `provider: 'google-gmail'`, and that callback hands the request to
// finishGmailConnect below.

export const adminEmailRouter = Router();

/** The state cookie's provider for a Gmail connection (sign-in uses 'google'). */
export const GMAIL_STATE_PROVIDER = 'google-gmail';
// The same path as sign-in's state cookie, so the shared callback receives it.
const STATE_COOKIE_PATH = '/api/auth';
const BACK_PATH = '/account';

export const isAdmin = (user: AuthUser | undefined) =>
  Boolean(user?.email && user.emailVerified && config.adminEmails.includes(user.email.toLowerCase()));

function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!isAdmin(req.user)) throw new HttpError(403, 'Only admins can change this', 'notAdmin');
  next();
}

adminEmailRouter.use(requireAuth, requirePrivacyConsent, requireVerifiedEmail, requireAdmin);

async function settings() {
  const gmail = await getGmailConnection();
  return {
    provider: config.email.provider,
    providers: {
      // Without an API key, Resend's emails are only printed to the server console.
      resend: { configured: Boolean(config.email.resendApiKey), from: config.email.from },
      gmail: { configured: gmailConfigured(), requiredSender: config.email.gmail.sender || null, connection: gmail },
    },
  };
}

// GET /api/admin/email -> { provider (EMAIL_PROVIDER), providers: { resend, gmail } }
adminEmailRouter.get('/', async (_req, res) => {
  res.json(await settings());
});

// GET /api/admin/email/gmail/connect -> Google's consent screen (a full-page navigation)
adminEmailRouter.get('/gmail/connect', (req, res) => {
  if (!gmailConfigured()) throw new HttpError(503, 'Sending with Gmail is not configured on this server');
  const state = randomBytes(16).toString('base64url');
  res.cookie(
    OAUTH_STATE_COOKIE,
    sealOAuthState({ provider: GMAIL_STATE_PROVIDER, state, next: BACK_PATH, userId: req.user!.id }),
    { httpOnly: true, secure: secureCookie(req), sameSite: 'lax', maxAge: 10 * 60 * 1000, path: STATE_COOKIE_PATH },
  );
  // PKCE: the verifier is derived from the state on the server, so the cookie doesn't carry it.
  res.redirect(gmailAuthorizationUrl(state, pkceChallenge(pkceVerifier(state))));
});

/**
 * The end of a Gmail connection, called from /api/auth/google/callback when its
 * state cookie (already read and cleared there) is a Gmail one. Goes back to
 * /account with ?gmail=connected, or ?gmail=<what went wrong>.
 */
export async function finishGmailConnect(req: Request, res: Response, saved: OAuthState): Promise<void> {
  const back = (result: string) => res.redirect(`${BACK_PATH}?gmail=${encodeURIComponent(result)}`);

  if (typeof req.query.error === 'string') {
    back(req.query.error === 'access_denied' ? 'cancelled' : 'failed');
    return;
  }
  if (typeof req.query.code !== 'string' || req.query.state !== saved.state) {
    back('failed');
    return;
  }
  // The same checks as the /api/admin/email routes.
  try {
    await requireAuth(req, res, () => undefined);
  } catch {
    res.redirect(`/login?next=${encodeURIComponent(BACK_PATH)}`);
    return;
  }
  if (
    !gmailConfigured() ||
    !req.user ||
    req.user.id !== saved.userId || // only the admin who started connecting
    req.user.consentRequired ||
    req.user.verificationRequired ||
    !isAdmin(req.user)
  ) {
    back('failed');
    return;
  }
  try {
    const { refreshToken, email } = await exchangeGmailCode(req.query.code, pkceVerifier(saved.state));
    await saveGmailConnection(refreshToken, email);
    back('connected');
  } catch (err) {
    console.error('Gmail connection failed:', err);
    back(err instanceof GmailAccessLost ? 'noAccess' : 'failed');
  }
}

// DELETE /api/admin/email/gmail -> disconnects (and revokes) the Gmail account, unless it is in use
adminEmailRouter.delete('/gmail', async (_req, res) => {
  if (config.email.gmail.refreshToken) throw new HttpError(409, 'The Gmail account is set by GMAIL_REFRESH_TOKEN');
  if (config.email.provider === 'gmail') {
    throw new HttpError(409, 'Emails are sent with Gmail (EMAIL_PROVIDER=gmail). Change it first.', 'gmailInUse');
  }
  await removeGmailConnection();
  res.json(await settings());
});

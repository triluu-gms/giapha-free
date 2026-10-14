import { createHash, randomBytes } from 'node:crypto';
import { Router } from 'express';
import { clearSessionCookie, OAUTH_STATE_COOKIE, readCookie, requestLocale, setSessionCookie } from '../auth/cookies';
import { requireAuth } from '../auth/middleware';
import { getDummyHash, hashPassword, verifyPassword } from '../auth/passwords';
import { getProvider, getProviders } from '../auth/providers';
import { assertLoginAllowed, clearLoginFailures, recordLoginFailure } from '../auth/rateLimit';
import { signAccessToken, signOAuthState, verifyOAuthState } from '../auth/tokens';
import {
  cancelEmailChange,
  changePassword,
  confirmEmailChange,
  createPasswordUser,
  deleteUser,
  findPasswordCredentials,
  findUserById,
  requestEmailChange,
  type AuthUser,
  issuePasswordResetToken,
  issueVerificationToken,
  lastVerificationSentAt,
  recordLogin,
  resetPasswordWithToken,
  updateUserName,
  upsertOAuthUser,
  verifyEmailToken,
} from '../auth/users';
import { config } from '../config';
import { sendEmail } from '../email/mailer';
import { emailChangeEmail, emailChangeNoticeEmail, passwordResetEmail, verificationEmail } from '../email/templates';
import { HttpError, notFound } from '../errors';
import {
  changePasswordSchema,
  deleteAccountSchema,
  emailChangeSchema,
  forgotPasswordSchema,
  passwordLoginSchema,
  profileUpdateSchema,
  registerSchema,
  reminderPreferencesSchema,
  resetPasswordSchema,
  tokenSchema,
} from '../schemas';
import { getReminderPreferences, updateReminderPreferences } from '../reminders/preferences';
import { acceptInvitation, findInvitationByToken } from '../trees/invitations';

export const authRouter = Router();

const STATE_COOKIE_PATH = '/api/auth';
const RESEND_COOLDOWN_MS = 60 * 1000;

// Browsers reach the API through the frontend's /api rewrite, so callbacks
// must use the frontend's public URL for the cookies to be first-party.
const callbackUrl = (providerId: string) => `${config.auth.publicAppUrl}/api/auth/${providerId}/callback`;

/** Only same-site paths, so a crafted login link can't redirect users elsewhere. */
function safeNextPath(value: unknown): string {
  const path = typeof value === 'string' ? value : '';
  return path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\') ? path : '/';
}

// GET /api/auth/providers -> [{ id, name }] for the login page
authRouter.get('/providers', (_req, res) => {
  res.json(getProviders().map(({ id, name }) => ({ id, name })));
});

// GET /api/auth/:provider/login?next=/people
// Login and registration are the same flow: unknown users are registered.
authRouter.get('/:provider/login', (req, res) => {
  const provider = getProvider(req.params.provider);
  if (!provider) throw notFound('Login provider');

  const state = randomBytes(16).toString('base64url');
  const codeVerifier = provider.usesPkce ? randomBytes(32).toString('base64url') : undefined;
  const codeChallenge = codeVerifier && createHash('sha256').update(codeVerifier).digest('base64url');

  res.cookie(
    OAUTH_STATE_COOKIE,
    signOAuthState({ provider: provider.id, state, next: safeNextPath(req.query.next), codeVerifier }),
    { httpOnly: true, secure: req.secure, sameSite: 'lax', maxAge: 10 * 60 * 1000, path: STATE_COOKIE_PATH },
  );
  res.redirect(provider.authorizationUrl({ state, redirectUri: callbackUrl(provider.id), codeChallenge }));
});

// GET /api/auth/:provider/callback?code=...&state=...
// Sets the session cookie and returns the user to the page they started from.
authRouter.get('/:provider/callback', async (req, res) => {
  const raw = readCookie(req, OAUTH_STATE_COOKIE);
  const saved = raw ? verifyOAuthState(raw) : null;
  res.clearCookie(OAUTH_STATE_COOKIE, { path: STATE_COOKIE_PATH });

  const fail = (message: string) => res.redirect(`/login?error=${encodeURIComponent(message)}`);

  if (!saved || saved.provider !== req.params.provider) {
    fail('Your login session expired. Please try again.');
    return;
  }
  if (typeof req.query.error === 'string') {
    fail(req.query.error === 'access_denied' ? 'Login was cancelled.' : `Login failed: ${req.query.error}`);
    return;
  }
  const provider = getProvider(saved.provider);
  if (!provider || typeof req.query.code !== 'string' || req.query.state !== saved.state) {
    fail('Invalid login response. Please try again.');
    return;
  }

  try {
    const profile = await provider.getProfile({
      code: req.query.code,
      redirectUri: callbackUrl(provider.id),
      codeVerifier: saved.codeVerifier,
    });
    const user = await upsertOAuthUser(provider.id, profile, requestLocale(req));
    setSessionCookie(req, res, signAccessToken(user.id));
    res.redirect(safeNextPath(saved.next));
  } catch (err) {
    console.error('OAuth callback failed:', err);
    fail('Could not complete login. Please try again.');
  }
});

async function sendVerification(user: { id: string; email: string | null; name: string | null }) {
  if (!user.email) return;
  const token = await issueVerificationToken(user.id);
  await sendEmail(
    verificationEmail(user.email, user.name, `${config.auth.publicAppUrl}/verify-email?token=${encodeURIComponent(token)}`),
  );
}

// POST /api/auth/register { name, email, password, inviteToken? } -> creates the account and signs in.
// Registering from an invitation sent to the same address counts as proof of
// ownership: the email is verified and the invitation accepted right away.
// Otherwise a verification email is sent and the tree stays locked until it is confirmed.
authRouter.post('/register', async (req, res) => {
  const { name, email, password, inviteToken } = registerSchema.parse(req.body);
  const invitation = inviteToken ? await findInvitationByToken(inviteToken) : null;
  const viaInvitation = !!invitation && !invitation.expired && invitation.email === email;

  const user = await createPasswordUser({
    name,
    email,
    passwordHash: await hashPassword(password),
    emailVerified: viaInvitation,
    locale: requestLocale(req),
  });

  let joinedTreeId: string | undefined;
  if (viaInvitation) {
    joinedTreeId = await acceptInvitation(invitation, user);
  } else {
    try {
      await sendVerification(user);
    } catch (err) {
      // The account exists; the user can request another email from the app.
      console.error('Failed to send verification email:', err);
    }
  }

  setSessionCookie(req, res, signAccessToken(user.id));
  res.status(201).json({ ...user, joinedTreeId });
});

// POST /api/auth/verify-email { token } -> confirms the address from the emailed link
authRouter.post('/verify-email', async (req, res) => {
  const { token } = tokenSchema.parse(req.body);
  const user = await verifyEmailToken(token);
  if (!user) {
    throw new HttpError(400, 'This verification link is invalid or has expired. Sign in to request a new one.');
  }
  res.json({ verified: true, email: user.email });
});

// POST /api/auth/resend-verification -> emails a fresh link (at most once a minute)
authRouter.post('/resend-verification', requireAuth, async (req, res) => {
  const user = req.user!;
  if (!user.verificationRequired) {
    res.json({ sent: false, alreadyVerified: true });
    return;
  }
  const sentAt = await lastVerificationSentAt(user.id);
  if (sentAt && Date.now() - Date.parse(sentAt) < RESEND_COOLDOWN_MS) {
    throw new HttpError(429, 'A verification email was sent less than a minute ago. Please check your inbox.');
  }
  try {
    await sendVerification(user);
  } catch (err) {
    console.error('Failed to send verification email:', err);
    throw new HttpError(502, 'The verification email could not be sent. Please try again later.');
  }
  res.json({ sent: true });
});

// POST /api/auth/login { email, password }
authRouter.post('/login', async (req, res) => {
  const { email, password } = passwordLoginSchema.parse(req.body);
  const limitKey = `${req.ip}|${email}`;
  assertLoginAllowed(limitKey);

  const credentials = await findPasswordCredentials(email);
  // Always run a hash comparison so unknown emails take as long as wrong passwords.
  const valid = await verifyPassword(password, credentials?.passwordHash ?? (await getDummyHash()));
  if (!credentials?.passwordHash || !valid) {
    recordLoginFailure(limitKey);
    throw new HttpError(401, 'Invalid email or password');
  }
  clearLoginFailures(limitKey);

  const user = await recordLogin(credentials.id);
  setSessionCookie(req, res, signAccessToken(user.id));
  res.json(user);
});

// POST /api/auth/forgot-password { email } -> emails a reset link if the account exists.
// The answer is the same either way, so the form doesn't reveal who has an account.
authRouter.post('/forgot-password', async (req, res) => {
  const { email } = forgotPasswordSchema.parse(req.body);
  const issued = await issuePasswordResetToken(email, RESEND_COOLDOWN_MS);
  if (issued) {
    const url = `${config.auth.publicAppUrl}/reset-password?token=${encodeURIComponent(issued.token)}`;
    try {
      await sendEmail(passwordResetEmail(issued.user.email, issued.user.name, url));
    } catch (err) {
      console.error('Failed to send password reset email:', err);
      throw new HttpError(502, 'The reset email could not be sent. Please try again later.');
    }
  }
  res.json({ sent: true });
});

// POST /api/auth/reset-password { token, password } -> sets the new password and signs in.
// Every other session of the account is signed out.
authRouter.post('/reset-password', async (req, res) => {
  const { token, password } = resetPasswordSchema.parse(req.body);
  const user = await resetPasswordWithToken(token, await hashPassword(password));
  if (!user) {
    throw new HttpError(400, 'This reset link is invalid or has expired. Please request a new one.');
  }
  setSessionCookie(req, res, signAccessToken(user.id));
  res.json(user);
});

// POST /api/auth/change-password { currentPassword, newPassword }
// Keeps this session signed in (with a fresh cookie) and signs out all others.
authRouter.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
  const user = req.user!;
  const limitKey = `change|${user.id}`;
  assertLoginAllowed(limitKey);

  const credentials = user.email ? await findPasswordCredentials(user.email) : null;
  if (!credentials?.passwordHash) {
    throw new HttpError(400, 'This account signs in with Google or GitHub. Use "Forgot password" to add a password.');
  }
  if (!(await verifyPassword(currentPassword, credentials.passwordHash))) {
    recordLoginFailure(limitKey);
    throw new HttpError(400, 'Your current password is incorrect');
  }
  clearLoginFailures(limitKey);

  const updated = await changePassword(user.id, await hashPassword(newPassword));
  if (!updated) throw notFound('User');
  setSessionCookie(req, res, signAccessToken(user.id));
  res.json(updated);
});

/**
 * Sensitive account changes ask for the current password again (when the account
 * has one), so a session left open on someone else's device isn't enough.
 * Wrong guesses count towards the same limit as sign-in.
 */
async function assertCurrentPassword(user: AuthUser, password: string | undefined, action: string) {
  if (!user.hasPassword) return;
  const limitKey = `${action}|${user.id}`;
  assertLoginAllowed(limitKey);
  const credentials = user.email ? await findPasswordCredentials(user.email) : null;
  if (!password || !credentials?.passwordHash || !(await verifyPassword(password, credentials.passwordHash))) {
    recordLoginFailure(limitKey);
    throw new HttpError(400, 'Your current password is incorrect', 'wrongPassword');
  }
  clearLoginFailures(limitKey);
}

// POST /api/auth/email { email, password? } -> emails a confirmation link to the new
// address; the account keeps its old email until that link is clicked. The old
// address is told, so a change nobody asked for doesn't go unnoticed.
authRouter.post('/email', requireAuth, async (req, res) => {
  const { email, password } = emailChangeSchema.parse(req.body);
  const user = req.user!;
  if (email === user.email) throw new HttpError(400, 'That is already your email address', 'sameEmail');
  await assertCurrentPassword(user, password, 'email');

  const { token, user: current } = await requestEmailChange(user.id, email, RESEND_COOLDOWN_MS);
  try {
    await sendEmail(
      emailChangeEmail(email, current.name, `${config.auth.publicAppUrl}/confirm-email?token=${encodeURIComponent(token)}`),
    );
  } catch (err) {
    console.error('Failed to send email change confirmation:', err);
    throw new HttpError(502, 'The confirmation email could not be sent. Please try again later.');
  }
  if (current.email) {
    await sendEmail(emailChangeNoticeEmail(current.email, current.name, email, `${config.auth.publicAppUrl}/account`)).catch(
      (err) => console.error('Failed to send email change notice:', err), // the change itself is still safe
    );
  }
  res.json(await findUserById(user.id));
});

// POST /api/auth/email/confirm { token } -> the new address becomes the account's email.
// No session needed: the link may be opened on another device, and it proves itself.
authRouter.post('/email/confirm', async (req, res) => {
  const { token } = tokenSchema.parse(req.body);
  const user = await confirmEmailChange(token);
  if (!user) {
    throw new HttpError(400, 'This confirmation link is invalid or has expired. Ask for a new one on My account.', 'emailLinkExpired');
  }
  res.json({ email: user.email });
});

// DELETE /api/auth/email -> cancels a pending email change
authRouter.delete('/email', requireAuth, async (req, res) => {
  res.json(await cancelEmailChange(req.user!.id));
});

// POST /api/auth/delete-account { password? | confirm? } -> deletes the account and every
// tree it owns (with their people, photos and invitations), and signs out. Accounts
// with a password confirm with it; Google/GitHub-only accounts type their email.
authRouter.post('/delete-account', requireAuth, async (req, res) => {
  const { password, confirm } = deleteAccountSchema.parse(req.body);
  const user = req.user!;
  if (user.hasPassword) {
    await assertCurrentPassword(user, password, 'delete');
  } else {
    const expected = (user.email ?? user.name ?? '').trim().toLowerCase();
    if (!confirm || confirm.toLowerCase() !== expected) {
      throw new HttpError(400, 'Type your email address exactly to confirm', 'deleteConfirmMismatch');
    }
  }
  await deleteUser(user.id);
  clearSessionCookie(req, res);
  res.status(204).end();
});

// GET /api/auth/me -> the signed-in user
authRouter.get('/me', requireAuth, (req, res) => {
  res.json(req.user);
});

// PATCH /api/auth/me { name } -> changes the signed-in user's display name
authRouter.patch('/me', requireAuth, async (req, res) => {
  const { name } = profileUpdateSchema.parse(req.body);
  const updated = await updateUserName(req.user!.id, name);
  if (!updated) throw notFound('User');
  res.json(updated);
});

// GET /api/auth/reminders -> { enabled, daysBefore, people } for death anniversary emails
authRouter.get('/reminders', requireAuth, async (req, res) => {
  res.json(await getReminderPreferences(req.user!.id));
});

// PATCH /api/auth/reminders { enabled?, daysBefore? } (also remembers the UI language for the emails)
authRouter.patch('/reminders', requireAuth, async (req, res) => {
  const changes = reminderPreferencesSchema.parse(req.body);
  if (changes.enabled && !req.user!.email) {
    throw new HttpError(400, 'Reminders are sent by email, and this account has no email address');
  }
  await updateReminderPreferences(req.user!.id, changes, requestLocale(req));
  res.json(await getReminderPreferences(req.user!.id));
});

// POST /api/auth/logout
authRouter.post('/logout', (req, res) => {
  clearSessionCookie(req, res);
  res.status(204).end();
});

import { randomUUID } from 'node:crypto';
import { open, seal } from '../backups/secretBox';
import { config } from '../config';
import { query } from '../db';
import type { EmailMessage } from './mailer';

// Sending through one Gmail account with the Gmail REST API (no SDK).
// It uses the Google sign-in OAuth client with the `gmail.send` scope, which only
// lets the app send mail, never read the mailbox.
//
// An admin connects the account once (see routes/adminEmail.ts); with GMAIL_SENDER
// set, it must be that address. Google returns to the Google sign-in callback, like Drive
// connections do, so no extra redirect URI is needed. The refresh token is kept
// sealed in (:MailSender {id: 'gmail', refreshToken, email, connectedAt}), and the
// account's address is the sender. GMAIL_REFRESH_TOKEN (of GMAIL_SENDER) replaces it.

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

export const GMAIL_SCOPES = `openid email ${SEND_SCOPE}`;

/** The connection can't be used: not granted, revoked, expired, or for another account. */
export class GmailAccessLost extends Error {}

/** The Google sign-in callback, already an authorized redirect URI of the OAuth client. */
export const gmailCallbackUrl = () => `${config.auth.publicAppUrl}/api/auth/google/callback`;

/** Gmail can be used: the Google sign-in client is set (and GMAIL_SENDER, for GMAIL_REFRESH_TOKEN). */
export function gmailConfigured(): boolean {
  const { gmail } = config.email;
  return Boolean(config.oauth.google.clientId && config.oauth.google.clientSecret && (!gmail.refreshToken || gmail.sender));
}

function client() {
  const { clientId, clientSecret } = config.oauth.google;
  if (!clientId || !clientSecret) throw new Error('Sending with Gmail needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET');
  return { clientId, clientSecret };
}

async function fail(action: string, res: Response): Promise<never> {
  const detail = (await res.text().catch(() => '')).slice(0, 300);
  throw new Error(`Gmail ${action} failed (${res.status}): ${detail}`);
}

export function gmailAuthorizationUrl(state: string, codeChallenge: string): string {
  return `${AUTH_URL}?${new URLSearchParams({
    client_id: client().clientId,
    redirect_uri: gmailCallbackUrl(),
    response_type: 'code',
    scope: GMAIL_SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    // Picks the required sender account on Google's screen.
    ...(config.email.gmail.sender && { login_hint: config.email.gmail.sender }),
    // A refresh token is only issued with offline access and the consent screen.
    access_type: 'offline',
    prompt: 'consent',
  })}`;
}

async function revoke(refreshToken: string): Promise<void> {
  await fetch(`${REVOKE_URL}?${new URLSearchParams({ token: refreshToken })}`, { method: 'POST' }).catch(() => undefined);
}

/**
 * Exchanges the callback's code for a refresh token and the account's address. The
 * account must have granted gmail.send (and be GMAIL_SENDER, when set); otherwise
 * the token is revoked.
 */
export async function exchangeGmailCode(code: string, codeVerifier: string): Promise<{ refreshToken: string; email: string }> {
  const { clientId, clientSecret } = client();
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: gmailCallbackUrl(),
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    }),
  });
  if (!res.ok) await fail('sign-in', res);
  const token = (await res.json()) as { access_token: string; refresh_token?: string; scope?: string };
  if (!token.refresh_token) throw new Error('Google did not return a refresh token');
  // The user can untick Gmail on Google's consent screen.
  if (!token.scope?.split(' ').includes(SEND_SCOPE)) {
    await revoke(token.refresh_token);
    throw new GmailAccessLost('Permission to send email was not granted');
  }
  const info = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${token.access_token}` } });
  const email = info.ok ? ((await info.json()) as { email?: string }).email?.toLowerCase() ?? null : null;
  const required = config.email.gmail.sender;
  if (!email || (required && email !== required)) {
    await revoke(token.refresh_token);
    throw new GmailAccessLost(`Connected ${email ?? 'an unknown account'} instead of ${required || 'an account with an email'}`);
  }
  return { refreshToken: token.refresh_token, email };
}

// ---------- The stored connection ----------

export interface GmailConnection {
  email: string | null;
  connectedAt: string | null;
  /** True when GMAIL_REFRESH_TOKEN is set: it is used, and can't be changed from the app. */
  fromEnvironment: boolean;
}

export async function getGmailConnection(): Promise<GmailConnection | null> {
  if (config.email.gmail.refreshToken) {
    return { email: config.email.gmail.sender, connectedAt: null, fromEnvironment: true };
  }
  const [row] = await query<{ email: string | null; connectedAt: string | null }>(
    `MATCH (m:MailSender {id: 'gmail'}) WHERE m.refreshToken IS NOT NULL
     RETURN m.email AS email, m.connectedAt AS connectedAt`,
  );
  return row ? { ...row, fromEnvironment: false } : null;
}

/** Stores a new connection, revoking the one it replaces. */
export async function saveGmailConnection(refreshToken: string, email: string): Promise<void> {
  const [row] = await query<{ previous: string | null }>(
    `MERGE (m:MailSender {id: 'gmail'})
     WITH m, m.refreshToken AS previous
     SET m.refreshToken = $sealed, m.email = $email, m.connectedAt = $now
     RETURN previous`,
    { sealed: seal(refreshToken, 'gmail-refresh-token'), email, now: new Date().toISOString() },
    'WRITE',
  );
  cached = null;
  const previous = row?.previous ? open(row.previous, 'gmail-refresh-token') : null;
  if (previous && previous !== refreshToken) await revoke(previous);
}

/** Forgets and revokes the connection. Emails fail to send until it is connected again. */
export async function removeGmailConnection(): Promise<void> {
  const [row] = await query<{ token: string | null }>(
    `MATCH (m:MailSender {id: 'gmail'})
     WITH m, m.refreshToken AS token
     DETACH DELETE m
     RETURN token`,
    {},
    'WRITE',
  );
  cached = null;
  const token = row?.token ? open(row.token, 'gmail-refresh-token') : null;
  if (token) await revoke(token);
}

async function storedAccount(): Promise<{ refreshToken: string; email: string } | null> {
  const { gmail } = config.email;
  if (gmail.refreshToken) return { refreshToken: gmail.refreshToken, email: gmail.sender };
  const [row] = await query<{ token: string | null; email: string | null }>(
    `MATCH (m:MailSender {id: 'gmail'}) RETURN m.refreshToken AS token, m.email AS email`,
  );
  const refreshToken = row?.token ? open(row.token, 'gmail-refresh-token') : null;
  return refreshToken && row?.email ? { refreshToken, email: row.email } : null;
}

// ---------- Sending ----------

// Access tokens last an hour; reuse one across warm invocations.
let cached: { token: string; expiresAt: number; sender: string } | null = null;

async function accessToken(): Promise<{ token: string; sender: string }> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached;
  const account = await storedAccount();
  if (!account) throw new GmailAccessLost('The Gmail sender is not connected');
  const { refreshToken, email: sender } = account;
  const { clientId, clientSecret } = client();
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret }),
  });
  if (res.status === 400 || res.status === 401) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (body.error === 'invalid_grant') throw new GmailAccessLost('Gmail access was revoked or has expired; connect it again');
  }
  if (!res.ok) await fail('sign-in', res);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000, sender };
  return cached;
}

/** RFC 2047 encoded-word, for non-ASCII (Vietnamese) subjects and names. */
const encodeHeader = (value: string) =>
  /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;

/** Base64 body lines of at most 76 characters. */
const base64Lines = (value: string) => Buffer.from(value, 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');

/** The display name from EMAIL_FROM ("Family Tree <x@y>"), with the Gmail account as the address. */
function fromHeader(sender: string): string {
  const name = config.email.from.match(/^\s*"?([^"<]*?)"?\s*</)?.[1]?.trim();
  return name ? `${encodeHeader(name)} <${sender}>` : sender;
}

function mimeMessage(message: EmailMessage, sender: string): string {
  const boundary = `ft-${randomUUID()}`;
  return [
    `From: ${fromHeader(sender)}`,
    `To: ${message.to}`,
    `Subject: ${encodeHeader(message.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(message.text),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(message.html),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

export async function sendWithGmail(message: EmailMessage): Promise<void> {
  // Addresses come from validated input, but keep them out of header syntax anyway.
  if (/[\r\n]/.test(message.to)) throw new Error('Invalid recipient address');
  const { token, sender } = await accessToken();
  const res = await fetch(SEND_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: Buffer.from(mimeMessage(message, sender), 'utf8').toString('base64url') }),
  });
  if (res.status === 401) cached = null;
  if (!res.ok) await fail('send', res);
}

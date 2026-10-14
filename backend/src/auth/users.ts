import { query } from '../db';
import { HttpError } from '../errors';
import { removeStoredFiles } from '../trees/photos';
import type { Locale } from './cookies';
import { PRIVACY_VERSION } from './privacy';
import type { OAuthProfile } from './providers';
import { createLinkToken, hashLinkToken } from './secureTokens';

// Every account is a separate container: it owns one private tree and only sees
// other trees it was invited to. There is no application-wide admin, so no
// account can list or manage other accounts.

export interface AuthUser {
  id: string;
  email: string | null;
  emailVerified: boolean;
  /** True for email+password accounts that haven't confirmed their address yet. */
  verificationRequired: boolean;
  /** False for accounts that only sign in through Google or GitHub. */
  hasPassword: boolean;
  name: string | null;
  avatarUrl: string | null;
  createdAt: string;
  lastLoginAt: string;
  /** A new email waiting for its confirmation link to be clicked (still unexpired). */
  pendingEmail: string | null;
  /** True until the user accepts the current personal data agreement (PRIVACY_VERSION). */
  consentRequired: boolean;
  /** The agreement version the user last accepted, and when. Null if never, or withdrawn. */
  privacyVersion: string | null;
  privacyAcceptedAt: string | null;
}

type UserRow = { user: AuthUser };

const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
const EMAIL_CHANGE_TTL_MS = 24 * 60 * 60 * 1000;

// Explicit projection: passwordHash and token hashes never leave the database layer.
const USER_FIELDS = `.id, .email, .name, .avatarUrl, .createdAt, .lastLoginAt,
  emailVerified: coalesce(u.emailVerified, u.email IS NOT NULL),
  verificationRequired: u.passwordHash IS NOT NULL AND NOT coalesce(u.emailVerified, false),
  hasPassword: u.passwordHash IS NOT NULL,
  pendingEmail: CASE WHEN datetime(u.pendingEmailExpiresAt) > datetime() THEN u.pendingEmail END,
  .privacyVersion, .privacyAcceptedAt,
  consentRequired: coalesce(u.privacyVersion, '') <> '${PRIVACY_VERSION}'`;

// Every account gets a private tree it owns.
const CREATE_PERSONAL_TREE = `
  CREATE (u)-[:MEMBER_OF {role: 'owner', since: $now}]->(:Tree {id: randomUUID(), name: $treeName, createdAt: $now})`;

/** A new account's tree name, in the user's language. The owner can rename it in Settings. */
export function personalTreeName(name: string | null | undefined, locale: Locale): string {
  const who = name?.trim();
  if (locale === 'vi') return who ? `Gia phả của ${who}` : 'Gia phả của tôi';
  return who ? `${who}'s family tree` : 'My family tree';
}

export async function findUserById(id: string): Promise<AuthUser | null> {
  const [row] = await query<UserRow>(`MATCH (u:User {id: $id}) RETURN u {${USER_FIELDS}} AS user`, { id });
  return row?.user ?? null;
}

/** The user behind a session, plus when their password last changed (sessions issued earlier are void). */
export async function findSessionUser(
  id: string,
): Promise<{ user: AuthUser; passwordChangedAt: string | null } | null> {
  const [row] = await query<UserRow & { passwordChangedAt: string | null }>(
    `MATCH (u:User {id: $id}) RETURN u {${USER_FIELDS}} AS user, u.passwordChangedAt AS passwordChangedAt`,
    { id },
  );
  return row ?? null;
}

// ---------- Email + password ----------

/**
 * Registers an email+password account. `emailVerified` is true only when the
 * caller has proof of ownership (registering from an invitation link sent to
 * that address); otherwise a verification email must be confirmed.
 */
export async function createPasswordUser(input: {
  email: string;
  name: string;
  passwordHash: string;
  emailVerified: boolean;
  locale: Locale;
  /** The registration form's agreement checkbox (the caller checks the version). */
  privacyVersion: string;
}): Promise<AuthUser> {
  const now = new Date().toISOString();
  const [existing] = await query<{
    id: string;
    hasPassword: boolean;
    verified: boolean;
    tokenExpired: boolean;
    people: number;
    memberships: number;
    accounts: number;
  }>(
    `MATCH (u:User {email: $email})
     RETURN u.id AS id,
            u.passwordHash IS NOT NULL AS hasPassword,
            coalesce(u.emailVerified, true) AS verified,
            coalesce(u.verifyTokenExpiresAt, '') < $now AS tokenExpired,
            COUNT { MATCH (u)-[:MEMBER_OF]->(t:Tree), (p:Person) WHERE p.treeId = t.id } AS people,
            COUNT { (u)-[:MEMBER_OF]->(:Tree) } AS memberships,
            COUNT { (u)-[:HAS_ACCOUNT]->(:Account) } AS accounts`,
    { email: input.email, now },
  );

  if (existing) {
    // Someone registered this address but never confirmed it, and the link has
    // expired. Unverified accounts can't add data, so if it is still empty we
    // let the (possibly real) owner of the address register instead.
    const abandoned =
      !existing.verified &&
      existing.tokenExpired &&
      existing.people === 0 &&
      existing.memberships <= 1 &&
      existing.accounts === 0;
    if (abandoned) {
      await deleteUser(existing.id);
    } else if (!existing.verified) {
      throw new HttpError(
        409,
        'An account with this email is waiting for email verification. Sign in to resend the link, or try again in 24 hours if that account isn’t yours.',
      );
    } else {
      throw new HttpError(
        409,
        existing.hasPassword
          ? 'An account with this email already exists. Please sign in instead.'
          : 'This email is already registered through Google or GitHub. Please sign in with that instead.',
      );
    }
  }

  try {
    const [created] = await query<UserRow>(
      `CREATE (u:User {
         id: randomUUID(), email: $email, emailVerified: $emailVerified, name: $name,
         passwordHash: $passwordHash, createdAt: $now, lastLoginAt: $now,
         privacyVersion: $privacyVersion, privacyAcceptedAt: $now
       })
       ${CREATE_PERSONAL_TREE}
       RETURN u {${USER_FIELDS}} AS user`,
      { ...input, now, treeName: personalTreeName(input.name, input.locale) },
      'WRITE',
    );
    return created.user;
  } catch (err) {
    // Lost a race with another registration for the same email.
    if ((err as { code?: string }).code === 'Neo.ClientError.Schema.ConstraintValidationFailed') {
      throw new HttpError(409, 'An account with this email already exists. Please sign in instead.');
    }
    throw err;
  }
}

export async function findPasswordCredentials(
  email: string,
): Promise<{ id: string; passwordHash: string | null } | null> {
  const [row] = await query<{ id: string; passwordHash: string | null }>(
    'MATCH (u:User {email: $email}) RETURN u.id AS id, u.passwordHash AS passwordHash',
    { email },
  );
  return row ?? null;
}

export async function recordLogin(id: string): Promise<AuthUser> {
  const [row] = await query<UserRow>(
    `MATCH (u:User {id: $id}) SET u.lastLoginAt = $now RETURN u {${USER_FIELDS}} AS user`,
    { id, now: new Date().toISOString() },
    'WRITE',
  );
  return row.user;
}

// ---------- Email verification ----------

/** Issues a new verification link token (replacing any previous one). */
export async function issueVerificationToken(userId: string): Promise<string> {
  const { token, hash } = createLinkToken();
  const now = Date.now();
  await query(
    `MATCH (u:User {id: $id})
     SET u.verifyTokenHash = $hash, u.verifyTokenExpiresAt = $expiresAt, u.verifySentAt = $now`,
    {
      id: userId,
      hash,
      expiresAt: new Date(now + VERIFY_TOKEN_TTL_MS).toISOString(),
      now: new Date(now).toISOString(),
    },
    'WRITE',
  );
  return token;
}

export async function lastVerificationSentAt(userId: string): Promise<string | null> {
  const [row] = await query<{ sentAt: string | null }>(
    'MATCH (u:User {id: $id}) RETURN u.verifySentAt AS sentAt',
    { id: userId },
  );
  return row?.sentAt ?? null;
}

/** Confirms the address behind a verification link. Returns null if the link is invalid or expired. */
export async function verifyEmailToken(token: string): Promise<AuthUser | null> {
  const [row] = await query<UserRow>(
    `MATCH (u:User {verifyTokenHash: $hash})
     WHERE u.verifyTokenExpiresAt > $now
     SET u.emailVerified = true
     REMOVE u.verifyTokenHash, u.verifyTokenExpiresAt, u.verifySentAt
     RETURN u {${USER_FIELDS}} AS user`,
    { hash: hashLinkToken(token), now: new Date().toISOString() },
    'WRITE',
  );
  return row?.user ?? null;
}

/** Marks the address verified when ownership was proven another way (an invitation link sent to it). */
export async function markEmailVerified(userId: string): Promise<AuthUser | null> {
  const [row] = await query<UserRow>(
    `MATCH (u:User {id: $id})
     SET u.emailVerified = true
     REMOVE u.verifyTokenHash, u.verifyTokenExpiresAt, u.verifySentAt
     RETURN u {${USER_FIELDS}} AS user`,
    { id: userId },
    'WRITE',
  );
  return row?.user ?? null;
}

// ---------- Password reset and change ----------

// Session tokens carry their issue time in whole seconds, so the change time is
// rounded down too: sessions issued from this second on (the one that made the
// change) stay valid, every earlier one is signed out.
const passwordChangeTime = () => new Date(Math.floor(Date.now() / 1000) * 1000).toISOString();

/**
 * Issues a reset link token for the account with this email, replacing any
 * previous one. Returns null when there is no such account, or when a link was
 * sent less than `cooldownMs` ago (so the form can't be used to flood an inbox).
 */
export async function issuePasswordResetToken(
  email: string,
  cooldownMs: number,
): Promise<{ token: string; user: { id: string; email: string; name: string | null } } | null> {
  const { token, hash } = createLinkToken();
  const now = Date.now();
  const [row] = await query<{ id: string; email: string; name: string | null }>(
    `MATCH (u:User {email: $email})
     WHERE coalesce(u.resetSentAt, '') < $cooldownStart
     SET u.resetTokenHash = $hash, u.resetTokenExpiresAt = $expiresAt, u.resetSentAt = $now
     RETURN u.id AS id, u.email AS email, u.name AS name`,
    {
      email,
      hash,
      cooldownStart: new Date(now - cooldownMs).toISOString(),
      expiresAt: new Date(now + RESET_TOKEN_TTL_MS).toISOString(),
      now: new Date(now).toISOString(),
    },
    'WRITE',
  );
  return row ? { token, user: row } : null;
}

/**
 * Sets a new password from a reset link. The link proves the user controls the
 * inbox, so the email becomes verified (and an OAuth-only account gains a
 * password). Returns null if the link is invalid or expired.
 */
export async function resetPasswordWithToken(token: string, passwordHash: string): Promise<AuthUser | null> {
  const [row] = await query<UserRow>(
    `MATCH (u:User {resetTokenHash: $hash})
     WHERE u.resetTokenExpiresAt > $now
     SET u.passwordHash = $passwordHash,
         u.passwordChangedAt = $changedAt,
         u.lastLoginAt = $now,
         u.emailVerified = true
     REMOVE u.resetTokenHash, u.resetTokenExpiresAt, u.resetSentAt,
            u.verifyTokenHash, u.verifyTokenExpiresAt, u.verifySentAt
     RETURN u {${USER_FIELDS}} AS user`,
    {
      hash: hashLinkToken(token),
      passwordHash,
      now: new Date().toISOString(),
      changedAt: passwordChangeTime(),
    },
    'WRITE',
  );
  return row?.user ?? null;
}

/** Replaces the password of a signed-in user (the caller checks the current one). */
export async function changePassword(userId: string, passwordHash: string): Promise<AuthUser | null> {
  const [row] = await query<UserRow>(
    `MATCH (u:User {id: $id})
     SET u.passwordHash = $passwordHash, u.passwordChangedAt = $changedAt
     REMOVE u.resetTokenHash, u.resetTokenExpiresAt, u.resetSentAt
     RETURN u {${USER_FIELDS}} AS user`,
    { id: userId, passwordHash, changedAt: passwordChangeTime() },
    'WRITE',
  );
  return row?.user ?? null;
}

// ---------- Changing the email ----------

const emailTaken = () =>
  new HttpError(409, 'Another account already uses this email address', 'emailTaken');

/**
 * Starts changing the account's email: the new address must confirm it with the
 * returned link token before it replaces the old one (proving the user owns it).
 * Asking again replaces the pending request. Refused while a link was sent less
 * than `cooldownMs` ago, so the form can't be used to flood someone's inbox.
 */
export async function requestEmailChange(
  userId: string,
  newEmail: string,
  cooldownMs: number,
): Promise<{ token: string; user: { email: string | null; name: string | null } }> {
  const [taken] = await query('MATCH (u:User {email: $email}) WHERE u.id <> $userId RETURN 1 AS found', {
    email: newEmail,
    userId,
  });
  if (taken) throw emailTaken();
  const { token, hash } = createLinkToken();
  const now = Date.now();
  const [row] = await query<{ email: string | null; name: string | null }>(
    `MATCH (u:User {id: $userId})
     WHERE coalesce(u.emailChangeSentAt, '') < $cooldownStart
     SET u.pendingEmail = $email, u.pendingEmailTokenHash = $hash,
         u.pendingEmailExpiresAt = $expiresAt, u.emailChangeSentAt = $now
     RETURN u.email AS email, u.name AS name`,
    {
      userId,
      email: newEmail,
      hash,
      cooldownStart: new Date(now - cooldownMs).toISOString(),
      expiresAt: new Date(now + EMAIL_CHANGE_TTL_MS).toISOString(),
      now: new Date(now).toISOString(),
    },
    'WRITE',
  );
  if (!row) {
    throw new HttpError(429, 'A confirmation email was sent less than a minute ago. Please check that inbox.', 'emailChangeCooldown');
  }
  return { token, user: row };
}

/**
 * Confirms a new email from its link: it becomes the account's (verified) email.
 * Returns null when the link is invalid or expired.
 */
export async function confirmEmailChange(token: string): Promise<AuthUser | null> {
  try {
    const [row] = await query<UserRow>(
      `MATCH (u:User {pendingEmailTokenHash: $hash})
       WHERE u.pendingEmailExpiresAt > $now
       SET u.email = u.pendingEmail, u.emailVerified = true
       REMOVE u.pendingEmail, u.pendingEmailTokenHash, u.pendingEmailExpiresAt, u.emailChangeSentAt,
              u.verifyTokenHash, u.verifyTokenExpiresAt, u.verifySentAt
       RETURN u {${USER_FIELDS}} AS user`,
      { hash: hashLinkToken(token), now: new Date().toISOString() },
      'WRITE',
    );
    return row?.user ?? null;
  } catch (err) {
    // Someone else registered that address in the meantime (unique email constraint).
    if ((err as { code?: string }).code === 'Neo.ClientError.Schema.ConstraintValidationFailed') throw emailTaken();
    throw err;
  }
}

/** Drops a pending email change (the old email stays). */
export async function cancelEmailChange(userId: string): Promise<AuthUser | null> {
  const [row] = await query<UserRow>(
    `MATCH (u:User {id: $userId})
     REMOVE u.pendingEmail, u.pendingEmailTokenHash, u.pendingEmailExpiresAt, u.emailChangeSentAt
     RETURN u {${USER_FIELDS}} AS user`,
    { userId },
    'WRITE',
  );
  return row?.user ?? null;
}

// ---------- Social login ----------

/**
 * Signs a user in from a social profile, registering them on first login.
 *  1. A known provider account logs into its user.
 *  2. Otherwise a verified email that matches an existing user links the new
 *     provider to that user (so Google + GitHub with the same email = one user).
 *     If that user self-registered with a still-unverified email, the provider
 *     has just proven who owns the address, so the unverified password is
 *     removed. That stops someone pre-registering a victim's email and keeping
 *     access after the real owner signs in.
 *  3. Otherwise a new user (with a private tree) is created.
 */
export async function upsertOAuthUser(provider: string, profile: OAuthProfile, locale: Locale): Promise<AuthUser> {
  const email = profile.emailVerified && profile.email ? profile.email.trim().toLowerCase() : null;
  const params = {
    provider,
    providerAccountId: profile.providerAccountId,
    email,
    name: profile.name,
    avatarUrl: profile.avatarUrl,
    now: new Date().toISOString(),
  };

  const [existing] = await query<UserRow>(
    `MATCH (u:User)-[:HAS_ACCOUNT]->(:Account {provider: $provider, providerAccountId: $providerAccountId})
     SET u.lastLoginAt = $now,
         u.name = coalesce(u.name, $name),
         u.avatarUrl = coalesce($avatarUrl, u.avatarUrl)
     RETURN u {${USER_FIELDS}} AS user`,
    params,
    'WRITE',
  );
  if (existing) return existing.user;

  if (email) {
    const [linked] = await query<UserRow>(
      `MATCH (u:User {email: $email})
       CREATE (u)-[:HAS_ACCOUNT]->(:Account {provider: $provider, providerAccountId: $providerAccountId, createdAt: $now})
       SET u.passwordHash = CASE WHEN coalesce(u.emailVerified, true) THEN u.passwordHash ELSE null END,
           u.emailVerified = true,
           u.lastLoginAt = $now,
           u.avatarUrl = coalesce(u.avatarUrl, $avatarUrl)
       REMOVE u.verifyTokenHash, u.verifyTokenExpiresAt, u.verifySentAt
       RETURN u {${USER_FIELDS}} AS user`,
      params,
      'WRITE',
    );
    if (linked) return linked.user;
  }

  const [created] = await query<UserRow>(
    `CREATE (u:User {
       id: randomUUID(), email: $email, emailVerified: $email IS NOT NULL, name: $name, avatarUrl: $avatarUrl,
       createdAt: $now, lastLoginAt: $now
     })
     CREATE (u)-[:HAS_ACCOUNT]->(:Account {provider: $provider, providerAccountId: $providerAccountId, createdAt: $now})
     ${CREATE_PERSONAL_TREE}
     RETURN u {${USER_FIELDS}} AS user`,
    { ...params, treeName: personalTreeName(profile.name, locale) },
    'WRITE',
  );
  return created.user;
}

// ---------- Profile ----------

/** Changes the signed-in user's display name. */
export async function updateUserName(userId: string, name: string): Promise<AuthUser | null> {
  const [row] = await query<UserRow>(
    `MATCH (u:User {id: $id}) SET u.name = $name RETURN u {${USER_FIELDS}} AS user`,
    { id: userId, name },
    'WRITE',
  );
  return row?.user ?? null;
}

// ---------- Personal data agreement ----------

/**
 * Records that the user accepted the current agreement. The version and time are
 * kept as the record of consent (Luật 91/2025/QH15, Điều 9).
 */
export async function acceptPrivacy(userId: string): Promise<AuthUser | null> {
  const [row] = await query<UserRow>(
    `MATCH (u:User {id: $id})
     SET u.privacyVersion = $version, u.privacyAcceptedAt = $now
     REMOVE u.privacyWithdrawnAt
     RETURN u {${USER_FIELDS}} AS user`,
    { id: userId, version: PRIVACY_VERSION, now: new Date().toISOString() },
    'WRITE',
  );
  return row?.user ?? null;
}

/**
 * Withdraws consent (Điều 10). The account and its data stay until the user
 * deletes them, but the app stops using them: trees, invitations and reminder
 * emails are blocked until the agreement is accepted again.
 */
export async function withdrawPrivacy(userId: string): Promise<AuthUser | null> {
  const [row] = await query<UserRow>(
    `MATCH (u:User {id: $id})
     SET u.privacyWithdrawnAt = $now
     REMOVE u.privacyVersion, u.privacyAcceptedAt
     RETURN u {${USER_FIELDS}} AS user`,
    { id: userId, now: new Date().toISOString() },
    'WRITE',
  );
  return row?.user ?? null;
}

// ---------- Deleting accounts ----------

/** Deletes the user, their linked accounts and every tree they own (with its people, photos and invitations). */
export async function deleteUser(id: string): Promise<boolean> {
  const [row] = await query<{ id: string; photoRefs: string[] }>(
    `MATCH (u:User {id: $id})
     OPTIONAL MATCH (u)-[:HAS_ACCOUNT]->(a:Account)
     WITH u, u.id AS id, collect(a) AS accounts
     CALL (u) {
       OPTIONAL MATCH (u)-[:MEMBER_OF {role: 'owner'}]->(t:Tree)
       OPTIONAL MATCH (ph:Photo {treeId: t.id})
       RETURN collect(ph.storageRef) AS photoRefs
     }
     CALL (u) {
       MATCH (u)-[:MEMBER_OF {role: 'owner'}]->(t:Tree)
       CALL (t) { MATCH (p:Person {treeId: t.id}) DETACH DELETE p }
       CALL (t) { MATCH (ph:Photo {treeId: t.id}) DELETE ph }
       CALL (t) { MATCH (i:Invitation {treeId: t.id}) DELETE i }
       DETACH DELETE t
     }
     FOREACH (a IN accounts | DETACH DELETE a)
     DETACH DELETE u
     RETURN id, photoRefs`,
    { id },
    'WRITE',
  );
  if (row) await removeStoredFiles(row.photoRefs);
  return Boolean(row);
}

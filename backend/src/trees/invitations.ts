import { createLinkToken, hashLinkToken } from '../auth/secureTokens';
import type { AuthUser } from '../auth/users';
import { config } from '../config';
import { query } from '../db';
import { sendEmail } from '../email/mailer';
import { invitationEmail } from '../email/templates';
import { HttpError } from '../errors';
import { editScopeCypher, type EditScope } from './branch';
import type { TreeAccess } from './trees';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Every user can invite people to their own tree, and registration is open, so
// invitation emails (sends and resends) are capped per user. Kept on the User
// node, so it holds across serverless instances.
export const INVITE_EMAILS_PER_DAY = 20;
const INVITE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Counts one invitation email against the user's daily quota, or refuses with 429. */
export async function chargeInviteQuota(user: AuthUser): Promise<void> {
  const nowMs = Date.now();
  const [row] = await query(
    `MATCH (u:User {id: $userId})
     WITH u, CASE WHEN coalesce(u.inviteWindowStart, '') < $windowStart THEN 0 ELSE u.inviteCount END AS used
     WHERE used < $max
     SET u.inviteWindowStart = CASE WHEN used = 0 THEN $now ELSE u.inviteWindowStart END,
         u.inviteCount = used + 1
     RETURN u.inviteCount AS count`,
    {
      userId: user.id,
      max: INVITE_EMAILS_PER_DAY,
      now: new Date(nowMs).toISOString(),
      windowStart: new Date(nowMs - INVITE_WINDOW_MS).toISOString(),
    },
    'WRITE',
  );
  if (!row) {
    throw new HttpError(
      429,
      `You can send at most ${INVITE_EMAILS_PER_DAY} invitation emails a day. Please try again tomorrow.`,
      'inviteLimit',
    );
  }
}

export type InviteRole = 'admin' | 'editor' | 'viewer';

export interface Invitation {
  id: string;
  email: string;
  role: InviteRole;
  treeId: string;
  treeName: string;
  inviterName: string;
  createdAt: string;
  expiresAt: string;
  expired: boolean;
  /** For editors limited to one branch of the tree; null means the whole tree. */
  editScope: TreeAccess['editScope'];
}

const INVITATION_FIELDS = `{
  id: i.id, email: i.email, role: i.role, createdAt: i.createdAt, expiresAt: i.expiresAt,
  expired: i.expiresAt <= $now,
  editScope: ${editScopeCypher('i', 'i.treeId')},
  treeId: t.id, treeName: t.name,
  inviterName: coalesce(inviter.name, inviter.email, 'Someone')
}`;

const MATCH_DETAILS = `
  MATCH (t:Tree {id: i.treeId})
  OPTIONAL MATCH (inviter:User {id: i.invitedBy})`;

const now = () => new Date().toISOString();
const inviteUrl = (token: string) => `${config.auth.publicAppUrl}/invite?token=${encodeURIComponent(token)}`;

async function deliver(invitation: Invitation, token: string) {
  try {
    await sendEmail(
      invitationEmail(invitation.email, invitation.inviterName, invitation.treeName, invitation.role, inviteUrl(token)),
    );
  } catch (err) {
    console.error('Failed to send invitation email:', err);
    throw new HttpError(502, 'The invitation was saved, but the email could not be sent. Try "Resend" later.');
  }
}

const notYours = () =>
  new HttpError(403, 'Only the tree owner can change an invitation to become an admin', 'ownerOnly');

/**
 * Creates (or replaces) a pending invitation for `email` and emails the link.
 * `scope` limits an editor to one branch (ignored for other roles). Only an
 * invitation whose role is in `manageable` can be replaced, so an admin can't
 * overwrite the owner's invitation of a new admin.
 */
export async function createInvitation(input: {
  treeId: string;
  email: string;
  role: InviteRole;
  scope: EditScope | null;
  invitedBy: string;
  manageable: InviteRole[];
}): Promise<Invitation> {
  const { scope, manageable, ...fields } = input;
  const branch = input.role === 'editor' ? scope : null;
  const [existing] = await query<{ member: boolean; pendingRole: InviteRole | null }>(
    `RETURN EXISTS { (:User {email: $email})-[:MEMBER_OF]->(:Tree {id: $treeId}) } AS member,
            head(COLLECT { MATCH (i:Invitation {treeId: $treeId, email: $email}) RETURN i.role }) AS pendingRole`,
    { treeId: input.treeId, email: input.email },
  );
  if (existing?.member) throw new HttpError(409, 'That person already has access to this tree.');
  if (existing?.pendingRole && !manageable.includes(existing.pendingRole)) throw notYours();

  const { token, hash } = createLinkToken();
  const [row] = await query<{ invitation: Invitation }>(
    `OPTIONAL MATCH (old:Invitation {treeId: $treeId, email: $email})
     DELETE old
     WITH DISTINCT 1 AS _
     CREATE (i:Invitation {
       id: randomUUID(), treeId: $treeId, email: $email, role: $role, invitedBy: $invitedBy,
       scopeRootId: $scopeRootId, scopeDepth: $scopeDepth,
       tokenHash: $hash, createdAt: $now, expiresAt: $expiresAt
     })
     WITH i
     ${MATCH_DETAILS}
     RETURN ${INVITATION_FIELDS} AS invitation`,
    {
      ...fields,
      scopeRootId: branch?.rootId ?? null,
      scopeDepth: branch?.depth ?? null,
      hash,
      now: now(),
      expiresAt: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
    },
    'WRITE',
  );
  await deliver(row.invitation, token);
  return row.invitation;
}

/**
 * Issues a fresh link (and expiry) for an existing invitation and emails it again.
 * Only invitations whose role is in `manageable`; others answer null like a missing one.
 */
export async function resendInvitation(treeId: string, id: string, manageable: InviteRole[]): Promise<Invitation | null> {
  const { token, hash } = createLinkToken();
  const [row] = await query<{ invitation: Invitation }>(
    `MATCH (i:Invitation {id: $id, treeId: $treeId})
     WHERE i.role IN $manageable
     SET i.tokenHash = $hash, i.expiresAt = $expiresAt
     WITH i
     ${MATCH_DETAILS}
     RETURN ${INVITATION_FIELDS} AS invitation`,
    { id, treeId, manageable, hash, now: now(), expiresAt: new Date(Date.now() + INVITE_TTL_MS).toISOString() },
    'WRITE',
  );
  if (!row) return null;
  await deliver(row.invitation, token);
  return row.invitation;
}

export async function listInvitations(treeId: string): Promise<Invitation[]> {
  const rows = await query<{ invitation: Invitation }>(
    `MATCH (i:Invitation {treeId: $treeId})
     ${MATCH_DETAILS}
     RETURN ${INVITATION_FIELDS} AS invitation
     ORDER BY i.createdAt DESC`,
    { treeId, now: now() },
  );
  return rows.map((r) => r.invitation);
}

/** Deletes a pending invitation whose role is in `manageable`. */
export async function revokeInvitation(treeId: string, id: string, manageable: InviteRole[]): Promise<boolean> {
  const [row] = await query<{ deleted: number }>(
    'MATCH (i:Invitation {id: $id, treeId: $treeId}) WHERE i.role IN $manageable DELETE i RETURN count(*) AS deleted',
    { id, treeId, manageable },
    'WRITE',
  );
  return Boolean(row?.deleted);
}

export async function findInvitationByToken(token: string): Promise<Invitation | null> {
  const [row] = await query<{ invitation: Invitation }>(
    `MATCH (i:Invitation {tokenHash: $hash})
     ${MATCH_DETAILS}
     RETURN ${INVITATION_FIELDS} AS invitation`,
    { hash: hashLinkToken(token), now: now() },
  );
  return row?.invitation ?? null;
}

export async function findInvitationById(id: string): Promise<Invitation | null> {
  const [row] = await query<{ invitation: Invitation }>(
    `MATCH (i:Invitation {id: $id})
     ${MATCH_DETAILS}
     RETURN ${INVITATION_FIELDS} AS invitation`,
    { id, now: now() },
  );
  return row?.invitation ?? null;
}

/** Pending, unexpired invitations addressed to the user's verified email. */
export async function pendingInvitationsFor(user: AuthUser): Promise<Invitation[]> {
  if (!user.email || !user.emailVerified) return [];
  const rows = await query<{ invitation: Invitation }>(
    `MATCH (i:Invitation {email: $email})
     WHERE i.expiresAt > $now
     ${MATCH_DETAILS}
     RETURN ${INVITATION_FIELDS} AS invitation
     ORDER BY i.createdAt DESC`,
    { email: user.email, now: now() },
  );
  return rows.map((r) => r.invitation);
}

/**
 * An invitation can only be used by the account that owns the invited address,
 * so a forwarded or leaked link is useless to anyone else.
 */
export function assertInvitationFor(invitation: Invitation, user: AuthUser) {
  if (invitation.expired) {
    throw new HttpError(410, 'This invitation has expired. Ask the person who invited you to send a new one.');
  }
  if (!user.email || !user.emailVerified || user.email !== invitation.email) {
    throw new HttpError(
      403,
      `This invitation was sent to ${invitation.email}. Sign in with an account that uses that email address to accept it.`,
    );
  }
}

/**
 * Adds the user to the tree and consumes the invitation, keeping the wider of the
 * existing and the invited access: owner > admin > editor of the whole tree >
 * editor of a branch > viewer. Between two branches, the invitation's (newer) one wins.
 */
export async function acceptInvitation(invitation: Invitation, user: AuthUser): Promise<string> {
  assertInvitationFor(invitation, user);
  const [row] = await query<{ treeId: string }>(
    `MATCH (i:Invitation {id: $id})
     MATCH (t:Tree {id: i.treeId}), (u:User {id: $userId})
     MERGE (u)-[m:MEMBER_OF]->(t)
     ON CREATE SET m.since = $now
     WITH t, i, m, coalesce(m.role, '') AS oldRole, m.scopeRootId AS oldRoot, m.scopeDepth AS oldDepth
     WITH t, i, m, oldRoot, oldDepth,
          CASE
            WHEN oldRole = 'owner' THEN 'owner'
            WHEN oldRole = 'admin' OR i.role = 'admin' THEN 'admin'
            WHEN oldRole = 'editor' OR i.role = 'editor' THEN 'editor'
            ELSE 'viewer'
          END AS role,
          (oldRole = 'editor' AND oldRoot IS NULL) OR (i.role = 'editor' AND i.scopeRootId IS NULL) AS wholeTree
     WITH t, i, m, role,
          CASE WHEN role <> 'editor' OR wholeTree THEN null
               WHEN i.role = 'editor' THEN [i.scopeRootId, i.scopeDepth]
               ELSE [oldRoot, oldDepth] END AS branch
     SET m.role = role, m.scopeRootId = branch[0], m.scopeDepth = branch[1]
     WITH t, i
     DELETE i
     RETURN t.id AS treeId`,
    { id: invitation.id, userId: user.id, now: now() },
    'WRITE',
  );
  if (!row) throw new HttpError(404, 'This invitation is no longer valid.');
  return row.treeId;
}

export async function declineInvitation(invitation: Invitation, user: AuthUser): Promise<void> {
  if (user.email !== invitation.email) throw new HttpError(403, 'This invitation was sent to someone else.');
  await query('MATCH (i:Invitation {id: $id}) DELETE i', { id: invitation.id }, 'WRITE');
}

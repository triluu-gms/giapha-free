import type { Locale } from '../auth/cookies';
import { personalTreeName, USER_FIELDS, type AuthUser } from '../auth/users';
import { query } from '../db';
import { editScopeCypher, type EditScope } from './branch';
import { removeStoredFiles } from './photos';
import { TREE_SETTINGS_CYPHER, type TreeSettings } from './settings';

// Ordered from least to most privileged. Admins edit the whole tree and manage
// sharing and settings like the owner, but only the owner manages admins and can
// hand the tree over (transferOwnership).
export const treeRoles = ['viewer', 'editor', 'admin', 'owner'] as const;
export type TreeRole = (typeof treeRoles)[number];
export const hasTreeRole = (role: TreeRole, minimum: TreeRole) =>
  treeRoles.indexOf(role) >= treeRoles.indexOf(minimum);

export interface TreeAccess {
  id: string;
  name: string;
  role: TreeRole;
  /** This tree's own settings (see settings.ts). */
  settings: TreeSettings;
  /** The person in this tree the caller said is them ("This is me"), if any. */
  myPersonId: string | null;
  /** Set when the caller is an editor limited to one branch (see branch.ts). */
  editScope: (EditScope & { root: PersonRef | null }) | null;
}

type PersonRef = { id: string; firstName: string; lastName: string | null };

export interface TreeSummary extends TreeAccess {
  ownerName: string | null;
  personCount: number;
  memberCount: number;
  /** Pending requests from the tree's "request access" link (0 unless owner or admin). */
  accessRequestCount: number;
}

export interface TreeMember {
  id: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  role: TreeRole;
  since: string | null;
  /** The person this member is linked to in the tree, if any. */
  person: PersonRef | null;
  /** The branch this member may edit, when their editing is limited. */
  editScope: TreeAccess['editScope'];
}

// A member's link to "their" person is stored on the membership (MEMBER_OF.personId),
// so it is per tree. It only counts while that person still exists in the tree, which
// keeps deleted people from leaving dangling links. `m` is the membership, `t` the tree.
const MY_PERSON_CYPHER = `CASE WHEN EXISTS { (:Person {id: m.personId, treeId: t.id}) } THEN m.personId END`;

/** Cypher map of a TreeAccess; `m` is the caller's membership, `t` the tree. */
const TREE_ACCESS_CYPHER = `{
  id: t.id, name: t.name, role: m.role, settings: ${TREE_SETTINGS_CYPHER},
  myPersonId: ${MY_PERSON_CYPHER}, editScope: ${editScopeCypher('m', 't.id')}
}`;

/**
 * The signed-in user and, in the same round trip, their access to `treeId` (null
 * if not a member). Every /api/trees/:treeId request needs both, and each
 * database round trip costs real time, so requireAuth and loadTree share this.
 */
export async function findSessionUserWithTree(
  userId: string,
  treeId: string,
): Promise<{ user: AuthUser; passwordChangedAt: string | null; tree: TreeAccess | null } | null> {
  const [row] = await query<{ user: AuthUser; passwordChangedAt: string | null; tree: TreeAccess | null }>(
    `MATCH (u:User {id: $userId})
     OPTIONAL MATCH (u)-[m:MEMBER_OF]->(t:Tree {id: $treeId})
     RETURN u {${USER_FIELDS}} AS user, u.passwordChangedAt AS passwordChangedAt,
            CASE WHEN t IS NULL THEN null ELSE ${TREE_ACCESS_CYPHER} END AS tree`,
    { userId, treeId },
  );
  return row ?? null;
}

/**
 * Accounts created before shared trees existed have no Tree yet; this creates
 * their private tree and moves their people into it. Idempotent.
 */
export async function ensurePersonalTree(user: AuthUser, locale: Locale): Promise<void> {
  await query(
    `MATCH (u:User {id: $id})
     WHERE NOT EXISTS { (u)-[:MEMBER_OF {role: 'owner'}]->(:Tree) }
     CREATE (u)-[:MEMBER_OF {role: 'owner', since: $now}]->(t:Tree {id: randomUUID(), name: $treeName, createdAt: $now})
     WITH u, t
     CALL (u, t) {
       MATCH (p:Person {ownerId: u.id})
       SET p.treeId = t.id
       REMOVE p.ownerId
     }`,
    { id: user.id, now: new Date().toISOString(), treeName: personalTreeName(user.name, locale) },
    'WRITE',
  );
}

/** Registration is open, so the number of trees one account can own is capped. */
export const MAX_OWNED_TREES = 20;

/**
 * Creates another tree owned by the user (besides their private one). Returns its
 * id, or null when they already own MAX_OWNED_TREES trees.
 */
export async function createTree(userId: string, name: string): Promise<string | null> {
  const [row] = await query<{ id: string }>(
    `MATCH (u:User {id: $userId})
     WHERE COUNT { (u)-[:MEMBER_OF {role: 'owner'}]->(:Tree) } < $max
     CREATE (u)-[:MEMBER_OF {role: 'owner', since: $now}]->(t:Tree {id: randomUUID(), name: $name, createdAt: $now})
     RETURN t.id AS id`,
    { userId, name, max: MAX_OWNED_TREES, now: new Date().toISOString() },
    'WRITE',
  );
  return row?.id ?? null;
}

/**
 * Deletes a tree with its people, relationships, photos, invitations and
 * memberships. Returns false when there is no such tree. If it was the owner's
 * last tree, ensurePersonalTree gives them a new, empty one on their next load.
 */
export async function deleteTree(treeId: string): Promise<boolean> {
  const [row] = await query<{ photoRefs: string[] }>(
    `MATCH (t:Tree {id: $treeId})
     CALL (t) {
       OPTIONAL MATCH (ph:Photo {treeId: t.id})
       RETURN collect(ph.storageRef) AS photoRefs
     }
     CALL (t) { MATCH (p:Person {treeId: t.id}) DETACH DELETE p }
     CALL (t) { MATCH (ph:Photo {treeId: t.id}) DELETE ph }
     CALL (t) { MATCH (i:Invitation {treeId: t.id}) DELETE i }
     DETACH DELETE t
     RETURN photoRefs`,
    { treeId },
    'WRITE',
  );
  if (row) await removeStoredFiles(row.photoRefs);
  return Boolean(row);
}

/** Trees the user belongs to: their own first, then shared ones. */
export async function listTrees(userId: string): Promise<TreeSummary[]> {
  const rows = await query<{ tree: TreeSummary }>(
    `MATCH (:User {id: $userId})-[m:MEMBER_OF]->(t:Tree)
     OPTIONAL MATCH (owner:User)-[:MEMBER_OF {role: 'owner'}]->(t)
     RETURN {
       id: t.id, name: t.name, role: m.role,
       settings: ${TREE_SETTINGS_CYPHER},
       myPersonId: ${MY_PERSON_CYPHER},
       editScope: ${editScopeCypher('m', 't.id')},
       ownerName: coalesce(owner.name, owner.email),
       personCount: COUNT { (p:Person) WHERE p.treeId = t.id },
       memberCount: COUNT { (:User)-[:MEMBER_OF]->(t) },
       // Pending "request access" link requests; only the owner and admins can act on them.
       accessRequestCount: CASE WHEN m.role IN ['owner', 'admin'] THEN COUNT { (:User)-[:REQUESTS_ACCESS]->(t) } ELSE 0 END
     } AS tree
     ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END, toLower(t.name)`,
    { userId },
  );
  return rows.map((r) => r.tree);
}

export async function getTreeAccess(userId: string, treeId: string): Promise<TreeAccess | null> {
  const [row] = await query<{ tree: TreeAccess }>(
    `MATCH (:User {id: $userId})-[m:MEMBER_OF]->(t:Tree {id: $treeId})
     RETURN ${TREE_ACCESS_CYPHER} AS tree`,
    { userId, treeId },
  );
  return row?.tree ?? null;
}

export async function renameTree(treeId: string, name: string): Promise<void> {
  await query('MATCH (t:Tree {id: $treeId}) SET t.name = $name', { treeId, name }, 'WRITE');
}

export async function listMembers(treeId: string): Promise<TreeMember[]> {
  const rows = await query<{ member: TreeMember }>(
    `MATCH (u:User)-[m:MEMBER_OF]->(:Tree {id: $treeId})
     OPTIONAL MATCH (p:Person {id: m.personId, treeId: $treeId})
     RETURN {
       id: u.id, name: u.name, email: u.email, avatarUrl: u.avatarUrl, role: m.role, since: m.since,
       person: CASE WHEN p IS NULL THEN null ELSE p {.id, .firstName, .lastName} END,
       editScope: ${editScopeCypher('m', '$treeId')}
     } AS member
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'editor' THEN 2 ELSE 3 END,
              toLower(coalesce(u.name, u.email))`,
    { treeId },
  );
  return rows.map((r) => r.member);
}

/**
 * Links the user's membership of this tree to a person ("This is me"), replacing an
 * earlier link. Returns 'taken' when another member is already linked to that person.
 */
export async function linkMemberToPerson(
  treeId: string,
  userId: string,
  personId: string,
): Promise<'linked' | 'notFound' | 'taken'> {
  const [row] = await query<{ status: 'linked' | 'notFound' | 'taken' }>(
    `MATCH (u:User {id: $userId})-[m:MEMBER_OF]->(t:Tree {id: $treeId})
     OPTIONAL MATCH (p:Person {id: $personId, treeId: $treeId})
     OPTIONAL MATCH (other:User)-[om:MEMBER_OF {personId: $personId}]->(t)
     WHERE other <> u
     WITH m, p, count(other) AS others
     FOREACH (_ IN CASE WHEN p IS NOT NULL AND others = 0 THEN [1] ELSE [] END | SET m.personId = $personId)
     RETURN CASE WHEN p IS NULL THEN 'notFound' WHEN others > 0 THEN 'taken' ELSE 'linked' END AS status`,
    { treeId, userId, personId },
    'WRITE',
  );
  return row?.status ?? 'notFound';
}

export async function unlinkMember(treeId: string, userId: string): Promise<void> {
  await query(
    'MATCH (:User {id: $userId})-[m:MEMBER_OF]->(:Tree {id: $treeId}) REMOVE m.personId',
    { treeId, userId },
    'WRITE',
  );
}

type MemberRole = Exclude<TreeRole, 'owner'>;

/**
 * Changes a member's role, and for editors the branch they may edit (null: the
 * whole tree). Only members whose current role is in `manageable` are changed
 * (see manageableRoles in access.ts), so the owner's membership never is.
 */
export async function updateMemberRole(
  treeId: string,
  userId: string,
  role: MemberRole,
  scope: EditScope | null,
  manageable: MemberRole[],
): Promise<boolean> {
  const branch = role === 'editor' ? scope : null;
  const [row] = await query(
    `MATCH (:User {id: $userId})-[m:MEMBER_OF]->(:Tree {id: $treeId})
     WHERE m.role IN $manageable
     SET m.role = $role, m.scopeRootId = $scopeRootId, m.scopeDepth = $scopeDepth
     RETURN m.role AS role`,
    { treeId, userId, role, manageable, scopeRootId: branch?.rootId ?? null, scopeDepth: branch?.depth ?? null },
    'WRITE',
  );
  return Boolean(row);
}

/**
 * Removes a member whose role is in `manageable` (also used when a member leaves),
 * with their anniversary reminders for people in this tree. Never the owner.
 */
export async function removeMember(treeId: string, userId: string, manageable: MemberRole[]): Promise<boolean> {
  const [row] = await query<{ removed: number }>(
    `MATCH (u:User {id: $userId})-[m:MEMBER_OF]->(:Tree {id: $treeId})
     WHERE m.role IN $manageable
     CALL (u) { MATCH (u)-[r:REMINDS]->(:Person {treeId: $treeId}) DELETE r }
     DELETE m
     RETURN count(*) AS removed`,
    { treeId, userId, manageable },
    'WRITE',
  );
  return Boolean(row?.removed);
}

/**
 * Hands the tree over: `newOwnerId` (already a member) becomes its owner, and the
 * current owner stays on as an admin. Both changes happen in one statement, so a
 * tree never has two owners or none. Returns false when either membership is missing.
 *
 * The previous owner then owns no tree; ensurePersonalTree gives them a new, empty
 * private one the next time they load their trees.
 */
/**
 * Makes another member the owner (the previous owner becomes an admin). 'limit' when
 * they already own MAX_OWNED_TREES trees, the same cap as creating one.
 */
export async function transferOwnership(
  treeId: string,
  ownerId: string,
  newOwnerId: string,
): Promise<'ok' | 'notMember' | 'limit'> {
  const [row] = await query<{ transferred: boolean }>(
    `MATCH (:User {id: $ownerId})-[prev:MEMBER_OF {role: 'owner'}]->(t:Tree {id: $treeId}),
           (heirUser:User {id: $newOwnerId})-[heir:MEMBER_OF]->(t)
     WHERE $newOwnerId <> $ownerId
     WITH t, prev, heir, COUNT { (heirUser)-[:MEMBER_OF {role: 'owner'}]->(:Tree) } < $max AS allowed
     CALL (t, prev, heir, allowed) {
       WITH * WHERE allowed
       SET heir.role = 'owner', prev.role = 'admin'
       REMOVE heir.scopeRootId, heir.scopeDepth
     }
     RETURN allowed AS transferred`,
    { treeId, ownerId, newOwnerId, max: MAX_OWNED_TREES },
    'WRITE',
  );
  if (!row) return 'notMember';
  return row.transferred ? 'ok' : 'limit';
}

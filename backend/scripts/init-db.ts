// Creates the constraints and indexes the API relies on and migrates data
// from earlier versions. Safe to run repeatedly.
import { closeDriver, query } from '../src/db';

const schema = [
  'CREATE CONSTRAINT person_id_unique IF NOT EXISTS FOR (p:Person) REQUIRE p.id IS UNIQUE',
  'CREATE INDEX person_tree IF NOT EXISTS FOR (p:Person) ON (p.treeId)',
  'CREATE INDEX person_name IF NOT EXISTS FOR (p:Person) ON (p.lastName, p.firstName)',
  'CREATE CONSTRAINT tree_id_unique IF NOT EXISTS FOR (t:Tree) REQUIRE t.id IS UNIQUE',
  'CREATE CONSTRAINT user_id_unique IF NOT EXISTS FOR (u:User) REQUIRE u.id IS UNIQUE',
  'CREATE CONSTRAINT user_email_unique IF NOT EXISTS FOR (u:User) REQUIRE u.email IS UNIQUE',
  'CREATE INDEX user_verify_token IF NOT EXISTS FOR (u:User) ON (u.verifyTokenHash)',
  'CREATE INDEX user_reset_token IF NOT EXISTS FOR (u:User) ON (u.resetTokenHash)',
  'CREATE CONSTRAINT account_unique IF NOT EXISTS FOR (a:Account) REQUIRE (a.provider, a.providerAccountId) IS UNIQUE',
  'CREATE CONSTRAINT invitation_id_unique IF NOT EXISTS FOR (i:Invitation) REQUIRE i.id IS UNIQUE',
  'CREATE INDEX invitation_token IF NOT EXISTS FOR (i:Invitation) ON (i.tokenHash)',
  'CREATE INDEX invitation_email IF NOT EXISTS FOR (i:Invitation) ON (i.email)',
  'CREATE INDEX invitation_tree IF NOT EXISTS FOR (i:Invitation) ON (i.treeId)',
  'DROP CONSTRAINT settings_id_unique IF EXISTS',
  'CREATE CONSTRAINT photo_id_unique IF NOT EXISTS FOR (ph:Photo) REQUIRE ph.id IS UNIQUE',
  'CREATE INDEX photo_tree IF NOT EXISTS FOR (ph:Photo) ON (ph.treeId)',
  'CREATE INDEX person_photo IF NOT EXISTS FOR (p:Person) ON (p.photoUrl)',
  'DROP INDEX person_owner IF EXISTS',
];

const migrations: [string, string][] = [
  [
    'Remove the old app-wide settings (settings are now per tree)',
    `MATCH (s:Settings) DELETE s RETURN count(*) AS changed`,
  ],
  [
    'Remove account roles (no application-wide admin; each account manages only its own tree)',
    `MATCH (u:User) WHERE u.role IS NOT NULL REMOVE u.role RETURN count(u) AS changed`,
  ],
  [
    'Mark existing social-login emails as verified',
    `MATCH (u:User) WHERE u.email IS NOT NULL AND u.emailVerified IS NULL AND u.passwordHash IS NULL
     SET u.emailVerified = true RETURN count(u) AS changed`,
  ],
  [
    'Create a private tree for users without one',
    `MATCH (u:User) WHERE NOT EXISTS { (u)-[:MEMBER_OF {role: 'owner'}]->(:Tree) }
     CREATE (u)-[:MEMBER_OF {role: 'owner', since: $now}]->(t:Tree {
       id: randomUUID(),
       name: CASE WHEN u.name IS NULL OR trim(u.name) = '' THEN 'My family tree' ELSE trim(u.name) + "'s family tree" END,
       createdAt: $now
     })
     RETURN count(t) AS changed`,
  ],
  [
    'Move people from per-user ownership into trees',
    `MATCH (u:User)-[:MEMBER_OF {role: 'owner'}]->(t:Tree)
     WITH u, min(t.createdAt) AS first
     MATCH (u)-[:MEMBER_OF {role: 'owner'}]->(t:Tree {createdAt: first})
     WITH u, head(collect(t)) AS t
     MATCH (p:Person {ownerId: u.id})
     SET p.treeId = t.id
     REMOVE p.ownerId
     RETURN count(p) AS changed`,
  ],
  [
    'Give people from versions before trees existed to the oldest account',
    `MATCH (u:User) WITH u ORDER BY u.createdAt LIMIT 1
     MATCH (u)-[:MEMBER_OF {role: 'owner'}]->(t:Tree)
     WITH t ORDER BY t.createdAt LIMIT 1
     MATCH (p:Person) WHERE p.treeId IS NULL
     SET p.treeId = t.id
     REMOVE p.ownerId
     RETURN count(p) AS changed`,
  ],
];

async function main() {
  for (const statement of schema) {
    await query(statement, {}, 'WRITE');
    console.log(`✔ ${statement}`);
  }
  for (const [label, statement] of migrations) {
    const [row] = await query<{ changed: number }>(statement, { now: new Date().toISOString() }, 'WRITE');
    console.log(`✔ ${label}: ${row?.changed ?? 0}`);
  }
  const [{ orphans }] = await query<{ orphans: number }>(
    'MATCH (p:Person) WHERE p.treeId IS NULL RETURN count(p) AS orphans',
  );
  if (orphans > 0) {
    console.log(`ℹ ${orphans} people have no tree yet. Register an account, then run this again to give them to it.`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(closeDriver);

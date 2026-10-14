// Loads the sample Vietnamese family (src/trees/sampleFamily.ts) into one user's tree.
// Users can also do this themselves with "Load sample family" on an empty tree.
// Usage: npm run db:seed [-- --owner you@example.com] [--force]
import { closeDriver, query } from '../src/db';
import { addSampleFamily, countPeople } from '../src/trees/sampleFamily';

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  // The sample family goes into one user's tree: --owner <email>, or the oldest account.
  const ownerEmail = argValue('--owner')?.toLowerCase();
  const [owner] = await query<{ email: string | null; treeId: string }>(
    `${ownerEmail ? 'MATCH (u:User {email: $email})' : 'MATCH (u:User) WITH u ORDER BY u.createdAt LIMIT 1'}
     MATCH (u)-[:MEMBER_OF {role: 'owner'}]->(t:Tree)
     RETURN u.email AS email, t.id AS treeId
     ORDER BY t.createdAt LIMIT 1`,
    { email: ownerEmail ?? null },
  );
  if (!owner) {
    console.log(
      ownerEmail
        ? `No user with email ${ownerEmail} (or they haven't opened the app yet).`
        : 'No users yet. Register in the app first, then run: npm run db:seed [-- --owner you@example.com]',
    );
    return;
  }

  const force = process.argv.includes('--force');
  const count = await countPeople(owner.treeId);
  if (count > 0 && !force) {
    console.log(`That tree already has ${count} people. Re-run with --force to add the sample family anyway.`);
    return;
  }

  const summary = await addSampleFamily(owner.treeId, { force });
  console.log(
    `✔ Seeded ${summary.people} people, ${summary.parentLinks} parent links, ${summary.spouseLinks} marriages into ${owner.email ?? 'the owner'}'s private tree`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(closeDriver);

import { Router } from 'express';
import neo4j from 'neo4j-driver';
import { currentTreeId } from '../trees/access';
import { query, writeTransaction } from '../db';
import { HttpError, notFound } from '../errors';
import { assertNotBranchEditor, branchOf, outsideBranch } from '../trees/branch';
import { mergePeople } from '../trees/merge';
import { personSummary } from '../trees/summary';
import { releasePhotos } from '../trees/photos';
import { isTooYoungToBeParent, PARENT_AGE_CODES, PARENT_TOO_YOUNG_MESSAGE } from '../trees/rules';
import {
  personBulkDeleteSchema,
  personCreateWithLinkSchema,
  personMergeSchema,
  personUpdateSchema,
  type Person,
} from '../schemas';

// Mounted at /api/trees/:treeId/persons behind loadTree, so every query is
// scoped to that tree; people in other trees simply don't exist (404).
// Editors limited to a branch (trees/branch.ts) can only change people in it.
export const personsRouter = Router();

// GET /api/trees/:treeId/persons?search=smith&limit=100
personsRouter.get('/', async (req, res) => {
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  const limit = Math.min(Math.max(Number(req.query.limit) || 500, 1), 2000);

  const rows = await query<{ person: Person }>(
    `MATCH (p:Person {treeId: $treeId})
     WHERE $search = ''
        OR toLower(p.firstName + ' ' + coalesce(p.lastName, '')) CONTAINS toLower($search)
     RETURN p {.*} AS person
     ORDER BY toLower(coalesce(p.lastName, '')), toLower(p.firstName)
     LIMIT $limit`,
    { treeId: currentTreeId(req), search, limit: neo4j.int(limit) },
  );
  res.json(rows.map((r) => r.person));
});

// GET /api/trees/:treeId/persons/:id -> the person with all their details, their
// parents, children and spouses as summaries (trees/summary.ts), and whether the
// caller gets death anniversary reminders for them (remindMe)
personsRouter.get('/:id', async (req, res) => {
  const [row] = await query(
    `MATCH (p:Person {id: $id, treeId: $treeId})
     OPTIONAL MATCH (parent:Person {treeId: $treeId})-[:PARENT_OF]->(p)
     WITH p, collect(DISTINCT ${personSummary('parent')}) AS parents
     OPTIONAL MATCH (p)-[:PARENT_OF]->(child:Person {treeId: $treeId})
     WITH p, parents, collect(DISTINCT ${personSummary('child')}) AS children
     OPTIONAL MATCH (p)-[:SPOUSE_OF]-(spouse:Person {treeId: $treeId})
     RETURN p {.*} AS person, parents, children, collect(DISTINCT ${personSummary('spouse')}) AS spouses,
            EXISTS { (:User {id: $userId})-[:REMINDS]->(p) } AS remindMe`,
    { id: req.params.id, treeId: currentTreeId(req), userId: req.user!.id },
  );
  if (!row) throw notFound('Person');
  res.json(row);
});

// POST /api/trees/:treeId/persons { ...person, link?: { relation, personId } }
// With `link`, the new person is added as a parent, child or spouse of an existing
// one in the same transaction. Editors limited to a branch must use a link that
// keeps the new person inside it (a child or spouse of someone in the branch).
personsRouter.post('/', async (req, res) => {
  const { link, ...input } = personCreateWithLinkSchema.parse(req.body);
  const treeId = currentTreeId(req);

  const branch = await branchOf(req);
  if (branch) {
    const allowed =
      link?.relation === 'child'
        ? branch.canAddChild(link.personId)
        : link?.relation === 'spouse' && branch.canAddSpouse(link.personId);
    if (!allowed) throw outsideBranch();
  }

  if (link) {
    const [anchor] = await query<{ birthDate: string | null }>(
      'MATCH (p:Person {id: $id, treeId: $treeId}) RETURN p.birthDate AS birthDate',
      { id: link.personId, treeId },
    );
    if (!anchor) throw notFound('Person');
    const tooYoung =
      (link.relation === 'parent' && isTooYoungToBeParent(input.birthDate, anchor.birthDate)) ||
      (link.relation === 'child' && isTooYoungToBeParent(anchor.birthDate, input.birthDate));
    if (tooYoung) throw new HttpError(409, PARENT_TOO_YOUNG_MESSAGE, PARENT_AGE_CODES.link);
  }

  const person = await writeTransaction(async (run) => {
    const [row] = await run<{ person: Person }>(
      `CREATE (p:Person)
       SET p = $props,
           p.id = randomUUID(),
           p.treeId = $treeId,
           p.createdAt = toString(datetime()),
           p.updatedAt = p.createdAt
       RETURN p {.*} AS person`,
      { props: { gender: 'unknown', ...input }, treeId },
    );
    if (link) {
      const pattern = {
        parent: '(p)-[:PARENT_OF]->(other)',
        child: '(other)-[:PARENT_OF]->(p)',
        spouse: '(p)-[:SPOUSE_OF]->(other)',
      }[link.relation];
      const [linked] = await run(
        `MATCH (p:Person {id: $id, treeId: $treeId}), (other:Person {id: $otherId, treeId: $treeId})
         CREATE ${pattern}
         RETURN 1 AS linked`,
        { id: row.person.id, otherId: link.personId, treeId },
      );
      if (!linked) throw notFound('Person'); // deleted meanwhile; nothing is kept
    }
    return row.person;
  });
  res.status(201).json(person);
});

/** A new birth date must keep every parent at least MIN_PARENT_AGE years older than their child. */
async function checkParentAges(treeId: string, id: string, birthDate: string) {
  const [row] = await query<{ parentDates: string[]; childDates: string[] }>(
    `MATCH (p:Person {id: $id, treeId: $treeId})
     OPTIONAL MATCH (parent:Person {treeId: $treeId})-[:PARENT_OF]->(p)
     WITH p, collect(parent.birthDate) AS parentDates
     OPTIONAL MATCH (p)-[:PARENT_OF]->(child:Person {treeId: $treeId})
     RETURN parentDates, collect(child.birthDate) AS childDates`,
    { id, treeId },
  );
  if (!row) return; // the update itself answers 404
  if (row.parentDates.some((d) => isTooYoungToBeParent(d, birthDate))) {
    throw new HttpError(
      409,
      `${PARENT_TOO_YOUNG_MESSAGE}: this birth date is too close to a parent's`,
      PARENT_AGE_CODES.nearParent,
    );
  }
  if (row.childDates.some((d) => isTooYoungToBeParent(birthDate, d))) {
    throw new HttpError(
      409,
      `${PARENT_TOO_YOUNG_MESSAGE}: this birth date is too close to a child's`,
      PARENT_AGE_CODES.nearChild,
    );
  }
}

// Partial update; sending a field as null removes it.
// The schema strips unknown keys, so treeId/id can't be overwritten.
personsRouter.patch('/:id', async (req, res) => {
  const input = personUpdateSchema.parse(req.body);
  const treeId = currentTreeId(req);
  const branch = await branchOf(req);
  if (branch && !branch.includes(String(req.params.id))) throw outsideBranch();
  if (input.birthDate) await checkParentAges(treeId, String(req.params.id), input.birthDate);
  const [row] = await query<{ person: Person; oldPhotoUrl: string | null }>(
    `MATCH (p:Person {id: $id, treeId: $treeId})
     WITH p, p.photoUrl AS oldPhotoUrl
     SET p += $props, p.updatedAt = toString(datetime())
     RETURN p {.*} AS person, oldPhotoUrl`,
    { id: req.params.id, treeId, props: input },
    'WRITE',
  );
  if (!row) throw notFound('Person');
  if (row.oldPhotoUrl !== row.person.photoUrl) await releasePhotos(treeId, [row.oldPhotoUrl]);
  res.json(row.person);
});

// POST /api/trees/:treeId/persons/merge { keepId, removeId, fields? } -> the kept person
// Two records of the same person become one (see trees/merge.ts). Editors of the
// whole tree only: merging can move links across any branch.
personsRouter.post('/merge', async (req, res) => {
  assertNotBranchEditor(req);
  const { keepId, removeId, fields = {} } = personMergeSchema.parse(req.body);
  res.json(await mergePeople(currentTreeId(req), keepId, removeId, fields));
});

// POST /api/trees/:treeId/persons/delete { ids } -> { deleted }
// Deletes several people and their relationships. Ids that aren't in this tree are skipped.
// (A POST, because DELETE request bodies are poorly supported by proxies.)
personsRouter.post('/delete', async (req, res) => {
  // A per-tree setting, loaded with the caller's access by loadTree.
  if (!req.tree!.settings.bulkDelete) {
    throw new HttpError(403, 'Deleting several people at once is turned off for this tree', 'bulkDeleteDisabled');
  }
  const { ids } = personBulkDeleteSchema.parse(req.body);
  const treeId = currentTreeId(req);
  const branch = await branchOf(req);
  if (branch && ids.some((id) => !branch.canDelete(id))) throw outsideBranch();
  const [row] = await query<{ deleted: number; photoUrls: string[] }>(
    `MATCH (p:Person {treeId: $treeId})
     WHERE p.id IN $ids
     WITH p, p.id AS id, p.photoUrl AS photoUrl
     DETACH DELETE p
     RETURN count(id) AS deleted, collect(photoUrl) AS photoUrls`,
    { ids: [...new Set(ids)], treeId },
    'WRITE',
  );
  await releasePhotos(treeId, row?.photoUrls ?? []);
  res.json({ deleted: row?.deleted ?? 0 });
});

personsRouter.delete('/:id', async (req, res) => {
  const treeId = currentTreeId(req);
  const branch = await branchOf(req);
  if (branch && !branch.canDelete(String(req.params.id))) throw outsideBranch();
  const [row] = await query<{ id: string; photoUrl: string | null }>(
    `MATCH (p:Person {id: $id, treeId: $treeId})
     WITH p, p.id AS id, p.photoUrl AS photoUrl
     DETACH DELETE p
     RETURN id, photoUrl`,
    { id: req.params.id, treeId },
    'WRITE',
  );
  if (!row) throw notFound('Person');
  await releasePhotos(treeId, [row.photoUrl]);
  res.status(204).end();
});

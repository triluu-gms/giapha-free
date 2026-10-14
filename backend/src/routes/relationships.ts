import { Router } from 'express';
import { currentTreeId } from '../trees/access';
import { query, writeTransaction } from '../db';
import { HttpError, notFound } from '../errors';
import { relationshipSchema } from '../schemas';
import { branchOf, loadBranch, outsideBranch } from '../trees/branch';
import { isTooYoungToBeParent, PARENT_AGE_CODES, PARENT_TOO_YOUNG_MESSAGE } from '../trees/rules';

export const relationshipsRouter = Router();

// POST /api/trees/:treeId/relationships { type: 'PARENT_OF' | 'SPOUSE_OF', fromId, toId }
// PARENT_OF is directional (fromId is the parent); SPOUSE_OF is symmetric.
// Both people must belong to the same tree, and to the caller's branch when they are limited to one.
relationshipsRouter.post('/', async (req, res) => {
  const { type, fromId, toId } = relationshipSchema.parse(req.body);
  if (fromId === toId) throw new HttpError(400, 'A person cannot be related to themselves');
  const params = { fromId, toId, treeId: currentTreeId(req) };
  const branch = await branchOf(req);
  if (branch && !branch.canLink(type, fromId, toId)) throw outsideBranch();

  const [check] = await query<{ found: number; cycle: boolean; fromBirth: string | null; toBirth: string | null }>(
    `OPTIONAL MATCH (a:Person {id: $fromId, treeId: $treeId})
     OPTIONAL MATCH (b:Person {id: $toId, treeId: $treeId})
     RETURN count(a) + count(b) AS found,
            coalesce(EXISTS { (b)-[:PARENT_OF*1..]->(a) }, false) AS cycle,
            a.birthDate AS fromBirth, b.birthDate AS toBirth`,
    params,
  );
  if (check.found < 2) throw notFound('Person');

  if (type === 'PARENT_OF') {
    if (check.cycle) throw new HttpError(409, 'This would make a person their own ancestor');
    if (isTooYoungToBeParent(check.fromBirth, check.toBirth)) {
      throw new HttpError(409, PARENT_TOO_YOUNG_MESSAGE, PARENT_AGE_CODES.link);
    }
    await writeTransaction(async (run) => {
      await run(
        `MATCH (parent:Person {id: $fromId, treeId: $treeId}), (child:Person {id: $toId, treeId: $treeId})
         MERGE (parent)-[:PARENT_OF]->(child)`,
        params,
      );
      // A new parent link can shorten the way down from the branch's root, so that
      // descendants who were too many generations below it would now be in the branch.
      // The link is only kept if the branch covers nobody new.
      if (branch) {
        const after = await loadBranch(params.treeId, branch.scope, run);
        if ([...after.levels.keys()].some((id) => !branch.includes(id))) throw outsideBranch();
      }
    });
  } else {
    await query(
      `MATCH (a:Person {id: $fromId, treeId: $treeId}), (b:Person {id: $toId, treeId: $treeId})
       MERGE (a)-[:SPOUSE_OF]-(b)`,
      params,
      'WRITE',
    );
  }
  res.status(201).json({ type, fromId, toId });
});

// DELETE /api/trees/:treeId/relationships?type=PARENT_OF&fromId=...&toId=...
relationshipsRouter.delete('/', async (req, res) => {
  const { type, fromId, toId } = relationshipSchema.parse(req.query);
  const branch = await branchOf(req);
  if (branch && !branch.canLink(type, fromId, toId)) throw outsideBranch();
  const pattern =
    type === 'PARENT_OF'
      ? '(:Person {id: $fromId, treeId: $treeId})-[r:PARENT_OF]->(:Person {id: $toId, treeId: $treeId})'
      : '(:Person {id: $fromId, treeId: $treeId})-[r:SPOUSE_OF]-(:Person {id: $toId, treeId: $treeId})';

  const [row] = await query<{ deleted: number }>(
    `MATCH ${pattern} DELETE r RETURN count(*) AS deleted`,
    { fromId, toId, treeId: currentTreeId(req) },
    'WRITE',
  );
  if (!row?.deleted) throw notFound('Relationship');
  res.status(204).end();
});

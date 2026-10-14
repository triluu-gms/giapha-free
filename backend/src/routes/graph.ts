import { Router } from 'express';
import { currentTreeId } from '../trees/access';
import { query } from '../db';
import { notFound } from '../errors';
import { personSummary } from '../trees/summary';

export const graphRouter = Router();

type TreeEdge = { type: 'PARENT_OF' | 'SPOUSE_OF'; from: string; to: string };
/** A person's summary (trees/summary.ts): what the cards, the layout and kinship terms need. */
type PersonSummary = { id: string } & Record<string, unknown>;

// GET /api/trees/:treeId/graph                     -> everyone in the tree
// GET /api/trees/:treeId/graph?rootId=...&depth=3  -> people within `depth` family hops of rootId
// People come as summaries; the rest of a person's details load with GET /persons/:id when clicked.
graphRouter.get('/', async (req, res) => {
  const rootId = typeof req.query.rootId === 'string' && req.query.rootId ? req.query.rootId : null;
  const depth = Math.min(Math.max(Number.parseInt(String(req.query.depth ?? '3'), 10) || 3, 1), 8);

  // Variable-length bounds cannot be parameters; depth is a clamped integer.
  // Relationships only ever join people in the same tree, but filter by tree
  // anyway so a traversal can never surface another tree's data.
  // RETURN DISTINCT lets Neo4j expand breadth-first and visit each person once,
  // instead of enumerating every path (which grows exponentially with depth).
  const selectPeople = rootId
    ? `CALL () {
         MATCH (:Person {id: $rootId, treeId: $treeId})-[:PARENT_OF|SPOUSE_OF*0..${depth}]-(n:Person {treeId: $treeId})
         RETURN DISTINCT n
       }
       WITH collect(n) AS people`
    : `MATCH (n:Person {treeId: $treeId})
       WITH collect(n) AS people`;

  // Edges leaving the selected people; the ones that end outside them are dropped
  // below with a Set (a Cypher `b IN people` check is a list scan per edge).
  const [row] = await query<{ nodes: PersonSummary[]; edges: TreeEdge[] }>(
    `${selectPeople}
     RETURN [p IN people | ${personSummary('p')}] AS nodes,
            COLLECT {
              UNWIND people AS a
              MATCH (a)-[r:PARENT_OF|SPOUSE_OF]->(b:Person {treeId: $treeId})
              RETURN {type: type(r), from: a.id, to: b.id}
            } AS edges`,
    { rootId, treeId: currentTreeId(req) },
  );

  const nodes = row?.nodes ?? [];
  if (rootId && !nodes.length) throw notFound('Person');
  const ids = new Set(nodes.map((p) => p.id));
  res.json({ nodes, edges: rootId ? (row?.edges ?? []).filter((e) => ids.has(e.to)) : (row?.edges ?? []) });
});

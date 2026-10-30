import type { Request } from 'express';
import { query, type Run } from '../db';
import { HttpError } from '../errors';
import { BRANCH_MAX_DEPTH, type EditScope } from '../schemas';

// An editor can be limited to one branch of a tree: a person (the branch's root),
// their descendants down to `depth` generations below them, and the spouses of
// all of those. Such an editor still sees the whole tree; owners, viewers and
// other editors are not affected. The branch is stored on the membership
// (MEMBER_OF.scopeRootId / scopeDepth) and on the invitation that grants it.

export type { EditScope };

/**
 * Cypher map of the branch kept on `holder` (a MEMBER_OF relationship or an
 * Invitation), with its root person for display; null when editing isn't limited.
 * `root` is null once that person has been deleted.
 */
export const editScopeCypher = (holder: string, treeId: string) =>
  `CASE WHEN ${holder}.role = 'editor' AND ${holder}.scopeRootId IS NOT NULL THEN {
     rootId: ${holder}.scopeRootId,
     depth: ${holder}.scopeDepth,
     root: head(COLLECT {
       MATCH (sp:Person {id: ${holder}.scopeRootId, treeId: ${treeId}}) RETURN sp {.id, .firstName, .lastName}
     })
   } END`;

export const outsideBranch = () =>
  new HttpError(403, 'You can only change people in your branch of this tree', 'outsideBranch');

/** The people one branch covers and what its editor may do with each of them. */
export class Branch {
  constructor(
    readonly scope: EditScope,
    /** Person id -> generations below the root, or null for someone who is in it only as a spouse. */
    readonly levels: Map<string, number | null>,
    /**
     * Spouses who also belong elsewhere in the tree: they have parents, children or
     * other spouses outside the branch. They can be linked to, but not edited or
     * deleted: deleting one would cut their family elsewhere off from them.
     */
    readonly readOnly: Set<string> = new Set(),
  ) {}

  includes(id: string): boolean {
    return this.levels.has(id);
  }

  /** People of the branch, except spouses who also belong to the rest of the tree. */
  canEdit(id: string): boolean {
    return this.includes(id) && !this.readOnly.has(id);
  }

  /** The root can be edited but not deleted, or the branch would be gone. */
  canDelete(id: string): boolean {
    return this.canEdit(id) && id !== this.scope.rootId;
  }

  /** A new child must still be within the branch's depth. */
  canAddChild(id: string): boolean {
    const level = this.levels.get(id);
    return typeof level === 'number' && level < this.scope.depth;
  }

  canAddSpouse(id: string): boolean {
    return typeof this.levels.get(id) === 'number';
  }

  /** Links between two people of the branch, except giving its root a parent. */
  canLink(type: 'PARENT_OF' | 'SPOUSE_OF', fromId: string, toId: string): boolean {
    return this.includes(fromId) && this.includes(toId) && (type === 'SPOUSE_OF' || toId !== this.scope.rootId);
  }
}

export async function loadBranch(treeId: string, scope: EditScope, run: Run = query): Promise<Branch> {
  // Variable-length bounds can't be parameters; depth is a clamped integer.
  const depth = Math.min(Math.max(Math.trunc(scope.depth), 0), BRANCH_MAX_DEPTH);
  const rows = await run<{ id: string; level: number; spouses: string[] }>(
    `MATCH (root:Person {id: $rootId, treeId: $treeId})
     MATCH path = (root)-[:PARENT_OF*0..${depth}]->(d:Person {treeId: $treeId})
     WITH d, min(length(path)) AS level
     OPTIONAL MATCH (d)-[:SPOUSE_OF]-(s:Person {treeId: $treeId})
     RETURN d.id AS id, level, collect(s.id) AS spouses`,
    { rootId: scope.rootId, treeId },
  );
  const levels = new Map<string, number | null>(rows.map((r) => [r.id, r.level]));
  for (const row of rows) {
    for (const spouse of row.spouses) if (!levels.has(spouse)) levels.set(spouse, null);
  }

  // Spouses with relatives outside the branch belong to another part of the family too.
  const spousesOnly = [...levels].filter(([, level]) => level === null).map(([id]) => id);
  const readOnly = new Set<string>();
  if (spousesOnly.length) {
    const ties = await run<{ id: string; relatives: string[] }>(
      `UNWIND $ids AS id
       MATCH (s:Person {id: id, treeId: $treeId})
       RETURN id, COLLECT { MATCH (s)-[:PARENT_OF|SPOUSE_OF]-(o:Person {treeId: $treeId}) RETURN o.id } AS relatives`,
      { ids: spousesOnly, treeId },
    );
    for (const { id, relatives } of ties) {
      if (relatives.some((other) => !levels.has(other))) readOnly.add(id);
    }
  }
  return new Branch(scope, levels, readOnly);
}

/** The caller's branch in the current tree (routes behind loadTree), or null when their editing isn't limited. */
export async function branchOf(req: Request): Promise<Branch | null> {
  const scope = req.tree?.editScope;
  return scope && req.tree ? loadBranch(req.tree.id, scope) : null;
}

/** For bulk changes (import) that can't be checked person by person. */
export function assertNotBranchEditor(req: Request) {
  if (req.tree?.editScope) throw outsideBranch();
}

/** A branch must start from a person in this tree. */
export async function assertBranchRoot(treeId: string, scope: EditScope | null) {
  if (!scope) return;
  const [found] = await query('MATCH (p:Person {id: $rootId, treeId: $treeId}) RETURN 1 AS found', {
    rootId: scope.rootId,
    treeId,
  });
  if (!found) throw new HttpError(400, 'Choose a person in this tree for the branch', 'branchRootMissing');
}

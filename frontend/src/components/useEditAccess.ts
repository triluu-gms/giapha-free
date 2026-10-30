'use client';

import { useEffect, useMemo, useState } from 'react';
import type { RelationshipType } from '@/lib/types';
import { useCurrentTree } from './TreeProvider';

/** What the signed-in user may change in the current tree, person by person. */
export interface EditAccess {
  canEditPerson: (id: string) => boolean;
  canDeletePerson: (id: string) => boolean;
  canAddChild: (id: string) => boolean;
  canAddSpouse: (id: string) => boolean;
  /** Adding a person who isn't linked to anyone (only for editors of the whole tree). */
  canAddUnlinked: boolean;
  canLink: (type: RelationshipType, fromId: string, toId: string) => boolean;
}

const yes = () => true;
const no = () => false;
const FULL: EditAccess = {
  canEditPerson: yes,
  canDeletePerson: yes,
  canAddChild: yes,
  canAddSpouse: yes,
  canAddUnlinked: true,
  canLink: yes,
};
const NONE: EditAccess = {
  canEditPerson: no,
  canDeletePerson: no,
  canAddChild: no,
  canAddSpouse: no,
  canAddUnlinked: false,
  canLink: no,
};

/**
 * Owners and editors of the whole tree may change anyone; viewers nobody. An
 * editor limited to a branch may change its people (mirroring the API's rules in
 * trees/branch.ts, which has the final say). Pass a value that changes whenever
 * the tree does, so the branch is reloaded after people are added or linked.
 */
export function useEditAccess(version: unknown = 0): EditAccess {
  const { tree, treeApi, canEdit, branchOnly } = useCurrentTree();
  // Reload when the branch itself changes (picked up by refreshTrees).
  const scopeKey = tree.editScope ? `${tree.editScope.rootId}:${tree.editScope.depth}` : null;
  const [branch, setBranch] = useState<{
    rootId: string;
    depth: number;
    levels: Map<string, number | null>;
    /** Spouses who also belong elsewhere in the tree: linkable, not editable. */
    readOnly: Set<string>;
  } | null>(null);

  useEffect(() => {
    if (!branchOnly) return;
    let cancelled = false;
    treeApi
      .getBranch()
      .then((info) => {
        if (cancelled || !info.scope) return;
        setBranch({
          rootId: info.scope.rootId,
          depth: info.scope.depth,
          levels: new Map(info.people.map((p) => [p.id, p.level])),
          readOnly: new Set(info.people.filter((p) => p.readOnly).map((p) => p.id)),
        });
      })
      .catch(() => !cancelled && setBranch(null));
    return () => {
      cancelled = true;
    };
  }, [treeApi, branchOnly, scopeKey, version]);

  return useMemo(() => {
    if (!canEdit) return NONE;
    if (!branchOnly) return FULL;
    if (!branch) return NONE; // still loading
    const { rootId, depth, levels, readOnly } = branch;
    const level = (id: string) => levels.get(id);
    const editable = (id: string) => levels.has(id) && !readOnly.has(id);
    return {
      canEditPerson: editable,
      canDeletePerson: (id) => editable(id) && id !== rootId,
      canAddChild: (id) => {
        const l = level(id);
        return typeof l === 'number' && l < depth;
      },
      canAddSpouse: (id) => typeof level(id) === 'number',
      canAddUnlinked: false,
      canLink: (type, fromId, toId) =>
        levels.has(fromId) && levels.has(toId) && (type === 'SPOUSE_OF' || toId !== rootId),
    };
  }, [canEdit, branchOnly, branch]);
}

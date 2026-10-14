import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { query, writeTransaction } from '../db';
import { importRowSchema } from '../schemas';
import { isTooYoungToBeParent, PARENT_AGE_CODES, PARENT_TOO_YOUNG_MESSAGE } from './rules';

type ImportRow = z.infer<typeof importRowSchema>;

export interface ImportIssue {
  /** Spreadsheet row number (the header is row 1). */
  row: number;
  field?: string;
  message: string;
  /** Set when the frontend has its own translation for the message. */
  code?: string;
}

export interface ImportSummary {
  /** New people created. */
  people: number;
  /** Rows that stood for people already in the tree (see `matches`). */
  matched: number;
  parentLinks: number;
  spouseLinks: number;
}

export interface ImportPlan extends ImportSummary {
  nodes: { id: string; props: Record<string, unknown> }[];
  parents: { from: string; to: string }[];
  spouses: { a: string; b: string }[];
}

/** Someone already in the tree who may be the person on a row. */
export interface ImportCandidate {
  id: string;
  firstName: string;
  lastName: string | null;
  birthDate: string | null;
  deathDate: string | null;
  /** Same name and same birth year; weaker matches only share the name. */
  strong: boolean;
}

/** The tree's people and parent links, for matching rows and checking links against them. */
export interface ExistingTree {
  people: Map<string, Omit<ImportCandidate, 'strong'>>;
  /** parent id -> child ids */
  childrenOf: Map<string, string[]>;
}

const MAX_ISSUES = 200;
const MAX_CANDIDATES = 5;

// Keys are matched case-insensitively, so "P1" and "p1" are the same person.
const norm = (key: string) => key.trim().toLowerCase();

/** Appends to the list under `key` (in place; spreading a new array each time is quadratic). */
function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** Partial dates compare on their common precision ("1950" vs "1950-03" is not an error). */
function isBefore(a: string, b: string): boolean {
  const n = Math.min(a.length, b.length);
  return a.slice(0, n) < b.slice(0, n);
}

/**
 * A name as a sorted list of accent-free words, so "Nguyễn | Văn An" and
 * "Nguyễn Văn | An" (split differently between the columns) are the same name.
 */
const nameKey = (p: { firstName: string; lastName?: string | null }) =>
  `${p.lastName ?? ''} ${p.firstName}`
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');

export async function loadExistingTree(treeId: string): Promise<ExistingTree> {
  const [row] = await query<{ people: Omit<ImportCandidate, 'strong'>[]; links: { from: string; to: string }[] }>(
    `RETURN COLLECT {
              MATCH (p:Person {treeId: $treeId})
              RETURN p {.id, .firstName, lastName: p.lastName, birthDate: p.birthDate, deathDate: p.deathDate}
            } AS people,
            COLLECT {
              MATCH (a:Person {treeId: $treeId})-[:PARENT_OF]->(b:Person {treeId: $treeId})
              RETURN {from: a.id, to: b.id}
            } AS links`,
    { treeId },
  );
  const childrenOf = new Map<string, string[]>();
  for (const { from, to } of row?.links ?? []) pushTo(childrenOf, from, to);
  return { people: new Map((row?.people ?? []).map((p) => [p.id, p])), childrenOf };
}

/** For each row (by key), people already in the tree who may be the same person. */
function findCandidates(rows: ImportRow[], existing: ExistingTree): Record<string, ImportCandidate[]> {
  const byName = new Map<string, Omit<ImportCandidate, 'strong'>[]>();
  for (const p of existing.people.values()) pushTo(byName, nameKey(p), p);
  const result: Record<string, ImportCandidate[]> = {};
  for (const r of rows) {
    const rowYear = r.birthDate?.slice(0, 4);
    const found = (byName.get(nameKey(r)) ?? [])
      .map((p) => {
        const year = p.birthDate?.slice(0, 4);
        // Both birth years known and different: not the same person.
        return rowYear && year && rowYear !== year ? null : { ...p, strong: !!rowYear && rowYear === year };
      })
      .filter((p): p is ImportCandidate => p !== null)
      .sort((a, b) => Number(b.strong) - Number(a.strong))
      .slice(0, MAX_CANDIDATES);
    if (found.length) result[norm(r.key)] = found;
  }
  return result;
}

/**
 * Checks every row and the links between them. Returns the problems found (with
 * spreadsheet row numbers), or a plan that can be written as is, plus the people
 * already in the tree each row may be.
 *
 * `matches` maps a row's ID to a person already in the tree: that row isn't
 * created, and links to the row link to that person instead, so a file can add a
 * branch under people already in the tree. Links and the age rule are then
 * checked against the tree as it is.
 */
export function planImport(
  input: unknown[],
  existing: ExistingTree,
  matches: Record<string, string> = {},
): { issues: ImportIssue[]; plan: ImportPlan | null; candidates: Record<string, ImportCandidate[]> } {
  const issues: ImportIssue[] = [];
  const add = (issue: ImportIssue) => {
    if (issues.length < MAX_ISSUES) issues.push(issue);
  };

  // 1. Each row on its own.
  const rows: ImportRow[] = [];
  input.forEach((raw, index) => {
    const fallbackRow = index + 2;
    const parsed = importRowSchema.safeParse(raw);
    if (!parsed.success) {
      const row = typeof (raw as { row?: unknown })?.row === 'number' ? (raw as { row: number }).row : fallbackRow;
      for (const issue of parsed.error.issues) add({ row, field: issue.path.join('.') || undefined, message: issue.message });
      return;
    }
    const r = parsed.data;
    if (r.birthDate && r.deathDate && isBefore(r.deathDate, r.birthDate)) {
      add({ row: r.row, field: 'deathDate', message: 'Death date is before birth date' });
    }
    rows.push(r);
  });

  // 2. IDs must be unique.
  const byKey = new Map<string, ImportRow>();
  for (const r of rows) {
    const key = norm(r.key);
    const first = byKey.get(key);
    if (first) add({ row: r.row, field: 'key', message: `ID "${r.key}" is already used on row ${first.row}` });
    else byKey.set(key, r);
  }

  // 3. Rows matched to people already in the tree: each person at most once.
  const matchedTo = new Map<string, string>(); // row key -> existing person id
  const usedBy = new Map<string, ImportRow>(); // existing person id -> row
  for (const [rawKey, personId] of Object.entries(matches)) {
    const r = byKey.get(norm(rawKey));
    if (!r) continue; // a row that failed to parse, already reported
    if (!existing.people.has(personId)) {
      add({ row: r.row, message: 'The person this row was matched with is no longer in the tree', code: 'importMatchGone' });
    } else if (usedBy.has(personId)) {
      add({
        row: r.row,
        message: `Row ${usedBy.get(personId)!.row} is already matched with the same person`,
        code: 'importMatchTwice',
      });
    } else {
      matchedTo.set(norm(r.key), personId);
      usedBy.set(personId, r);
    }
  }

  // 4. References must point at other rows.
  const ids = new Map<string, string>([...byKey.keys()].map((key) => [key, matchedTo.get(key) ?? randomUUID()]));
  const rowOfId = new Map<string, ImportRow>([...byKey].map(([key, r]) => [ids.get(key)!, r]));
  // A matched row stands for the person in the tree, so their recorded birth date counts.
  const birthOf = (key: string) =>
    matchedTo.has(key) ? existing.people.get(matchedTo.get(key)!)!.birthDate : byKey.get(key)!.birthDate;
  const parents: { from: string; to: string }[] = [];
  const spousePairs = new Map<string, { a: string; b: string }>();

  const resolve = (r: ImportRow, field: string, ref: string): string | null => {
    const key = norm(ref);
    if (key === norm(r.key)) {
      add({ row: r.row, field, message: 'A person cannot be related to themselves' });
      return null;
    }
    if (!byKey.has(key)) {
      add({ row: r.row, field, message: `No row has the ID "${ref}"` });
      return null;
    }
    return key;
  };

  for (const r of rows) {
    const self = norm(r.key);
    if (byKey.get(self) !== r) continue; // duplicate ID, already reported

    const father = r.fatherKey ? resolve(r, 'fatherKey', r.fatherKey) : null;
    const mother = r.motherKey ? resolve(r, 'motherKey', r.motherKey) : null;
    if (father && father === mother) {
      add({ row: r.row, field: 'motherKey', message: 'Father and mother are the same person' });
    }
    for (const [field, parent] of [['fatherKey', father], ['motherKey', mother === father ? null : mother]] as const) {
      if (!parent) continue;
      if (isTooYoungToBeParent(birthOf(parent), birthOf(self))) {
        add({ row: r.row, field, message: PARENT_TOO_YOUNG_MESSAGE, code: PARENT_AGE_CODES.link });
      }
      parents.push({ from: ids.get(parent)!, to: ids.get(self)! });
    }

    for (const ref of r.spouseKeys ?? []) {
      const spouse = resolve(r, 'spouseKeys', ref);
      if (!spouse) continue;
      // Listed on one side or both, it's one marriage.
      const pair = [ids.get(self)!, ids.get(spouse)!].sort();
      spousePairs.set(pair.join('\n'), { a: pair[0], b: pair[1] });
    }
  }

  // 5. Nobody may be their own ancestor, counting the tree's links when rows stand
  // for people in it (iterative DFS: white/grey/black, over person ids).
  // Copies of the tree's lists, so adding the file's links leaves `existing` as it was.
  const childrenOf = new Map<string, string[]>(
    matchedTo.size ? [...existing.childrenOf].map(([id, kids]) => [id, [...kids]]) : [],
  );
  for (const { from, to } of parents) pushTo(childrenOf, from, to);
  const state = new Map<string, 1 | 2>();
  for (const start of childrenOf.keys()) {
    if (state.has(start)) continue;
    const stack: { id: string; next: number }[] = [{ id: start, next: 0 }];
    state.set(start, 1);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const children = childrenOf.get(top.id) ?? [];
      if (top.next >= children.length) {
        state.set(top.id, 2);
        stack.pop();
        continue;
      }
      const child = children[top.next++];
      if (state.get(child) === 1) {
        // Report it on a row of the loop (the tree alone has none, so the file is in it).
        const loop = [child, ...stack.map((s) => s.id).reverse()];
        const row = loop.map((id) => rowOfId.get(id)).find(Boolean);
        add({ row: row?.row ?? 0, message: 'These parent links make a person their own ancestor' });
        stack.length = 0;
      } else if (!state.has(child)) {
        state.set(child, 1);
        stack.push({ id: child, next: 0 });
      }
    }
  }

  const candidates = findCandidates([...byKey.values()], existing);

  if (issues.length) return { issues: issues.sort((a, b) => a.row - b.row), plan: null, candidates };

  const nodes = [...byKey.entries()]
    .filter(([key]) => !matchedTo.has(key))
    .map(([key, r]) => {
      const { row: _row, key: _key, fatherKey: _f, motherKey: _m, spouseKeys: _s, ...person } = r;
      // Empty cells arrive as null/undefined; leave those properties unset.
      const props = Object.fromEntries(Object.entries(person).filter(([, v]) => v != null && v !== ''));
      return { id: ids.get(key)!, props: { gender: 'unknown', ...props } };
    });
  const spouses = [...spousePairs.values()];
  return {
    issues: [],
    plan: {
      nodes,
      parents,
      spouses,
      people: nodes.length,
      matched: matchedTo.size,
      parentLinks: parents.length,
      spouseLinks: spouses.length,
    },
    candidates,
  };
}

/**
 * Writes a plan into the tree in one transaction. Links use MERGE, so a link
 * between people already in the tree that already exists isn't doubled.
 */
export async function runImport(treeId: string, plan: ImportPlan): Promise<ImportSummary> {
  const now = new Date().toISOString();
  await writeTransaction(async (run) => {
    await run(
      `UNWIND $nodes AS node
       CREATE (p:Person)
       SET p = node.props, p.id = node.id, p.treeId = $treeId, p.createdAt = $now, p.updatedAt = $now`,
      { nodes: plan.nodes, treeId, now },
    );
    await run(
      `UNWIND $links AS link
       MATCH (parent:Person {id: link.from, treeId: $treeId}), (child:Person {id: link.to, treeId: $treeId})
       MERGE (parent)-[:PARENT_OF]->(child)`,
      { links: plan.parents, treeId },
    );
    await run(
      `UNWIND $links AS link
       MATCH (a:Person {id: link.a, treeId: $treeId}), (b:Person {id: link.b, treeId: $treeId})
       MERGE (a)-[:SPOUSE_OF]-(b)`,
      { links: plan.spouses, treeId },
    );
  });
  const { people, matched, parentLinks, spouseLinks } = plan;
  return { people, matched, parentLinks, spouseLinks };
}

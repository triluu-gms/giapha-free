// Positions and lines for the family tree view. Pure (no React), so it can be tested on its own.
//
// The base is a family-tree layout: spouses form a household placed as one
// block, each household gets a generation (đời), and branches are packed
// bottom-up (Reingold–Tilford style) with parents centred over their children.
// Three options make large trees compact; with all of them off and top-down
// it is the classic one-row-per-đời layout:
//  - couplesStacked: the spouse sits under the family member, so a married
//    household is one card wide instead of two (top-down only; left-to-right
//    always stacks couples, since a đời is a column there);
//  - stackSiblings: brothers and sisters with no children in the tree hang in
//    short columns from one line instead of a long row;
//  - wrapChi: each founder's child's branch (a chi) is its own block, and the
//    blocks wrap onto rows that roughly match the screen's shape.
// And a direction: generations top-down (rows) or left-to-right (columns).
// The algorithm works in "breadth" (across a đời) and "depth" (from one đời
// to the next) and maps them to x/y at the end.

import type { TreeData } from './types';

export const NODE_W = 190;
export const NODE_H = 64;

export interface LayoutOptions {
  direction: 'down' | 'right';
  couplesStacked: boolean;
  stackSiblings: boolean;
  wrapChi: boolean;
}

export type Point = { x: number; y: number };

export interface TreeLayout {
  /** Top-left corner of each person's card. */
  positions: Map<string, Point>;
  /** Parent -> child lines, as polylines (source: a parent, target: the child). */
  links: { id: string; source: string; target: string; points: Point[] }[];
  /** Marriage lines, from one partner's card centre to the other's (drawn under the cards). */
  couples: { id: string; source: string; target: string; points: Point[] }[];
  /** With wrapChi: each chi's frame, and the family member it starts from. */
  chi: { id: string; root: string; x: number; y: number; width: number; height: number }[];
}

/** Most brothers and sisters in one stacked column. */
const MAX_STACK = 4;

type Bd = { b: number; d: number };

/** Disjoint-set over string ids, used to group spouses into households and households into families. */
function disjointSet() {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const p = parent.get(id) ?? id;
    if (p === id) return id;
    const root = find(p);
    parent.set(id, root);
    return root;
  };
  return { find, union: (a: string, b: string) => parent.set(find(a), find(b)) };
}

/** Appends to the list under `key` (in place; spreading a new array each time is quadratic). */
function pushTo<V>(map: Map<string, V[]>, key: string, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/**
 * Order of a household so every couple sits together. A chain (A–B–C) is
 * walked from one end, starting with a man so couples read husband–wife.
 * Someone with three or more spouses sits in the middle.
 */
function orderHousehold(members: string[], spousesOf: Map<string, Set<string>>, gender: (id: string) => string) {
  if (members.length === 1) return members;
  const inHousehold = new Set(members);
  const partners = (id: string) => [...(spousesOf.get(id) ?? [])].filter((m) => inHousehold.has(m));
  const hub = members.reduce((a, b) => (partners(b).length > partners(a).length ? b : a));
  if (partners(hub).length > 2) {
    const others = members.filter((m) => m !== hub);
    const half = Math.ceil(others.length / 2);
    return [...others.slice(0, half).reverse(), hub, ...others.slice(half)];
  }
  const ends = members.filter((m) => partners(m).length <= 1);
  const candidates = ends.length ? ends : members;
  const order = [candidates.find((m) => gender(m) === 'male') ?? candidates[0]];
  const seen = new Set(order);
  while (order.length < members.length) {
    const next = partners(order[order.length - 1]).find((m) => !seen.has(m)) ?? members.find((m) => !seen.has(m))!;
    order.push(next);
    seen.add(next);
  }
  return order;
}

/**
 * A laid-out branch: households' breadth offsets, per đời the extent used, and for
 * stacked households their depth and the breadth of the line their column hangs from.
 */
interface Branch {
  left: Map<string, number>;
  depth: Map<string, number>;
  spine: Map<string, number>;
  contour: Map<number, [number, number]>;
}

/**
 * Puts `next` beside `acc` as closely as possible without touching: every đời they
 * share keeps at least `gapAt(đời)` between them. Merges `next` into `acc` in place
 * and returns it (copying the maps at every merge made big trees quadratic).
 */
function placeBeside(acc: Branch, next: Branch, gapAt: (rank: number) => number, familyGap: number): Branch {
  let dx = -Infinity;
  for (const [rank, [l]] of next.contour) {
    const other = acc.contour.get(rank);
    if (other) dx = Math.max(dx, other[1] + gapAt(rank) - l);
  }
  if (dx === -Infinity) {
    // No đời in common: just keep them apart.
    const accRight = Math.max(...[...acc.contour.values()].map(([, r]) => r));
    const nextLeft = Math.min(...[...next.contour.values()].map(([l]) => l));
    dx = accRight + familyGap - nextLeft;
  }
  for (const [h, x] of next.left) acc.left.set(h, x + dx);
  for (const [h, d] of next.depth) acc.depth.set(h, d);
  for (const [h, x] of next.spine) acc.spine.set(h, x + dx);
  for (const [rank, [l, r]] of next.contour) {
    const other = acc.contour.get(rank);
    acc.contour.set(rank, other ? [Math.min(other[0], l + dx), Math.max(other[1], r + dx)] : [l + dx, r + dx]);
  }
  return acc;
}

/**
 * Lays out the tree. `screenRatio` (width / height of the view) is the shape that
 * wrapped chi aim for.
 */
export function computeTreeLayout(data: TreeData, opts: LayoutOptions, screenRatio = 16 / 9): TreeLayout {
  const down = opts.direction === 'down';
  // Left-to-right puts a couple one above the other anyway (across the đời).
  const stackedCouples = down && opts.couplesStacked;
  const B = down ? NODE_W : NODE_H; // card size across a đời
  const D = down ? NODE_H : NODE_W; // card size from one đời to the next
  const GAP = down ? 40 : 14; // partners side by side; brothers and sisters
  const COUPLE_GAP = 10; // stacked partners
  const FAMILY_GAP = down ? 100 : 36; // cousins' families
  const COMPONENT_GAP = down ? 200 : 80; // unrelated families
  const RANK_SEP = down ? 80 : 64; // between đời
  const STACK_GAP = 12; // within a stacked column
  const INDENT = down ? 22 : 18; // room for the column's line
  const ROW_GAP = RANK_SEP + 60; // between wrapped rows of chi (room for the frames' labels)

  const ids = new Set(data.nodes.map((p) => p.id));
  const valid = (e: TreeData['edges'][number]) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to;
  const parentEdges = data.edges.filter((e) => e.type === 'PARENT_OF' && valid(e));
  const spouseEdges = data.edges.filter((e) => e.type === 'SPOUSE_OF' && valid(e));
  const genderOf = new Map(data.nodes.map((p) => [p.id, p.gender ?? 'unknown']));
  const birthOf = new Map(data.nodes.map((p) => [p.id, p.birthDate ?? '']));

  const spousesOf = new Map<string, Set<string>>();
  for (const { from, to } of spouseEdges) {
    spousesOf.set(from, (spousesOf.get(from) ?? new Set()).add(to));
    spousesOf.set(to, (spousesOf.get(to) ?? new Set()).add(from));
  }
  const parentsOf = new Map<string, string[]>();
  for (const { from, to } of parentEdges) pushTo(parentsOf, to, from);

  // 1. Households: people joined by marriage.
  const marriages = disjointSet();
  for (const { from, to } of spouseEdges) marriages.union(from, to);
  const householdMembers = new Map<string, string[]>();
  for (const p of data.nodes) pushTo(householdMembers, marriages.find(p.id), p.id);
  const household = new Map<string, { members: string[] }>();
  const householdOf = new Map<string, string>();
  for (const [h, members] of householdMembers) {
    household.set(h, { members: orderHousehold(members, spousesOf, (id) => genderOf.get(id) ?? 'unknown') });
    for (const m of members) householdOf.set(m, h);
  }
  const count = (h: string) => household.get(h)!.members.length;
  /** A household's size across a đời, and along the đời. */
  const breadthOf = (h: string) => (stackedCouples ? B : count(h) * B + (count(h) - 1) * GAP);
  const depthOf = (h: string) => (stackedCouples ? count(h) * D + (count(h) - 1) * COUPLE_GAP : D);
  const memberAt = (h: string, m: string): Bd => {
    const i = household.get(h)!.members.indexOf(m);
    return stackedCouples ? { b: 0, d: i * (D + COUPLE_GAP) } : { b: i * (B + GAP), d: 0 };
  };
  const step = Math.max(D, ...[...household.keys()].map(depthOf)) + RANK_SEP;
  const rowStart = (rank: number) => rank * step;

  // Links between households, and the separate family trees they form.
  const parentHouseholds = new Map<string, Set<string>>();
  const childHouseholds = new Map<string, Set<string>>();
  const families = disjointSet();
  for (const { from, to } of parentEdges) {
    const [a, b] = [householdOf.get(from)!, householdOf.get(to)!];
    if (a === b) continue;
    parentHouseholds.set(b, (parentHouseholds.get(b) ?? new Set()).add(a));
    childHouseholds.set(a, (childHouseholds.get(a) ?? new Set()).add(b));
    families.union(a, b);
  }

  // 2. Đời: one below the lowest parent household (Kahn's algorithm).
  const rank = new Map<string, number>();
  const waiting = new Map([...household.keys()].map((h) => [h, parentHouseholds.get(h)?.size ?? 0]));
  const queue = [...household.keys()].filter((h) => waiting.get(h) === 0);
  for (const h of queue) rank.set(h, 0);
  for (let head = 0; head < queue.length; head++) {
    const h = queue[head];
    for (const c of childHouseholds.get(h) ?? []) {
      rank.set(c, Math.max(rank.get(c) ?? 0, rank.get(h)! + 1));
      waiting.set(c, waiting.get(c)! - 1);
      if (waiting.get(c) === 0) queue.push(c);
    }
  }
  for (const h of household.keys()) if (!rank.has(h)) rank.set(h, 0); // only with inconsistent data (loops)
  // Parents who married in from outside the tree sit just above their children, not at the very top.
  for (const h of household.keys()) {
    const kids = [...(childHouseholds.get(h) ?? [])];
    if (!parentHouseholds.has(h) && kids.length) rank.set(h, Math.max(0, Math.min(...kids.map((k) => rank.get(k)!)) - 1));
  }

  // 3. Each household hangs under one parent household, preferring the husband's
  //    family (members are ordered husband first) and the đời just above.
  const primaryParent = new Map<string, string>();
  for (const [h, { members }] of household) {
    let fallback: string | undefined;
    for (const m of members) {
      for (const p of parentsOf.get(m) ?? []) {
        const ph = householdOf.get(p)!;
        if (ph === h || rank.get(ph)! >= rank.get(h)!) continue;
        if (rank.get(ph) === rank.get(h)! - 1 && !primaryParent.has(h)) primaryParent.set(h, ph);
        fallback ??= ph;
      }
    }
    if (!primaryParent.has(h) && fallback) primaryParent.set(h, fallback);
  }
  /** The member of `child` whose parent is in `parent`: who the line goes to. */
  const bloodMember = (child: string, parent: string) =>
    household.get(child)!.members.find((m) => (parentsOf.get(m) ?? []).some((p) => householdOf.get(p) === parent)) ??
    household.get(child)!.members[0];
  // Lines arrive from the top (or the column's side), so the family's own child comes first.
  if (stackedCouples || opts.stackSiblings) {
    for (const [h, parent] of primaryParent) {
      const blood = bloodMember(h, parent);
      const hh = household.get(h)!;
      hh.members = [blood, ...hh.members.filter((m) => m !== blood)];
    }
  }
  const branches = new Map<string, string[]>();
  for (const [child, parent] of primaryParent) pushTo(branches, parent, child);
  for (const [parent, kids] of branches) {
    // Eldest first; people without a birth date keep their order, after the others.
    const born = (k: string) => birthOf.get(bloodMember(k, parent)) || '9999';
    kids.sort((a, b) => born(a).localeCompare(born(b)));
    // Stacked siblings come after those with children (stable: birth order kept in each group).
    if (opts.stackSiblings) kids.sort((a, b) => Number(!branches.has(a)) - Number(!branches.has(b)));
  }
  const isLeaf = (h: string) => !branches.has(h);

  /** Where a household's children's lines leave it, across the đời (from its left edge). */
  function anchorB(h: string): number {
    if (stackedCouples) return B / 2;
    const { members } = household.get(h)!;
    const kids = branches.get(h) ?? [];
    const parents = members.filter((m) => kids.some((k) => (parentsOf.get(bloodMember(k, h)) ?? []).includes(m)));
    return parents.length ? parents.reduce((s, m) => s + memberAt(h, m).b, 0) / parents.length + B / 2 : breadthOf(h) / 2;
  }

  /** Childless brothers and sisters in columns of at most MAX_STACK, hanging from a line on their left. */
  const stackBlock = (items: string[], r: number): Branch => {
    const left = new Map<string, number>();
    const depth = new Map<string, number>();
    const spine = new Map<string, number>();
    const contour = new Map<number, [number, number]>();
    let colLeft = 0;
    for (let c = 0; c < items.length; c += MAX_STACK) {
      const column = items.slice(c, c + MAX_STACK);
      const colWidth = Math.max(...column.map(breadthOf));
      let d = rowStart(r + 1);
      for (const h of column) {
        left.set(h, colLeft + INDENT);
        depth.set(h, d);
        spine.set(h, colLeft + INDENT / 2);
        d += depthOf(h) + STACK_GAP;
      }
      // The column reaches into the đời below; keep other branches clear of it there too.
      const lastRank = r + 1 + Math.floor((d - STACK_GAP - rowStart(r + 1) - 1) / step);
      for (let q = r + 1; q <= lastRank; q++) {
        const other = contour.get(q);
        const ext: [number, number] = [colLeft, colLeft + INDENT + colWidth];
        contour.set(q, other ? [Math.min(other[0], ext[0]), Math.max(other[1], ext[1])] : ext);
      }
      colLeft += INDENT + colWidth + GAP;
    }
    return { left, depth, spine, contour };
  };

  const layoutBranch = (h: string): Branch => {
    const r = rank.get(h)!;
    const kids = branches.get(h) ?? [];
    // Runs of two or more childless siblings become stacked columns.
    const segments: Branch[] = [];
    for (let i = 0; i < kids.length; ) {
      let j = i;
      while (opts.stackSiblings && j < kids.length && isLeaf(kids[j])) j++;
      if (j - i >= 2) {
        segments.push(stackBlock(kids.slice(i, j), r));
        i = j;
      } else {
        segments.push(layoutBranch(kids[i]));
        i++;
      }
    }
    let acc: Branch | null = null;
    for (const seg of segments) {
      // Brothers and sisters close together; their own families (cousins) further apart.
      acc = acc ? placeBeside(acc, seg, (row) => (row === r + 1 ? GAP : FAMILY_GAP), FAMILY_GAP) : seg;
    }
    let left = 0;
    if (acc) {
      // Centre the parents over where the lines to their first and last child come down.
      const at = (k: string) => acc!.spine.get(k) ?? acc!.left.get(k)! + memberAt(k, bloodMember(k, h)).b + B / 2;
      left = (at(kids[0]) + at(kids[kids.length - 1])) / 2 - anchorB(h);
    }
    // The children's merged branch is only ours, so the household is added to it in place.
    const br: Branch = acc ?? { left: new Map(), depth: new Map(), spine: new Map(), contour: new Map() };
    const own = br.contour.get(r);
    const w = breadthOf(h);
    br.contour.set(r, own ? [Math.min(own[0], left), Math.max(own[1], left + w)] : [left, left + w]);
    br.left.set(h, left);
    return br;
  };

  const subtree = (h: string): string[] => [h, ...(branches.get(h) ?? []).flatMap(subtree)];

  // 4. Final places, in breadth/depth.
  const hpos = new Map<string, Bd>(); // households' top-left corners
  const spineOf = new Map<string, number>();
  const chiBlocks: { b: number; d: number; w: number; h: number; root: string }[] = [];
  /** Founders' children with wrapChi: their line runs along the left edge (trunk) to their row. */
  const wrapRoute = new Map<string, { bus: number; firstBus: number; trunk: number | null }>();

  /** Puts a laid-out branch's households in place, with its top-left corner at (b0, d0). */
  const materialize = (br: Branch, hs: string[], b0: number, d0: number) => {
    const minB = Math.min(...hs.map((h) => Math.min(br.left.get(h)!, br.spine.get(h) ?? Infinity)));
    const minD = Math.min(...hs.map((h) => br.depth.get(h) ?? rowStart(rank.get(h)!)));
    for (const h of hs) {
      hpos.set(h, { b: b0 + br.left.get(h)! - minB, d: d0 + (br.depth.get(h) ?? rowStart(rank.get(h)!)) - minD });
      const s = br.spine.get(h);
      if (s !== undefined) spineOf.set(h, b0 + s - minB);
    }
    return {
      w: Math.max(...hs.map((h) => hpos.get(h)!.b + breadthOf(h))) - b0,
      h: Math.max(...hs.map((h) => hpos.get(h)!.d + depthOf(h))) - d0,
    };
  };

  const familyHouseholds = new Map<string, string[]>();
  for (const h of household.keys()) pushTo(familyHouseholds, families.find(h), h);
  const isLoner = (hs: string[]) => hs.length === 1 && count(hs[0]) === 1;
  const groups = [...familyHouseholds.values()];
  const loners = groups.filter(isLoner).map((hs) => hs[0]);
  const size = (hs: string[]) => hs.reduce((n, h) => n + count(h), 0);
  const trees = groups.filter((hs) => !isLoner(hs)).sort((a, b) => size(b) - size(a));

  const descendantCount = new Map<string, number>();
  const descendants = (h: string): number => {
    let n = descendantCount.get(h);
    if (n === undefined) {
      n = 1 + (branches.get(h) ?? []).reduce((s, k) => s + descendants(k), 0);
      descendantCount.set(h, n);
    }
    return n;
  };

  let offset = 0;
  for (const hs of trees) {
    // A family can have several top branches (e.g. the wife's parents); biggest first.
    const roots = hs.filter((h) => !primaryParent.has(h)).sort((a, b) => descendants(b) - descendants(a));
    const main = roots[0];
    const kids = branches.get(main) ?? [];
    let used: number;

    if (opts.wrapChi && kids.length >= 2) {
      // Each chi as its own block…
      const laid = kids.map((k) => ({ k, br: layoutBranch(k), hs: subtree(k) }));
      const sizes = laid.map(({ br, hs: khs }) => materialize(br, khs, 0, 0));
      // …wrapped into rows about as wide as the screen's shape suggests.
      const ratio = down ? screenRatio : 1 / screenRatio; // breadth / depth
      const area = sizes.reduce((s, x) => s + (x.w + FAMILY_GAP) * (x.h + ROW_GAP), 0);
      const capacity = Math.max(...sizes.map((x) => x.w), Math.sqrt(area * ratio));
      const rows: number[][] = [[]];
      let rowW = 0;
      sizes.forEach((s, i) => {
        if (rows[rows.length - 1].length && rowW + s.w > capacity) {
          rows.push([]);
          rowW = 0;
        }
        rows[rows.length - 1].push(i);
        rowW += s.w + FAMILY_GAP;
      });
      // The founders sit centred over the first row; if their household is the wider
      // of the two (several spouses, few children), the rows move right to make room.
      const firstRowW = rows[0].reduce((s, i) => s + sizes[i].w, 0) + (rows[0].length - 1) * FAMILY_GAP;
      const rowsLeft = offset + Math.max(0, anchorB(main) - firstRowW / 2);
      const mainLeft = rowsLeft + firstRowW / 2 - anchorB(main);
      hpos.set(main, { b: mainLeft, d: 0 });
      let d = depthOf(main) + ROW_GAP;
      const firstBus = d - RANK_SEP / 2;
      const trunk = rows.length > 1 ? rowsLeft - INDENT * 2 : null;
      let width = mainLeft + breadthOf(main) - offset;
      for (const row of rows) {
        let b = rowsLeft;
        for (const i of row) {
          const { k, br, hs: khs } = laid[i];
          const placed = materialize(br, khs, b, d);
          chiBlocks.push({ b, d, w: placed.w, h: placed.h, root: bloodMember(k, main) });
          wrapRoute.set(k, { bus: d - RANK_SEP / 2, firstBus, trunk });
          b += sizes[i].w + FAMILY_GAP;
        }
        width = Math.max(width, b - FAMILY_GAP - offset);
        d += Math.max(...row.map((i) => sizes[i].h)) + ROW_GAP;
      }
      // Other top branches of this family, beside it.
      let side = offset + width + FAMILY_GAP;
      for (const root of roots.slice(1)) side += materialize(layoutBranch(root), subtree(root), side, 0).w + FAMILY_GAP;
      used = side - FAMILY_GAP - offset;
    } else {
      let tree: Branch | null = null;
      for (const root of roots) {
        const branch = layoutBranch(root);
        tree = tree ? placeBeside(tree, branch, () => FAMILY_GAP, FAMILY_GAP) : branch;
      }
      used = materialize(tree!, hs, offset, 0).w;
    }
    offset += used + COMPONENT_GAP;
  }
  // People without any relations: a compact grid after the families.
  const columns = Math.max(1, Math.ceil(Math.sqrt(loners.length)));
  loners.forEach((h, i) => hpos.set(h, { b: offset + (i % columns) * (B + GAP), d: Math.floor(i / columns) * (D + GAP) }));

  const pos = new Map<string, Bd>();
  for (const [h, p] of hpos) {
    for (const m of household.get(h)!.members) {
      const o = memberAt(h, m);
      pos.set(m, { b: p.b + o.b, d: p.d + o.d });
    }
  }
  const toXY = ({ b, d }: Bd): Point => (down ? { x: b, y: d } : { x: d, y: b });

  // 5. Lines from each parent household to the child. A married couple's line
  //    starts between them (or under them, when stacked); other parents' from their card.
  const links: TreeLayout['links'] = [];
  for (const [child, parents] of parentsOf) {
    const c = pos.get(child);
    if (!c) continue;
    const ch = householdOf.get(child)!;
    const spine = spineOf.get(ch);
    const route = wrapRoute.get(ch);
    const enter = { b: c.b + B / 2, d: c.d };
    const byHousehold = new Map<string, string[]>();
    for (const p of parents) pushTo(byHousehold, householdOf.get(p)!, p);
    for (const [ph, ps] of byHousehold) {
      const hp = hpos.get(ph)!;
      const bottom = hp.d + depthOf(ph);
      const starts: Bd[] = stackedCouples
        ? [{ b: hp.b + B / 2, d: bottom }]
        : ps.length === 2
          ? [{ b: (pos.get(ps[0])!.b + pos.get(ps[1])!.b + B) / 2, d: pos.get(ps[0])!.d + D / 2 }]
          : ps.map((p) => ({ b: pos.get(p)!.b + B / 2, d: pos.get(p)!.d + D }));
      for (const s of starts) {
        const mid = bottom + RANK_SEP / 2;
        let path: Bd[];
        if (route) {
          path =
            route.trunk === null || route.bus === route.firstBus
              ? [s, { b: s.b, d: route.bus }, { b: enter.b, d: route.bus }, enter]
              : [
                  s,
                  { b: s.b, d: route.firstBus },
                  { b: route.trunk, d: route.firstBus },
                  { b: route.trunk, d: route.bus },
                  { b: enter.b, d: route.bus },
                  enter,
                ];
        } else if (spine !== undefined) {
          path = [s, { b: s.b, d: mid }, { b: spine, d: mid }, { b: spine, d: c.d + D / 2 }, { b: c.b, d: c.d + D / 2 }];
        } else {
          path = [s, { b: s.b, d: mid }, { b: enter.b, d: mid }, enter];
        }
        links.push({ id: `p-${ps[0]}-${child}-${links.length}`, source: ps[0], target: child, points: path.map(toXY) });
      }
    }
  }

  const couples: TreeLayout['couples'] = spouseEdges.map((e) => {
    const [p, q] = [pos.get(e.from)!, pos.get(e.to)!];
    return {
      id: `s-${e.from}-${e.to}`,
      source: e.from,
      target: e.to,
      points: [toXY({ b: p.b + B / 2, d: p.d + D / 2 }), toXY({ b: q.b + B / 2, d: q.d + D / 2 })],
    };
  });

  const chi: TreeLayout['chi'] = chiBlocks.map((bl, i) => {
    const tl = toXY({ b: bl.b, d: bl.d });
    return { id: `chi-${i}`, root: bl.root, x: tl.x, y: tl.y, width: down ? bl.w : bl.h, height: down ? bl.h : bl.w };
  });

  return { positions: new Map([...pos].map(([id, p]) => [id, toXY(p)])), links, couples, chi };
}

/** Where a layout starts: compact on wide screens, left-to-right on phones. */
export const defaultLayout = (phone: boolean): LayoutOptions =>
  phone
    ? { direction: 'right', couplesStacked: false, stackSiblings: true, wrapChi: false }
    : { direction: 'down', couplesStacked: true, stackSiblings: true, wrapChi: true };

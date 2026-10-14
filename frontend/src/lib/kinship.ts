// Vietnamese kinship terms (cách xưng hô): what the selected person ("ego")
// calls every other person connected to them in the tree.
//
// Follows common Northern usage:
//  - Parent's older siblings are "bác"; father's younger siblings are "chú/cô",
//    mother's younger siblings "cậu/dì"; their spouses "thím/chú/mợ".
//  - Cousins inherit seniority from their parents (con bác là anh/chị, con chú/cô/cậu/dì là em).
//  - Seniority is decided by birth dates; when unknown, both options are shown ("Chú/Bác").
import type { Person, TreeData } from './types';

type Step = 'up' | 'down' | 'spouse';
type G = 'm' | 'f' | null;

const genderOf = (p: Person): G => (p.gender === 'male' ? 'm' : p.gender === 'female' ? 'f' : null);
const pick = (g: G, male: string, female: string, either: string) => (g === 'm' ? male : g === 'f' ? female : either);
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** Is `target` older or younger than `ref`? Compares partial dates (YYYY, YYYY-MM, YYYY-MM-DD) at their common precision. */
function seniority(target: Person, ref: Person): 'older' | 'younger' | null {
  const a = target.birthDate;
  const b = ref.birthDate;
  if (!a || !b) return null;
  const len = Math.min(a.length, b.length);
  const x = a.slice(0, len);
  const y = b.slice(0, len);
  if (x === y) return null;
  return x < y ? 'older' : 'younger';
}

// ---------- Blood relatives: path = `a` steps up to the common ancestor, then `b` steps down ----------

function ancestorTerm(generations: number, target: G, firstParent: G): string {
  const side = generations >= 2 ? pick(firstParent, ' nội', ' ngoại', '') : '';
  switch (generations) {
    case 1:
      return pick(target, 'Bố', 'Mẹ', 'Bố/Mẹ');
    case 2:
      return pick(target, 'Ông', 'Bà', 'Ông/Bà') + side;
    case 3:
      return pick(target, 'Cụ ông', 'Cụ bà', 'Cụ') + side;
    case 4:
      return pick(target, 'Kỵ ông', 'Kỵ bà', 'Kỵ') + side;
    default:
      return `Tổ tiên (đời ${generations})`;
  }
}

function descendantBase(generations: number): string {
  return generations <= 2 ? 'Cháu' : (['Chắt', 'Chút', 'Chít'][generations - 3] ?? `Hậu duệ (đời ${generations})`);
}

/** Parent-generation collateral: bác / chú / cô / cậu / dì. `side` is ego's ancestor in that generation. */
function elderTerm(side: G, target: G, senior: 'older' | 'younger' | null): string {
  if (senior === 'older') return 'Bác';
  if (side === 'm') return pick(target, senior === 'younger' ? 'Chú' : 'Chú/Bác', 'Cô', 'Chú/Cô');
  if (side === 'f') return pick(target, 'Cậu', 'Dì', 'Cậu/Dì');
  return pick(target, 'Chú/Cậu', 'Cô/Dì', 'Họ hàng');
}

/** What a spouse of a bác/chú/cô/cậu/dì is called. */
const ELDER_SPOUSE: Record<string, string> = {
  Bác: 'Bác',
  Chú: 'Thím',
  Cô: 'Chú',
  Cậu: 'Mợ',
  Dì: 'Chú',
  'Chú/Bác': 'Thím/Bác',
};

function generationPrefix(gen: number, target: G): string {
  if (gen === 2) return pick(target, 'Ông', 'Bà', 'Ông/Bà');
  if (gen === 3) return pick(target, 'Cụ ông', 'Cụ bà', 'Cụ');
  return pick(target, 'Kỵ ông', 'Kỵ bà', 'Kỵ');
}

interface Blood {
  nodes: Person[]; // nodes[0] = ego, nodes[a] = common ancestor, nodes[a + b] = relative
  a: number;
  b: number;
}

function bloodShape(steps: Step[]): { a: number; b: number } | null {
  let a = 0;
  while (steps[a] === 'up') a++;
  let b = 0;
  while (steps[a + b] === 'down') b++;
  return a + b === steps.length ? { a, b } : null;
}

function bloodTerm({ nodes, a, b }: Blood, targetGender: G = genderOf(nodes[a + b])): string | null {
  const tg = targetGender;
  if (a === 0 && b === 0) return null;
  if (b === 0) return ancestorTerm(a, tg, genderOf(nodes[1]));
  if (a === 0) {
    if (b === 1) return pick(tg, 'Con trai', 'Con gái', 'Con');
    if (b === 2) return 'Cháu' + pick(genderOf(nodes[1]), ' nội', ' ngoại', '');
    return descendantBase(b);
  }

  // Collateral relatives: seniority follows the two branches below the common ancestor.
  const gen = a - b;
  const senior = seniority(nodes[a + 1], nodes[a - 1]);
  if (gen === 0) {
    if (a === 1) {
      if (senior === 'older') return pick(tg, 'Anh trai', 'Chị gái', 'Anh/Chị');
      if (senior === 'younger') return pick(tg, 'Em trai', 'Em gái', 'Em');
      return pick(tg, 'Anh/em trai', 'Chị/em gái', 'Anh/chị/em');
    }
    if (senior === 'older') return pick(tg, 'Anh họ', 'Chị họ', 'Anh/chị họ');
    if (senior === 'younger') return 'Em họ';
    return pick(tg, 'Anh/em họ', 'Chị/em họ', 'Anh/chị/em họ');
  }
  if (gen > 0) {
    const ho = b >= 2 ? ' họ' : '';
    const base = elderTerm(genderOf(nodes[gen]), tg, senior);
    return gen === 1 ? base + ho : `${generationPrefix(gen, tg)} ${lower(base)}${ho}`;
  }
  return descendantBase(-gen) + (a >= 2 ? ' họ' : '');
}

/** What ego calls the spouse of a blood relative. */
function relativeSpouseTerm(blood: Blood, spouse: Person): string | null {
  const { nodes, a, b } = blood;
  const tg = genderOf(spouse);
  const inLaw = pick(tg, 'rể', 'dâu', 'dâu/rể');
  if (a === 0 && b === 0) return pick(tg, 'Chồng', 'Vợ', 'Vợ/Chồng');
  if (b === 0) return a === 1 ? pick(tg, 'Bố dượng', 'Mẹ kế', 'Bố dượng/Mẹ kế') : ancestorTerm(a, tg, genderOf(nodes[1]));
  if (a === 0) return `${b === 1 ? 'Con' : descendantBase(b)} ${inLaw}`;

  const gen = a - b;
  const senior = seniority(nodes[a + 1], nodes[a - 1]);
  if (gen === 0) {
    const ho = a >= 2 ? ' họ' : '';
    const elder = senior === 'older' ? pick(tg, 'Anh', 'Chị', 'Anh/Chị') : senior === 'younger' ? 'Em' : pick(tg, 'Anh/em', 'Chị/em', 'Anh/chị/em');
    return `${elder} ${inLaw}${ho}`;
  }
  if (gen > 0) {
    const ho = b >= 2 ? ' họ' : '';
    const relativeBase = elderTerm(genderOf(nodes[gen]), genderOf(nodes[a + b]), senior);
    const base = ELDER_SPOUSE[relativeBase] ?? relativeBase;
    return gen === 1 ? base + ho : `${generationPrefix(gen, tg)} ${lower(base)}${ho}`;
  }
  return `${descendantBase(-gen)} ${inLaw}${a >= 2 ? ' họ' : ''}`;
}

// ---------- Paths ----------

/** "down, up" (a child's other parent) is treated as a partner, like a spouse link. */
function normalize(nodes: Person[], steps: Step[]) {
  const n: Person[] = [nodes[0]];
  const s: Step[] = [];
  for (let i = 0; i < steps.length; i++) {
    if (steps[i] === 'down' && steps[i + 1] === 'up') {
      s.push('spouse');
      n.push(nodes[i + 2]);
      i++;
    } else {
      s.push(steps[i]);
      n.push(nodes[i + 1]);
    }
  }
  return { nodes: n, steps: s };
}

function describe(nodes: Person[], steps: Step[]): string | null {
  if (steps.length === 0) return null;
  const target = nodes[nodes.length - 1];
  const tg = genderOf(target);

  const blood = bloodShape(steps);
  if (blood) return bloodTerm({ nodes, ...blood });

  // Blood relative's spouse
  const last = steps.length - 1;
  if (steps[last] === 'spouse') {
    const shape = bloodShape(steps.slice(0, last));
    if (shape) return relativeSpouseTerm({ nodes: nodes.slice(0, last + 1), ...shape }, target);
  }

  // Parents of a child's spouse: thông gia
  const k = steps.indexOf('spouse');
  if (
    k > 0 &&
    steps.slice(0, k).every((s) => s === 'down') &&
    steps.length === 2 * k + 1 &&
    steps.slice(k + 1).every((s) => s === 'up')
  ) {
    return k === 1 ? pick(tg, 'Ông thông gia', 'Bà thông gia', 'Thông gia') : 'Thông gia';
  }

  // Spouse's relatives
  if (steps[0] === 'spouse') {
    const spouse = nodes[1];
    const side = pick(genderOf(spouse), 'chồng', 'vợ', 'vợ/chồng');
    const rest = steps.slice(1);
    const shape = bloodShape(rest);
    if (shape?.a === 1 && shape.b === 0) return `${pick(tg, 'Bố', 'Mẹ', 'Bố/Mẹ')} ${side}`;
    if (shape?.a === 0 && shape.b === 1) return `Con riêng của ${side}`;
    if (shape?.a === 1 && shape.b === 1) {
      const senior = seniority(target, spouse);
      const elder = senior === 'older' ? pick(tg, 'Anh', 'Chị', 'Anh/Chị') : senior === 'younger' ? 'Em' : pick(tg, 'Anh/em', 'Chị/em', 'Anh/chị/em');
      return `${elder} ${side}`;
    }
    const inner = describe(nodes.slice(1), rest);
    return inner ? `${inner} (bên ${side})` : null;
  }

  return 'Họ hàng';
}

/** Cheapest paths from ego; spouse links cost a little more so blood ties win ties. */
const COST: Record<Step, number> = { up: 1, down: 1, spouse: 1.1 };

/**
 * Returns personId -> kinship term for everyone connected to `egoId`.
 * Ego and unconnected people are omitted.
 */
export function computeKinship(data: TreeData, egoId: string): Map<string, string> {
  const people = new Map(data.nodes.map((p) => [p.id, p]));
  const result = new Map<string, string>();
  if (!people.has(egoId)) return result;

  const adjacency = new Map<string, { to: string; step: Step }[]>();
  const link = (from: string, to: string, step: Step) => {
    if (!people.has(from) || !people.has(to)) return;
    if (!adjacency.has(from)) adjacency.set(from, []);
    adjacency.get(from)!.push({ to, step });
  };
  for (const e of data.edges) {
    if (e.type === 'PARENT_OF') {
      link(e.from, e.to, 'down');
      link(e.to, e.from, 'up');
    } else {
      link(e.from, e.to, 'spouse');
      link(e.to, e.from, 'spouse');
    }
  }

  // Dijkstra with a small binary heap.
  const dist = new Map<string, number>([[egoId, 0]]);
  const prev = new Map<string, { from: string; step: Step }>();
  const heap: [number, string][] = [[0, egoId]];
  const push = (item: [number, string]) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const end = heap.pop()!;
    if (heap.length) {
      heap[0] = end;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };

  while (heap.length) {
    const [d, id] = pop();
    if (d > (dist.get(id) ?? Infinity)) continue;
    for (const { to, step } of adjacency.get(id) ?? []) {
      const nd = d + COST[step];
      if (nd < (dist.get(to) ?? Infinity)) {
        dist.set(to, nd);
        prev.set(to, { from: id, step });
        push([nd, to]);
      }
    }
  }

  for (const id of prev.keys()) {
    const steps: Step[] = [];
    const path: Person[] = [people.get(id)!];
    for (let cur = id; cur !== egoId; ) {
      const p = prev.get(cur)!;
      steps.unshift(p.step);
      path.unshift(people.get(p.from)!);
      cur = p.from;
    }
    const normalized = normalize(path, steps);
    const term = describe(normalized.nodes, normalized.steps);
    if (term) result.set(id, term);
  }
  return result;
}

// The tree on the printed report (lib/report.ts): the same layout as the tree page
// (treeLayout.ts, with the viewer's Layout options), drawn straight onto the
// report's canvas as vector shapes, so it stays sharp at any size. Only the cards
// differ: each đời has its own card size, width, height and text together (usually
// larger for the first đời, which have few people, and smaller for later ones),
// names are never cut short (a long one wraps onto more lines, and its card grows
// taller), and the colours are the report's own. Larger cards get room by spreading the layout apart (sizeReportTree),
// which keeps its structure. Pure (no React).

import { CHI_LABEL, CHI_PAD, computeTreeLayout, NODE_H, NODE_W, type LayoutOptions, type Point } from './treeLayout';
import { deathMarkOf, LOTUS_PATHS } from './deathMark';
import type { PersonSummary, ReportDepthSizes, TreeData } from './types';

/** Card sizes per đời, in percent of the tree page's card (as in the backend's settings). */
export const DEPTH_SIZE_MIN = 40;
export const DEPTH_SIZE_MAX = 300;

/**
 * A card's size at đời `g` (0 = the first), relative to the tree page's card, for its
 * width, height and text alike: `sizes` has percentages for the first three đời and one
 * for every later đời.
 */
export const depthScale = (sizes: ReportDepthSizes, g: number) =>
  Math.min(DEPTH_SIZE_MAX, Math.max(DEPTH_SIZE_MIN, sizes[Math.min(g, sizes.length - 1)])) / 100;

/** Text sizes on a card at full width; larger than the tree page's, for print. */
const NAME_SIZE = 18;
const YEARS_SIZE = 14;
/** Line heights, as multiples of the text size, and the room around a card's text. */
const NAME_LINE = 1.2;
const YEARS_LINE = 1.3;
const PAD_X = 12;
const PAD_Y = 8;
/** The room kept in a name's last line for a lotus, which is drawn over it. */
const LOTUS_SPACE = '\u2003';
const RADIUS = 10;
/** The text grows and shrinks with its card, but never below half size, so names stay readable in print. */
const TEXT_SCALE_MIN = 0.5;
/** Room around the tree inside its box. */
const MARGIN = 20;
/** Least room kept between a larger card and what's beside it (another card, a line, a chi frame). */
const CLEARANCE = 14;

export interface ReportTreeStyle {
  card: string;
  name: string;
  dates: string;
  /** Lines, card borders and chi frames. */
  line: string;
  font: string;
}

export interface ReportTreeText {
  name: (p: PersonSummary) => string;
  /** "1920 – 1985", or '' when no dates are known. */
  years: (p: PersonSummary) => string;
  /** A chi frame's label (wrapped layout), as on the tree page. */
  chiLabel: (index: number, rootId: string) => string;
}

export interface ReportTree {
  /** In tree units; draw() fills (0, 0)–(width, height). */
  width: number;
  height: number;
  draw: (ctx: CanvasRenderingContext2D, style: ReportTreeStyle) => void;
}

interface Card {
  person: PersonSummary;
  name: string;
  years: string;
  /** Centre of the card's place in the layout, and its đời (0 = the first). */
  cx: number;
  cy: number;
  generation: number;
}

interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
}

/** The tree page's layout of the people shown, before the cards are sized (sizeReportTree). */
export interface ReportLayout {
  down: boolean;
  cards: Card[];
  chi: Frame[];
  links: Point[][];
  couples: Point[][];
}

/**
 * The tree's chi, as the tree page numbers and labels them with wrapped chi: the
 * first person of each (one of the founders' children), in order. Empty when the
 * founders have fewer than two children shown.
 */
export function listChi(data: TreeData, options: LayoutOptions): string[] {
  if (!data.nodes.length) return [];
  return computeTreeLayout(data, { ...options, wrapChi: true }).chi.map((c) => c.root);
}

/**
 * Some chi to print: each one's first person's parents (the founders), that person and
 * all their descendants, and the spouses of everyone in those branches.
 */
export function chiData(data: TreeData, roots: string[]): TreeData {
  const childrenOf = new Map<string, string[]>();
  const parentsOf = new Map<string, string[]>();
  const spousesOf = new Map<string, string[]>();
  const add = (map: Map<string, string[]>, key: string, value: string) => map.set(key, [...(map.get(key) ?? []), value]);
  for (const e of data.edges) {
    if (e.type === 'PARENT_OF') {
      add(childrenOf, e.from, e.to);
      add(parentsOf, e.to, e.from);
    } else if (e.type === 'SPOUSE_OF') {
      add(spousesOf, e.from, e.to);
      add(spousesOf, e.to, e.from);
    }
  }
  const keep = new Set<string>();
  for (const queue = [...roots]; queue.length; ) {
    const id = queue.pop()!;
    if (keep.has(id)) continue;
    keep.add(id);
    queue.push(...(childrenOf.get(id) ?? []));
  }
  // Spouses after the descendants, so a spouse's children with someone else stay out.
  for (const id of [...keep]) for (const s of spousesOf.get(id) ?? []) keep.add(s);
  for (const root of roots) for (const p of parentsOf.get(root) ?? []) keep.add(p);
  return {
    nodes: data.nodes.filter((n) => keep.has(n.id)),
    edges: data.edges.filter((e) => keep.has(e.from) && keep.has(e.to)),
  };
}

/**
 * Lays out the tree shown (`data`) like the tree page does with `options`. `aspect`
 * (width / height of the report's tree box) is the shape wrapped chi aim for, as
 * the screen's shape is on the tree page.
 */
export function layOutReportTree(data: TreeData, options: LayoutOptions, text: ReportTreeText, aspect = 16 / 9): ReportLayout {
  const layout = computeTreeLayout(data, options, aspect);
  const byId = new Map<string, Card>();
  for (const person of data.nodes) {
    const p = layout.positions.get(person.id) ?? { x: 0, y: 0 };
    byId.set(person.id, {
      person,
      name: text.name(person),
      years: text.years(person),
      cx: p.x + NODE_W / 2,
      cy: p.y + NODE_H / 2,
      generation: layout.generations.get(person.id) ?? 0,
    });
  }

  /**
   * A line ends at the edge of its card's place; a card can be smaller or larger than
   * its place, so it runs on to the card's centre (hidden under the card). Ends that
   * aren't on a card (a couple's line starts between them) stay as they are.
   */
  const reach = (points: Point[], source: string, target: string) => {
    const onPlace = (pt: Point, id: string) => {
      const c = byId.get(id);
      return !!c && Math.abs(pt.x - c.cx) <= NODE_W / 2 + 1 && Math.abs(pt.y - c.cy) <= NODE_H / 2 + 1;
    };
    const centre = (id: string) => ({ x: byId.get(id)!.cx, y: byId.get(id)!.cy });
    const out = [...points];
    if (out.length && onPlace(out[0], source)) out.unshift(centre(source));
    if (out.length && onPlace(out[out.length - 1], target)) out.push(centre(target));
    return out;
  };

  return {
    down: options.direction === 'down',
    cards: [...byId.values()],
    chi: layout.chi.map((c, i) => ({
      x: c.x - CHI_PAD,
      y: c.y - CHI_LABEL,
      width: c.width + CHI_PAD * 2,
      height: c.height + CHI_LABEL + CHI_PAD,
      label: text.chiLabel(i, c.root),
    })),
    links: layout.links.map((l) => reach(l.points, l.source, l.target)),
    couples: layout.couples.map((c) => c.points),
  };
}

/**
 * Space put in at given places along one axis: everything past a place moves on by
 * its amount. Moving everything past a point the same way keeps every line straight,
 * every row a row and every frame around its people.
 */
function spreader(inserts: Map<number, number>) {
  const at = [...inserts].filter(([, amount]) => amount > 0).sort((a, b) => a[0] - b[0]);
  const before: number[] = [];
  let sum = 0;
  for (const [, amount] of at) before.push((sum += amount));
  return (v: number) => {
    let lo = 0;
    let hi = at.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (at[mid][0] < v) lo = mid + 1;
      else hi = mid;
    }
    return v + (lo ? before[lo - 1] : 0);
  };
}

const insertAt = (inserts: Map<number, number>, at: number, amount: number) => {
  const key = Math.round(at * 2) / 2;
  inserts.set(key, Math.max(inserts.get(key) ?? 0, amount));
};

/** Measures text for the cards: a text's width in a canvas font, and the font family the cards use. */
export interface ReportTreeFont {
  measure: (text: string, font: string) => number;
  family: string;
}

/**
 * `text` in lines no wider than `max`, broken between words. A word too long for a
 * whole line is broken between letters, so nothing is ever cut off. Non-breaking
 * spaces (before the death mark) keep their words together.
 */
function wrap(measure: ReportTreeFont['measure'], text: string, font: string, max: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/ +/).filter(Boolean)) {
    const longer = line ? `${line} ${word}` : word;
    if (measure(longer, font) <= max) {
      line = longer;
      continue;
    }
    if (line) lines.push(line);
    let rest = word;
    while (rest.length > 1 && measure(rest, font) > max) {
      let n = rest.length - 1;
      while (n > 1 && measure(rest.slice(0, n), font) > max) n--;
      lines.push(rest.slice(0, n));
      rest = rest.slice(n);
    }
    line = rest;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

/**
 * The layout with each đời's cards at its size (`sizes`), spread apart where larger
 * cards need room. A card's width, height and text all follow its size; it grows
 * taller still when its name wraps onto more lines. Along a đời, room is added only
 * where a card would come too close to another card, a line or a chi frame's edge (the
 * first đời, with few people, usually have room already); from one đời to the next, a
 * larger card gets room on both sides, so it never covers the lines between đời.
 */
export function sizeReportTree(layout: ReportLayout, sizes: ReportDepthSizes, font: ReportTreeFont): ReportTree {
  const { down, cards, chi, links, couples } = layout;
  if (!cards.length) return { width: 1, height: 1, draw: () => {} };
  // b: across a đời, d: from one đời to the next (as in treeLayout.ts).
  const B = down ? NODE_W : NODE_H;
  const D = down ? NODE_H : NODE_W;
  const bOf = (p: Point) => (down ? p.x : p.y);
  const dOf = (p: Point) => (down ? p.y : p.x);
  const placed = cards.map((c) => {
    const scale = depthScale(sizes, c.generation);
    const centre = { x: c.cx, y: c.cy };
    // The card's text: the whole name on as many lines as it needs, then the dates.
    const k = Math.max(TEXT_SCALE_MIN, scale);
    const width = NODE_W * scale;
    const inner = width - PAD_X * 2 * k;
    const nameFont = `600 ${NAME_SIZE * k}px ${font.family}`;
    const yearsFont = `${YEARS_SIZE * k}px ${font.family}`;
    // The death mark stays with the last word; a lotus is drawn over an em space kept for it.
    const deceased = c.person.deathDate ? (deathMarkOf(c.person) === 'lotus' ? `\u00a0${LOTUS_SPACE}` : '\u00a0†') : '';
    const nameLines = wrap(font.measure, c.name + deceased, nameFont, inner);
    const textHeight = nameLines.length * NAME_SIZE * k * NAME_LINE + (c.years ? YEARS_SIZE * k * YEARS_LINE : 0);
    const height = Math.max(NODE_H * scale, textHeight + PAD_Y * 2 * k);
    const text = { k, nameFont, yearsFont, nameLines, textHeight, width, height };
    // Wider changes the card across a đời top-down and along it left to right; taller the other way.
    const wider = (width - NODE_W) / 2;
    const taller = (height - NODE_H) / 2;
    return { card: c, scale, text, b: bOf(centre), d: dOf(centre), growB: down ? wider : taller, growD: down ? taller : wider };
  });

  // From one đời to the next: room on both sides of each larger card.
  const dInserts = new Map<number, number>();
  for (const p of placed) {
    if (p.growD <= 0) continue;
    insertAt(dInserts, p.d - D / 2 - 0.5, p.growD);
    insertAt(dInserts, p.d + D / 2 + 0.5, p.growD);
  }

  // Across: what each card must keep clear of, beside it in its đời's band. Cards,
  // and lines and chi frame edges that run along the đời axis.
  type Obstacle = { b: number; d0: number; d1: number; grow: number; card?: (typeof placed)[number] };
  const obstacles: Obstacle[] = placed.map((p) => ({ b: p.b, d0: p.d - D / 2, d1: p.d + D / 2, grow: p.growB, card: p }));
  for (const pts of [...links, ...couples]) {
    for (let i = 1; i < pts.length; i++) {
      const [a, z] = [pts[i - 1], pts[i]];
      if (Math.abs(bOf(a) - bOf(z)) > 0.5) continue;
      obstacles.push({ b: bOf(a), d0: Math.min(dOf(a), dOf(z)), d1: Math.max(dOf(a), dOf(z)), grow: 0 });
    }
  }
  for (const f of chi) {
    const [b0, b1] = down ? [f.x, f.x + f.width] : [f.y, f.y + f.height];
    const [d0, d1] = down ? [f.y, f.y + f.height] : [f.x, f.x + f.width];
    obstacles.push({ b: b0, d0, d1, grow: 0 }, { b: b1, d0, d1, grow: 0 });
  }
  obstacles.sort((a, b) => a.b - b.b);
  /** Index of the first obstacle past `b` across. */
  const after = (b: number) => {
    let lo = 0;
    let hi = obstacles.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (obstacles[mid].b <= b) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const bInserts = new Map<number, number>();
  for (const p of placed) {
    const half = B / 2;
    const d0 = p.d - D / 2;
    const d1 = p.d + D / 2;
    const beside = (o: Obstacle) => o.card !== p && o.d0 < d1 && o.d1 > d0 && Math.abs(o.b - p.b) >= half - 0.5;
    // The nearest on the right (a card's own lines run inside its place, so they are skipped).
    for (let i = after(p.b); i < obstacles.length; i++) {
      const o = obstacles[i];
      if (!beside(o)) continue;
      const gap = o.b - (o.card ? B / 2 : 0) - (p.b + half);
      const need = p.growB + (o.card ? o.grow : 0) + CLEARANCE - Math.max(gap, CLEARANCE);
      if (need > 0) insertAt(bInserts, p.b + half + gap / 2, need);
      break;
    }
    // A line or frame edge on the left (cards on the left check their right side themselves).
    if (p.growB <= 0) continue;
    for (let i = after(p.b) - 1; i >= 0; i--) {
      const o = obstacles[i];
      if (o.b >= p.b || !beside(o)) continue;
      if (o.card) break;
      const gap = p.b - half - o.b;
      const need = p.growB + CLEARANCE - Math.max(gap, CLEARANCE);
      if (need > 0) insertAt(bInserts, o.b + gap / 2, need);
      break;
    }
  }

  const spreadB = spreader(bInserts);
  const spreadD = spreader(dInserts);
  const move = (p: Point): Point =>
    down ? { x: spreadB(p.x), y: spreadD(p.y) } : { x: spreadD(p.x), y: spreadB(p.y) };
  const moveFrame = (f: Frame): Frame => {
    const a = move({ x: f.x, y: f.y });
    const z = move({ x: f.x + f.width, y: f.y + f.height });
    return { ...f, x: a.x, y: a.y, width: z.x - a.x, height: z.y - a.y };
  };
  const sized = placed.map(({ card, text }) => {
    const c = move({ x: card.cx, y: card.cy });
    return { ...card, ...text, cx: c.x, cy: c.y };
  });
  const frames = chi.map(moveFrame);
  const lines = links.map((pts) => pts.map(move));
  const marriages = couples.map((pts) => pts.map(move));

  // Move everything so the tree starts at (MARGIN, MARGIN).
  const xs: number[] = [];
  const ys: number[] = [];
  for (const c of sized) {
    xs.push(c.cx - c.width / 2, c.cx + c.width / 2);
    ys.push(c.cy - c.height / 2, c.cy + c.height / 2);
  }
  for (const f of frames) xs.push(f.x, f.x + f.width), ys.push(f.y, f.y + f.height);
  for (const pts of [...lines, ...marriages]) for (const p of pts) xs.push(p.x), ys.push(p.y);
  const minX = Math.min(...xs) - MARGIN;
  const minY = Math.min(...ys) - MARGIN;
  const width = Math.max(...xs) - minX + MARGIN;
  const height = Math.max(...ys) - minY + MARGIN;

  return {
    width,
    height,
    draw: (ctx, style) => {
      ctx.save();
      ctx.translate(-minX, -minY);
      drawTree(ctx, style, sized, frames, lines, marriages);
      ctx.restore();
    },
  };
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** A polyline with rounded corners, like the tree page's lines. */
function polyline(ctx: CanvasRenderingContext2D, points: Point[], radius = 8) {
  if (points.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length - 1; i++) {
    const [p, c, n] = [points[i - 1], points[i], points[i + 1]];
    const r = Math.min(radius, Math.hypot(c.x - p.x, c.y - p.y) / 2, Math.hypot(n.x - c.x, n.y - c.y) / 2);
    ctx.arcTo(c.x, c.y, n.x, n.y, r);
  }
  const last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
}

/** `text` cut to fit `max` with "…", in the context's current font (chi labels only; names wrap instead). */
function fit(ctx: CanvasRenderingContext2D, text: string, max: number) {
  if (ctx.measureText(text).width <= max) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= max) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo).trimEnd()}…`;
}

const lotusPaths = typeof Path2D === 'undefined' ? [] : LOTUS_PATHS.map((d) => new Path2D(d));

/** The lotus (lib/deathMark.ts), `size` tall, centred at (x, y), in the current fill colour. */
function drawLotus(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  ctx.save();
  ctx.translate(x - size / 2, y - size / 2);
  ctx.scale(size / 24, size / 24);
  for (const p of lotusPaths) ctx.fill(p);
  ctx.restore();
}

function drawTree(
  ctx: CanvasRenderingContext2D,
  style: ReportTreeStyle,
  cards: (Card & {
    k: number;
    nameFont: string;
    yearsFont: string;
    nameLines: string[];
    textHeight: number;
    width: number;
    height: number;
  })[],
  chi: Frame[],
  links: Point[][],
  couples: Point[][],
) {
  // Chi frames, behind everything (wrapped layout).
  for (const f of chi) {
    roundedRect(ctx, f.x, f.y, f.width, f.height, 16);
    ctx.globalAlpha = 0.06;
    ctx.fillStyle = style.line;
    ctx.fill();
    ctx.globalAlpha = 0.45;
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = style.line;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.font = `600 13px ${style.font}`;
    ctx.fillStyle = style.line;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(fit(ctx, f.label, f.width - 28), f.x + 14, f.y + 6);
  }

  // Lines, under the cards: parents to children solid, couples dashed.
  ctx.strokeStyle = style.line;
  ctx.lineWidth = 1.8;
  for (const pts of links) polyline(ctx, pts);
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  for (const pts of couples) polyline(ctx, pts);
  ctx.setLineDash([]);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const c of cards) {
    const [w, h] = [c.width, c.height];
    const x = c.cx - w / 2;
    const y = c.cy - h / 2;
    ctx.shadowColor = 'rgb(0 0 0 / 22%)';
    ctx.shadowBlur = 5;
    ctx.shadowOffsetY = 1.5;
    roundedRect(ctx, x, y, w, h, Math.min(RADIUS * c.k, w / 4, h / 4));
    ctx.fillStyle = style.card;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = style.line;
    ctx.stroke();

    // The name's lines, then the dates, centred in the card.
    let line = c.cy - c.textHeight / 2;
    ctx.font = c.nameFont;
    ctx.fillStyle = style.name;
    for (const text of c.nameLines) {
      const lh = NAME_SIZE * c.k * NAME_LINE;
      ctx.fillText(text, c.cx, line + lh / 2);
      if (text.endsWith(LOTUS_SPACE)) {
        // The lotus in the space kept for it at the end of the line.
        const full = ctx.measureText(text).width;
        const before = ctx.measureText(text.slice(0, -LOTUS_SPACE.length)).width;
        drawLotus(ctx, c.cx - full / 2 + before + (full - before) / 2, line + lh / 2, NAME_SIZE * c.k * 1.25);
      }
      line += lh;
    }
    if (c.years) {
      const lh = YEARS_SIZE * c.k * YEARS_LINE;
      ctx.font = c.yearsFont;
      ctx.fillStyle = style.dates;
      ctx.fillText(c.years, c.cx, line + lh / 2);
    }
  }
}

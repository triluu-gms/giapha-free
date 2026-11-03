// The printed report: the tree drawn over a background image such as a decorated
// frame, with a title. The background sets the page's shape. The title and the tree
// each have their own box inside it (TreeSettings.reportTitleArea and reportArea),
// so the title can sit on the frame's banner and the tree inside its border.
// Everything is drawn on a canvas in the browser, like the plain export (exportTree.ts).

import { MAX_PIXELS } from './exportTree';
import type { ReportTree, ReportTreeStyle } from './reportTree';
import type { ReportArea } from './types';

export const DEFAULT_REPORT_AREA: ReportArea = [24, 8, 10, 8];
export const DEFAULT_REPORT_TITLE_AREA: ReportArea = [12, 8, 78, 8];
export const DEFAULT_REPORT_COLOR = '#7a1f1f';
/** Uploaded backgrounds are kept this large: sharp when printed on A3 or A2. */
export const REPORT_BACKGROUND_MAX_SIDE = 3000;
/** Each margin's limit, and the smallest box left between two opposite margins, as in the backend's settings schema. */
export const REPORT_MARGIN_MAX = 95;
const REPORT_BOX_MIN = 5;
/** The tree's size on the report, relative to fitting its box exactly (1). */
export const REPORT_ZOOM_MIN = 0.3;
export const REPORT_ZOOM_MAX = 3;

export type ReportBackground = ImageBitmap | HTMLImageElement;

export interface ReportOptions {
  background: ReportBackground;
  /** The tree in the tree page's layout (reportTree.ts), drawn as vector shapes. */
  tree: ReportTree;
  /** Its cards' and lines' colours, and the font. */
  treeStyle: ReportTreeStyle;
  /** The tree's box. */
  area: ReportArea;
  /** The title's box. */
  titleArea: ReportArea;
  textColor: string;
  /** Empty strings leave that line out. */
  title: string;
  subtitle: string;
  font: string;
  /**
   * The tree's size: 1 fits its box, smaller shrinks it, larger enlarges it around
   * its centre (cut off at the box's edges, so it never covers the frame).
   */
  zoom: number;
  /** For a preview: the longest side of the result, in pixels. Otherwise as sharp as the tree allows. */
  maxSide?: number;
  /** For a preview: dashed outlines of the title's and the tree's boxes. */
  guides?: boolean;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A box from its margins, in the page's pixels. */
function boxOf([top, right, bottom, left]: ReportArea, page: { width: number; height: number }): Box {
  return {
    x: (page.width * left) / 100,
    y: (page.height * top) / 100,
    width: (page.width * (100 - left - right)) / 100,
    height: (page.height * (100 - top - bottom)) / 100,
  };
}

/** Line heights, as multiples of the title's size: the title, and the subtitle (0.45 × the title's size). */
const TITLE_LINE = 1.3;
const SUBTITLE_SIZE = 0.45;
const SUBTITLE_LINE = SUBTITLE_SIZE * 1.6;

/**
 * The title's size: as large as fits its box, both lines within its height and each
 * line, measured in the real font, within 95% of its width.
 */
function titleSizeFor(ctx: CanvasRenderingContext2D, { title, subtitle, font }: ReportOptions, header: Box) {
  const lines = (title ? TITLE_LINE : 0) + (subtitle ? SUBTITLE_LINE : 0);
  if (!lines) return 0;
  const widthAt100 = (text: string, weight: string) => {
    ctx.font = `${weight}100px ${font}`;
    return ctx.measureText(text).width / 100;
  };
  const widest = Math.max(title ? widthAt100(title, '700 ') : 0, subtitle ? widthAt100(subtitle, '') * SUBTITLE_SIZE : 0);
  return Math.min(header.height / lines, widest ? (header.width * 0.95) / widest : Infinity);
}

/** Where the tree goes, in the background's own pixels. */
function layOut({ background, tree: drawing, area, titleArea, zoom }: ReportOptions) {
  const page = { width: background.width, height: background.height };
  const header = boxOf(titleArea, page);
  const box = boxOf(area, page);

  const fit = Math.min(box.width / drawing.width, box.height / drawing.height) * zoom;
  const tree: Box = {
    width: drawing.width * fit,
    height: drawing.height * fit,
    x: box.x + (box.width - drawing.width * fit) / 2,
    y: box.y + (box.height - drawing.height * fit) / 2,
  };
  return { page, header, box, tree, fit };
}

/** Output pixels per tree unit that keep the smallest cards' text readable when printed. */
const TREE_SHARPNESS = 2;

/**
 * How many output pixels per background pixel. At least 1 (the background's own size),
 * more when the tree would otherwise be drawn too small to read, and never past the
 * browser's canvas limit.
 */
function outputScale(options: ReportOptions, page: { width: number; height: number }, fit: number) {
  const longest = Math.max(page.width, page.height);
  const sharp = Math.max(1, TREE_SHARPNESS / fit);
  const limit = Math.sqrt(MAX_PIXELS / (page.width * page.height));
  return Math.min(sharp, limit, options.maxSide ? options.maxSide / longest : Infinity);
}

/** Draws the report onto `canvas` (resizing it), or a new canvas. */
export function composeReport(options: ReportOptions, canvas = document.createElement('canvas')): HTMLCanvasElement {
  const { background, tree: drawing, textColor, title, subtitle, font, guides } = options;
  const { page, header, box, tree, fit } = layOut(options);
  const k = outputScale(options, page, fit);

  canvas.width = Math.max(1, Math.round(page.width * k));
  canvas.height = Math.max(1, Math.round(page.height * k));
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(background, 0, 0, page.width, page.height);

  // The tree, cut off at its box when enlarged past it.
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.width, box.height);
  ctx.clip();
  ctx.translate(tree.x, tree.y);
  ctx.scale(fit, fit);
  drawing.draw(ctx, options.treeStyle);
  ctx.restore();

  // Title and subtitle, centred in their box. A soft light halo keeps them readable
  // over a patterned background.
  const titleSize = titleSizeFor(ctx, options, header);
  const subtitleSize = titleSize * SUBTITLE_SIZE;
  const lines = (title ? TITLE_LINE : 0) + (subtitle ? SUBTITLE_LINE : 0);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = textColor;
  ctx.shadowColor = 'rgb(255 255 255 / 85%)';
  ctx.shadowBlur = Math.max(2, titleSize * 0.15) * k;
  const centre = header.x + header.width / 2;
  let y = header.y + (header.height - lines * titleSize) / 2;
  if (title) {
    ctx.font = `700 ${titleSize}px ${font}`;
    ctx.fillText(title, centre, y, header.width);
    y += titleSize * TITLE_LINE;
  }
  if (subtitle) {
    ctx.globalAlpha = 0.8;
    ctx.font = `${subtitleSize}px ${font}`;
    ctx.fillText(subtitle, centre, y + subtitleSize * 0.3, header.width);
    ctx.globalAlpha = 1;
  }
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;

  if (guides) {
    ctx.setLineDash([6 / k, 4 / k]);
    ctx.lineWidth = 1.5 / k;
    ctx.strokeStyle = 'rgb(47 125 91 / 90%)';
    ctx.strokeRect(box.x, box.y, box.width, box.height);
    if (title || subtitle) {
      ctx.strokeStyle = 'rgb(192 57 43 / 85%)';
      ctx.strokeRect(header.x, header.y, header.width, header.height);
    }
    ctx.setLineDash([]);
  }
  return canvas;
}

/** Margins rounded to half a percent and kept within the backend's limits. */
export function clampArea(area: ReportArea): ReportArea {
  const [top, right, bottom, left] = area.map((v) => Math.min(REPORT_MARGIN_MAX, Math.max(0, Math.round(v * 2) / 2)));
  const room = 100 - REPORT_BOX_MIN;
  const fix = (a: number, b: number) => (a + b <= room ? [a, b] : [a, room - a]);
  const [t, b] = fix(top, bottom);
  const [l, r] = fix(left, right);
  return [t, r, b, l];
}

// The arithmetic behind the photo editor's crop, rotate and straighten. Pure
// (no React), and the same code draws the on-screen preview and the saved
// photo, so what you see is what gets saved.
//
// Coordinates: the frame is W×H on screen. The image (iw×ih source pixels) is
// drawn centred at the frame's centre + (x, y), rotated by turns·90° + tilt,
// and scaled so it always covers the frame.

export type FrameShape = 'square' | 'portrait' | 'original';

export interface CropState {
  /** Quarter turns clockwise (0–3). */
  turns: number;
  /** Straightening, in degrees (−20 to 20). */
  tilt: number;
  /** 1 = the smallest size that still covers the frame. */
  zoom: number;
  /** The image's centre relative to the frame's, in screen pixels. */
  x: number;
  y: number;
}

export const initialCrop: CropState = { turns: 0, tilt: 0, zoom: 1, x: 0, y: 0 };
export const MAX_ZOOM = 4;
export const MAX_TILT = 20;

type Vec = { x: number; y: number };
const rotate = (v: Vec, a: number): Vec => ({
  x: v.x * Math.cos(a) - v.y * Math.sin(a),
  y: v.x * Math.sin(a) + v.y * Math.cos(a),
});

export const angleOf = (s: CropState) => ((s.turns * 90 + s.tilt) * Math.PI) / 180;

/** Width / height of the frame: square, 3:4 portrait, or the (turned) photo's own shape. */
export function frameAspect(shape: FrameShape, iw: number, ih: number, turns: number): number {
  if (shape === 'square') return 1;
  if (shape === 'portrait') return 3 / 4;
  return turns % 2 ? ih / iw : iw / ih;
}

/** The largest frame of that aspect that fits in the space available. */
export function frameSize(aspect: number, maxW: number, maxH: number): { W: number; H: number } {
  const W = Math.max(1, Math.min(maxW, maxH * aspect));
  return { W, H: W / aspect };
}

/** Scale at which the image, at this angle, just covers the frame. */
export function coverScale(iw: number, ih: number, W: number, H: number, angle: number): number {
  const c = Math.abs(Math.cos(angle));
  const s = Math.abs(Math.sin(angle));
  return Math.max((W * c + H * s) / iw, (W * s + H * c) / ih);
}

export const scaleOf = (st: CropState, iw: number, ih: number, W: number, H: number) =>
  coverScale(iw, ih, W, H, angleOf(st)) * st.zoom;

/** Moves the image back as little as needed so it still covers the whole frame. */
export function clampCrop(st: CropState, iw: number, ih: number, W: number, H: number): CropState {
  const a = angleOf(st);
  const s = scaleOf(st, iw, ih, W, H);
  const c = Math.abs(Math.cos(a));
  const sn = Math.abs(Math.sin(a));
  // The frame's centre in image pixels, and how far the frame reaches around it.
  const centre = rotate({ x: -st.x / s, y: -st.y / s }, -a);
  const ex = (W * c + H * sn) / 2 / s;
  const ey = (W * sn + H * c) / 2 / s;
  const lim = (v: number, max: number) => Math.max(-Math.max(0, max), Math.min(Math.max(0, max), v));
  const clamped = { x: lim(centre.x, iw / 2 - ex), y: lim(centre.y, ih / 2 - ey) };
  const off = rotate({ x: -clamped.x * s, y: -clamped.y * s }, a);
  return { ...st, x: off.x, y: off.y };
}

/** Zooms to `zoom`, keeping the image point under (px, py) (relative to the frame's centre) in place. */
export function zoomAround(st: CropState, zoom: number, px: number, py: number, iw: number, ih: number, W: number, H: number): CropState {
  const a = angleOf(st);
  const s = scaleOf(st, iw, ih, W, H);
  const z = Math.min(MAX_ZOOM, Math.max(1, zoom));
  const s2 = coverScale(iw, ih, W, H, a) * z;
  const q = rotate({ x: (px - st.x) / s, y: (py - st.y) / s }, -a); // image point under the pointer
  const r = rotate({ x: q.x * s2, y: q.y * s2 }, a);
  return clampCrop({ ...st, zoom: z, x: px - r.x, y: py - r.y }, iw, ih, W, H);
}

type Drawable = CanvasImageSource & { width: number; height: number };

/** Draws the cropped photo onto a canvas k times the frame's size (white behind it, for JPEG). */
export function drawCrop(ctx: CanvasRenderingContext2D, img: Drawable, st: CropState, W: number, H: number, k: number) {
  const s = scaleOf(st, img.width, img.height, W, H);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(k, 0, 0, k, 0, 0);
  ctx.translate(W / 2 + st.x, H / 2 + st.y);
  ctx.rotate(angleOf(st));
  ctx.scale(s, s);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, -img.width / 2, -img.height / 2);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/**
 * How much bigger than the on-screen frame the saved photo is: as sharp as the
 * source allows (never enlarged), and at most `maxSide` pixels on its longer side.
 */
export function outputFactor(st: CropState, iw: number, ih: number, W: number, H: number, maxSide: number): number {
  return Math.min(1 / scaleOf(st, iw, ih, W, H), maxSide / Math.max(W, H));
}

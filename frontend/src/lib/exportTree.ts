// Exports the family tree diagram as a PNG image or a PDF, entirely in the browser.
// The whole tree is rendered (not just what fits on screen), following React
// Flow's "download image" recipe. html-to-image and jsPDF load only when used.
// The report with a background image (lib/report.ts) saves its PNG or PDF here too.

import type { Rect } from '@xyflow/react';

export type ExportFormat = 'png' | 'pdf';

/** Space around the tree, in diagram pixels. */
const PADDING = 40;
/** Sharper than the screen for small trees… */
const MAX_PIXEL_RATIO = 2;
/** …but large trees are scaled down to stay within every browser's canvas limit (Safari: ~16.7 M pixels). */
export const MAX_PIXELS = 16_000_000;
/** jsPDF's largest page side, in points. */
const MAX_PDF_SIDE = 14_400;

interface ExportOptions {
  /** The `.react-flow__viewport` element, which holds every node and edge. */
  viewport: HTMLElement;
  /** Bounds of all nodes, from getNodesBounds(). */
  bounds: Rect;
  format: ExportFormat;
  /** Drawn above the tree, e.g. the tree's name. */
  title: string;
  /** Smaller line under the title, e.g. the date and number of people. */
  subtitle: string;
  /** Without extension. */
  fileName: string;
}

/** The whole diagram as an image, from captureDiagram(). */
interface Diagram {
  image: HTMLImageElement;
  /** Size in diagram pixels (the image is `scale` times larger). */
  width: number;
  height: number;
  scale: number;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not render the tree'));
    img.src = src;
  });
}

/** Colours from the current theme (light or dark), so the export looks like the screen. */
function themeColors(element: HTMLElement) {
  const flow = (element.closest('.react-flow') as HTMLElement | null) ?? document.body;
  const style = getComputedStyle(flow);
  const bodyStyle = getComputedStyle(document.body);
  const background = style.backgroundColor && style.backgroundColor !== 'rgba(0, 0, 0, 0)'
    ? style.backgroundColor
    : bodyStyle.backgroundColor || '#ffffff';
  return { background, text: bodyStyle.color || '#111111', font: bodyStyle.fontFamily || 'sans-serif' };
}

/**
 * Renders every node and edge at 100% zoom, ignoring the on-screen pan and zoom.
 * `extraPixels` is room the caller needs on the same canvas (e.g. a title band).
 */
async function captureDiagram(
  viewport: HTMLElement,
  bounds: Rect,
  background: string,
  extraPixels = 0,
): Promise<Diagram> {
  const { toPng } = await import('html-to-image');
  const width = Math.ceil(bounds.width + PADDING * 2);
  const height = Math.ceil(bounds.height + PADDING * 2);
  const pixelRatio = Math.min(MAX_PIXEL_RATIO, Math.sqrt(MAX_PIXELS / (width * height + extraPixels)));
  const image = await loadImage(
    await toPng(viewport, {
      backgroundColor: background,
      width,
      height,
      pixelRatio,
      // Place the whole tree at 100% inside the padding.
      style: {
        width: `${width}px`,
        height: `${height}px`,
        transform: `translate(${PADDING - bounds.x}px, ${PADDING - bounds.y}px) scale(1)`,
      },
      // Connection dots are only useful on screen.
      filter: (node) => !(node instanceof HTMLElement && node.classList.contains('react-flow__handle')),
    }),
  );
  return { image, width, height, scale: image.width / width };
}

/** Renders the whole diagram, with a title above it, onto a canvas. */
async function renderTree({ viewport, bounds, title, subtitle }: ExportOptions): Promise<HTMLCanvasElement> {
  const colors = themeColors(viewport);
  const width = Math.ceil(bounds.width + PADDING * 2);
  const { image: diagram, scale } = await captureDiagram(viewport, bounds, colors.background, width * 120);

  // Title band, drawn with the browser's fonts so Vietnamese text is always right.
  const titleSize = 26 * scale;
  const subtitleSize = 14 * scale;
  const band = Math.round(PADDING * scale + titleSize + subtitleSize * 1.8);

  const canvas = document.createElement('canvas');
  canvas.width = diagram.width;
  canvas.height = diagram.height + band;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = colors.background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = colors.text;
  ctx.textBaseline = 'top';
  const left = PADDING * scale;
  ctx.font = `600 ${titleSize}px ${colors.font}`;
  ctx.fillText(title, left, PADDING * scale, canvas.width - left * 2);
  ctx.globalAlpha = 0.65;
  ctx.font = `${subtitleSize}px ${colors.font}`;
  ctx.fillText(subtitle, left, PADDING * scale + titleSize * 1.3, canvas.width - left * 2);
  ctx.globalAlpha = 1;
  ctx.drawImage(diagram, 0, band);
  return canvas;
}

function download(url: string, fileName: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Safe file name that keeps Vietnamese letters: "Cây gia phả: Nguyễn" -> "Cây gia phả- Nguyễn". */
export function exportFileName(name: string, date = new Date()): string {
  const clean = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').trim() || 'family-tree';
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return `${clean} ${day}`;
}

/**
 * Downloads a finished canvas as a PNG, or as a PDF with one page its size: easy to
 * zoom on screen, and "fit to page" prints it on any paper. `image` is the PDF's
 * embedded format: JPEG keeps a photo background small, PNG keeps a plain tree sharp.
 */
export async function saveCanvas(
  canvas: HTMLCanvasElement,
  { format, fileName, title, subtitle, image = 'png' }: Pick<ExportOptions, 'format' | 'fileName' | 'title' | 'subtitle'> & { image?: 'png' | 'jpeg' },
): Promise<void> {
  if (format === 'png') {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Could not render the tree');
    const url = URL.createObjectURL(blob);
    download(url, `${fileName}.png`);
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return;
  }

  const { jsPDF } = await import('jspdf');
  const fit = Math.min(1, MAX_PDF_SIDE / Math.max(canvas.width, canvas.height));
  const pageWidth = canvas.width * fit;
  const pageHeight = canvas.height * fit;
  const pdf = new jsPDF({
    orientation: pageWidth >= pageHeight ? 'landscape' : 'portrait',
    unit: 'pt',
    format: [pageWidth, pageHeight],
    compress: true,
  });
  pdf.setProperties({ title, subject: subtitle });
  if (image === 'jpeg') pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, pageWidth, pageHeight);
  else pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, pageWidth, pageHeight);
  pdf.save(`${fileName}.pdf`);
}

export async function exportTree(options: ExportOptions): Promise<void> {
  await saveCanvas(await renderTree(options), options);
}

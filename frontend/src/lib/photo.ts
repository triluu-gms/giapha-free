// Photos are shrunk in the browser before uploading: phone pictures are often
// 5–15 MB, while the API accepts at most 4 MB (Vercel's request limit is 4.5 MB).
// 1200 px stays sharp full-screen on phones and tablets and in a large view on a PC.

export const MAX_SIDE = 1200;
// WebP is about a third smaller than JPEG at the same quality. Browsers that
// can't encode it (Safari) hand back a PNG instead, so JPEG is the fallback.
const WEBP_QUALITY = 0.8;
const JPEG_QUALITY = 0.85;
/** Files already this small (and not too large in pixels) are uploaded as they are. */
const KEEP_AS_IS_BYTES = 200 * 1024;

export const ACCEPTED_PHOTO_TYPES = 'image/jpeg,image/png,image/webp,image/gif';

/** True for photoUrl values that point at a photo uploaded to the app, rather than an outside link. */
export const isUploadedPhoto = (url: string | null | undefined) => !!url?.startsWith('/api/trees/');

export async function loadImage(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  // createImageBitmap applies the EXIF orientation, so phone photos aren't sideways.
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // fall back to <img> below (e.g. older Safari)
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const encode = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

/** A finished canvas as WebP, or JPEG where the browser can't make WebP (Safari). */
export async function encodeCanvas(canvas: HTMLCanvasElement): Promise<Blob> {
  let blob = await encode(canvas, 'image/webp', WEBP_QUALITY);
  if (blob?.type !== 'image/webp') blob = await encode(canvas, 'image/jpeg', JPEG_QUALITY);
  if (!blob) throw new Error('not-an-image');
  return blob;
}

/** Resizes to at most 1200 px on the longest side and re-encodes as WebP (or JPEG). Small files pass through. */
export async function prepareForUpload(file: File): Promise<Blob> {
  const image = await loadImage(file).catch(() => {
    throw new Error('not-an-image');
  });
  const width = image.width;
  const height = image.height;
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  // Small files keep their original format (and a GIF its animation).
  if (scale === 1 && file.size <= KEEP_AS_IS_BYTES) {
    if ('close' in image) image.close();
    return file;
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d')!;
  // The JPEG fallback has no transparency: put transparent PNGs on white instead of black.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  if ('close' in image) image.close();

  const blob = await encodeCanvas(canvas);
  // An already well-compressed photo that needed no resizing can come out larger; keep the original then.
  return scale === 1 && file.size <= blob.size ? file : blob;
}

// Removes metadata (EXIF, XMP, IPTC, text) from uploaded images before they are
// stored, without decoding or re-encoding them. Phone photos carry EXIF with the GPS
// position where they were taken, and every member of the tree can download a photo.
// Photos uploaded through the app are already clean (the photo editor redraws them on
// a canvas); this covers files sent straight to the API.
//
// If a file can't be parsed it is stored as it was: it already passed the type check,
// and refusing it would only break odd but valid images.

/**
 * The image with its metadata blocks removed. `body` comes from a request, so its type
 * is checked here, not assumed: a request sent as JSON is parsed before the upload route
 * sees it and could be an array, whose `length` and indexing mean something else.
 */
export function stripImageMetadata(body: unknown, type: string): Buffer {
  if (Array.isArray(body) || !Buffer.isBuffer(body)) throw new TypeError('Expected the image file as bytes');
  try {
    if (type === 'image/jpeg') return stripJpeg(body);
    if (type === 'image/png') return stripPng(body);
    if (type === 'image/webp') return stripWebp(body);
  } catch {
    // fall through: keep the original
  }
  return body;
}

const ascii = (b: Buffer, start: number, text: string) => b.toString('latin1', start, start + text.length) === text;

/**
 * JPEG: drop APP1 (EXIF, XMP), APP13 (Photoshop/IPTC) and COM segments. Keeps JFIF
 * (APP0), the colour profile (APP2) and Adobe colour info (APP14). Everything from
 * the start of the image data (SOS) on is copied unchanged.
 */
function stripJpeg(b: Buffer): Buffer {
  if (b[0] !== 0xff || b[1] !== 0xd8) return b;
  const parts: Buffer[] = [b.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return b; // not a marker where one should be: leave the file alone
    const marker = b[i + 1];
    if (marker === 0xff) {
      i += 1; // fill byte
      continue;
    }
    if (marker === 0xda) {
      parts.push(b.subarray(i)); // start of scan: the rest is image data
      return Buffer.concat(parts);
    }
    const length = b.readUInt16BE(i + 2);
    if (length < 2 || i + 2 + length > b.length) return b;
    const segment = b.subarray(i, i + 2 + length);
    const isMetadata = marker === 0xe1 || marker === 0xed || marker === 0xfe;
    if (!isMetadata) parts.push(segment);
    i += 2 + length;
  }
  return b;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** EXIF, text (tEXt/zTXt/iTXt, which also carry XMP) and the last-modified time. */
const PNG_METADATA = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);

/** PNG: drop metadata chunks; every other chunk (with its CRC) is copied unchanged. */
function stripPng(b: Buffer): Buffer {
  if (!b.subarray(0, 8).equals(PNG_SIGNATURE)) return b;
  const parts: Buffer[] = [b.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= b.length) {
    const length = b.readUInt32BE(i);
    const type = b.toString('latin1', i + 4, i + 8);
    const end = i + 12 + length;
    if (end > b.length) return b;
    if (!PNG_METADATA.has(type)) parts.push(b.subarray(i, end));
    i = end;
    if (type === 'IEND') return Buffer.concat(parts);
  }
  return b;
}

/**
 * WebP: drop the EXIF and XMP chunks, clear their flags in the VP8X header, and fix
 * the RIFF size.
 */
function stripWebp(b: Buffer): Buffer {
  if (!ascii(b, 0, 'RIFF') || !ascii(b, 8, 'WEBP')) return b;
  const end = Math.min(b.length, 8 + b.readUInt32LE(4));
  const parts: Buffer[] = [Buffer.from('RIFF\0\0\0\0WEBP', 'latin1')];
  let i = 12;
  let removed = false;
  while (i + 8 <= end) {
    const fourcc = b.toString('latin1', i, i + 4);
    const size = b.readUInt32LE(i + 4);
    const next = i + 8 + size + (size % 2); // chunks are padded to an even size
    if (next > end + 1) return b;
    const chunk = Buffer.from(b.subarray(i, Math.min(next, end)));
    if (fourcc === 'EXIF' || fourcc === 'XMP ') removed = true;
    else {
      // VP8X flags (first data byte): 0x08 = has EXIF, 0x04 = has XMP.
      if (fourcc === 'VP8X' && chunk.length > 8) chunk[8] &= ~0x0c;
      parts.push(chunk);
    }
    i = next;
  }
  if (!removed) return b;
  const out = Buffer.concat(parts);
  out.writeUInt32LE(out.length - 8, 4);
  return out;
}

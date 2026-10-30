import { randomUUID } from 'node:crypto';
import { HttpError } from '../errors';
import { query } from '../db';
import { getStorage } from '../storage';

// Uploaded photos are kept in the configured storage (S3-compatible or Google
// Drive) and recorded as (:Photo {id, treeId, storage, storageRef, contentType,
// size, uploadedBy, createdAt}). A person points at one through
// photoUrl = /api/trees/:treeId/photos/:id, which only members of that tree can open.

/** Just under Vercel's 4.5 MB request limit. The browser shrinks photos well below it first. */
export const PHOTO_MAX_BYTES = 4 * 1024 * 1024;

export interface PhotoRecord {
  id: string;
  treeId: string;
  storage: string;
  storageRef: string;
  contentType: string;
  size: number;
}

const IMAGE_TYPES: { type: string; ext: string; matches: (b: Buffer) => boolean }[] = [
  { type: 'image/jpeg', ext: 'jpg', matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    type: 'image/png',
    ext: 'png',
    matches: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  { type: 'image/gif', ext: 'gif', matches: (b) => /^GIF8[79]a$/.test(b.toString('latin1', 0, 6)) },
  {
    type: 'image/webp',
    ext: 'webp',
    matches: (b) => b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP',
  },
];

/**
 * The image type from the file's first bytes, ignoring what the client claims.
 * Only raster formats are allowed: an SVG served from our origin could run script.
 */
export function detectImageType(body: Buffer) {
  return IMAGE_TYPES.find((t) => body.length >= 12 && t.matches(body)) ?? null;
}

export const photoUrl = (treeId: string, photoId: string) => `/api/trees/${treeId}/photos/${photoId}`;

/** The photo id when `url` is one of this tree's uploaded photos, else null (e.g. an external link). */
export function ownPhotoId(treeId: string, url: unknown): string | null {
  // Check the type at run time, not just in TypeScript: a value that isn't a string
  // (e.g. an array from a tampered request) must never reach the string checks below.
  if (typeof url !== 'string') return null;
  const prefix = photoUrl(treeId, '');
  if (!url.startsWith(prefix)) return null;
  const id = url.slice(prefix.length);
  return /^[\w-]{1,100}$/.test(id) ? id : null;
}

export async function savePhoto(treeId: string, uploadedBy: string, body: Buffer, image: { type: string; ext: string }) {
  const storage = getStorage();
  if (!storage) throw new Error('Photo storage is not configured');
  const id = randomUUID();
  const storageRef = await storage.put(`${treeId}/${id}.${image.ext}`, body, image.type);
  try {
    await query(
      `CREATE (:Photo {id: $id, treeId: $treeId, storage: $storage, storageRef: $storageRef,
                       contentType: $contentType, size: $size, uploadedBy: $uploadedBy, createdAt: toString(datetime())})`,
      { id, treeId, storage: storage.name, storageRef, contentType: image.type, size: body.length, uploadedBy },
      'WRITE',
    );
  } catch (err) {
    await storage.remove(storageRef).catch(() => {});
    throw err;
  }
  return { id, url: photoUrl(treeId, id), contentType: image.type, size: body.length };
}

export async function findPhoto(treeId: string, id: string): Promise<PhotoRecord | null> {
  const [row] = await query<{ photo: PhotoRecord }>(
    `MATCH (ph:Photo {id: $id, treeId: $treeId})
     RETURN ph {.id, .treeId, .storage, .storageRef, .contentType, .size} AS photo`,
    { id, treeId },
  );
  return row?.photo ?? null;
}

const REMOVE_CONCURRENCY = 5;

/** Deletes files from storage. Failures are logged, not thrown: the data change already happened. */
export async function removeStoredFiles(refs: string[]): Promise<void> {
  if (!refs.length) return;
  const storage = getStorage();
  if (!storage) {
    console.error(`Photo storage is not configured; ${refs.length} stored file(s) were not deleted`);
    return;
  }
  // A few at a time: deleting a whole tree can mean hundreds of files, one request each.
  const queue = [...refs];
  const worker = async () => {
    for (let ref = queue.shift(); ref !== undefined; ref = queue.shift()) {
      await storage.remove(ref).catch((err) => console.error(`Could not delete stored photo ${ref}:`, err));
    }
  };
  await Promise.all(Array.from({ length: Math.min(REMOVE_CONCURRENCY, queue.length) }, worker));
}

/**
 * Call after people stop using these photo URLs (photo replaced, person deleted).
 * Each of this tree's uploaded photos that no person uses any more is deleted.
 */
export async function releasePhotos(treeId: string, urls: unknown[]): Promise<void> {
  if (!Array.isArray(urls)) return;
  const ids = [...new Set(urls.map((url) => ownPhotoId(treeId, url)).filter((id): id is string => !!id))];
  if (!ids.length) return;
  try {
    const rows = await query<{ ref: string }>(
      `UNWIND $ids AS id
       MATCH (ph:Photo {id: id, treeId: $treeId})
       WHERE NOT EXISTS { MATCH (p:Person {treeId: $treeId}) WHERE p.photoUrl = $prefix + id }
       WITH ph, ph.storageRef AS ref
       DELETE ph
       RETURN ref`,
      { ids, treeId, prefix: photoUrl(treeId, '') },
      'WRITE',
    );
    await removeStoredFiles(rows.map((r) => r.ref));
  } catch (err) {
    console.error('Could not release photos:', err);
  }
}

/**
 * A photo path in a person's details must be one of this tree's own uploads. A path
 * to another tree's photo would only show to members of both trees, so it's refused.
 */
export function assertPhotoInTree(treeId: string, url: unknown): void {
  if (typeof url === 'string' && url.startsWith('/api/') && !ownPhotoId(treeId, url)) {
    throw new HttpError(400, 'Use a photo uploaded to this tree, or an https:// link', 'photoOtherTree');
  }
}

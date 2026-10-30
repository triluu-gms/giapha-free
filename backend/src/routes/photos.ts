import express, { Router } from 'express';
import { HttpError, notFound } from '../errors';
import { getStorage } from '../storage';
import { currentTreeId } from '../trees/access';
import { stripImageMetadata } from '../trees/imageMetadata';
import { detectImageType, findPhoto, PHOTO_MAX_BYTES, savePhoto, uploadedBytes } from '../trees/photos';

// Mounted at /api/trees/:treeId/photos behind loadTree: viewers can see photos, editors upload.
export const photosRouter = Router();

function requireStorage() {
  const storage = getStorage();
  if (!storage) throw new HttpError(503, 'Photo uploads are not set up on this server');
  return storage;
}

// POST /api/trees/:treeId/photos  (body: the image file itself) -> { id, url, contentType, size }
// The returned url is then saved as a person's photoUrl.
photosRouter.post('/', express.raw({ type: () => true, limit: PHOTO_MAX_BYTES }), async (req, res) => {
  requireStorage();
  // Only raw bytes, and from here on a copy of them: the request's own value (which a
  // request sent as JSON could make an array or object) never reaches the code below.
  const bytes = uploadedBytes(req.body);
  if (!bytes) throw new HttpError(400, 'Send the image file as the request body');
  const image = detectImageType(bytes);
  if (!image) throw new HttpError(415, 'Upload a JPEG, PNG, WebP or GIF image');
  // EXIF can hold the GPS position where a photo was taken; every tree member can open it.
  const clean = stripImageMetadata(bytes, image.type);
  res.status(201).json(await savePhoto(currentTreeId(req), req.user!.id, clean, image));
});

// GET /api/trees/:treeId/photos/:id -> the image. Same-origin, so <img> sends the session cookie.
photosRouter.get('/:id', async (req, res) => {
  const photo = await findPhoto(currentTreeId(req), String(req.params.id));
  if (!photo) throw notFound('Photo');
  const file = await requireStorage().get(photo.storageRef);
  if (!file) throw notFound('Photo');
  res
    .set({
      'Content-Type': photo.contentType,
      // Photos never change (a new upload gets a new id); `private` keeps them out of shared caches.
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    })
    .send(file.body);
});

import { config } from '../config';
import { createGoogleDriveStorage } from './googleDrive';
import { createS3Storage } from './s3';

export interface StoredFile {
  body: Buffer;
  contentType: string;
}

/** A place to keep uploaded files. `ref` is whatever the backend needs to find the file again. */
export interface FileStorage {
  readonly name: string;
  /** Stores the file and returns its ref. `name` is a suggested, unique file name. */
  put(name: string, body: Buffer, contentType: string): Promise<string>;
  /** null when the file no longer exists. */
  get(ref: string): Promise<StoredFile | null>;
  /** Succeeds when the file is already gone. */
  remove(ref: string): Promise<void>;
}

let storage: FileStorage | null | undefined;

/** The configured storage (PHOTO_STORAGE), or null when uploads are disabled. Throws on bad settings. */
export function getStorage(): FileStorage | null {
  if (storage === undefined) {
    const kind = config.photos.storage;
    if (!kind) storage = null;
    else if (kind === 's3') storage = createS3Storage(config.photos.s3);
    else if (kind === 'gdrive') storage = createGoogleDriveStorage(config.photos.gdrive);
    else throw new Error(`PHOTO_STORAGE must be "s3", "gdrive" or empty, not "${kind}"`);
  }
  return storage;
}

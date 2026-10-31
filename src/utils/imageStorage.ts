import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { publicApiUrl, uploadDir } from '../config/env';
import { logger } from './logger';

/**
 * Where uploaded images are kept. Today that is the server's own disk; the rest of the
 * system only ever calls saveImage / deleteImage / publicImageUrl, so moving to cloud
 * storage later means replacing this one file.
 *
 * IMPORTANT FOR DEPLOYMENT: files land in UPLOAD_DIR (default ./uploads). A host whose disk
 * is reset on every deploy loses them, so UPLOAD_DIR has to point at a persistent volume
 * there, and the volume needs room for the photos (a few MB each, at most 10 per vehicle).
 */

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** The folders an upload may go into. A closed list: nothing here comes from a request. */
export type UploadFolder = 'vehicles' | 'packages';

export type ImageType = { ext: 'jpg' | 'png' | 'webp'; mime: string };

/**
 * What a file REALLY is, from its first bytes.
 *
 * The filename and the Content-Type header both come from the uploader, so neither can be
 * believed: a script renamed "photo.jpg" would be served back as an image from our own
 * domain. Only these three formats are accepted, recognised by their signatures.
 */
export function detectImage(bytes: Buffer): ImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { ext: 'jpg', mime: 'image/jpeg' };
  }
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { ext: 'png', mime: 'image/png' };
  }
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    return { ext: 'webp', mime: 'image/webp' };
  }
  return null;
}

/** Stored file names are a UUID and an extension we chose — never anything the user typed. */
export const IMAGE_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

export interface StoredImage {
  /** The file name, e.g. `3f2c….jpg`. What to pass back to deleteImage. */
  key: string;
  /** The path the API serves it at, e.g. `/uploads/vehicles/3f2c….jpg`. */
  path: string;
}

export class ImageRejected extends Error {
  constructor(
    message: string,
    readonly reason: 'too_large' | 'not_an_image' | 'empty',
  ) {
    super(message);
    this.name = 'ImageRejected';
  }
}

export async function saveImage(folder: UploadFolder, bytes: Buffer): Promise<StoredImage> {
  if (bytes.length === 0) throw new ImageRejected('That file is empty.', 'empty');
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new ImageRejected(`That image is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`, 'too_large');
  }
  const type = detectImage(bytes);
  if (!type) throw new ImageRejected('Upload a JPEG, PNG or WebP image.', 'not_an_image');

  const key = `${crypto.randomUUID()}.${type.ext}`;
  const dir = path.join(uploadDir, folder);
  await fs.mkdir(dir, { recursive: true });

  // Written under a temporary name and renamed, so a half-written file is never served.
  const finalPath = path.join(dir, key);
  const tempPath = `${finalPath}.part`;
  try {
    await fs.writeFile(tempPath, bytes);
    await fs.rename(tempPath, finalPath);
  } catch (err) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw err;
  }
  return { key, path: `/uploads/${folder}/${key}` };
}

/** Removes a stored file. A file that is already gone is not an error; a bad key is ignored. */
export async function deleteImage(folder: UploadFolder, key: string): Promise<void> {
  if (!IMAGE_KEY.test(key)) {
    logger.warn(`deleteImage ignored a malformed key '${key.slice(0, 60)}'`);
    return;
  }
  try {
    await fs.rm(path.join(uploadDir, folder, key), { force: true });
  } catch (err) {
    logger.warn(`Could not delete stored image ${folder}/${key}`, err);
  }
}

/**
 * A link a browser can load. Paths we stored are relative to this API, so they get the API's
 * public address in front; anything already absolute (a photo someone linked by hand) is
 * left exactly as it is.
 */
export function publicImageUrl(src: string): string {
  if (/^https?:\/\//i.test(src)) return src;
  return `${publicApiUrl}${src}`;
}

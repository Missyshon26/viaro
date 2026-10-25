import { env } from '../config/env';
import { logger } from './logger';

/**
 * PLACEHOLDER — driver document storage (spec §4.1, §10).
 *
 * TODO: real S3 wiring pending. Swap the body of uploadToS3 for an @aws-sdk/client-s3
 * PutObjectCommand (or a presigned-URL flow) once the bucket exists; the signature and
 * return value are already what callers depend on, so nothing outside this file changes.
 */
export interface UploadInput {
  fileName: string;
  mimeType: string;
  sizeBytes?: number;
}

export async function uploadToS3(userId: string, file: UploadInput): Promise<string> {
  const bucket = env.S3_BUCKET || 'abl-placeholder-bucket';
  const key = `drivers/${userId}/${Date.now()}-${sanitise(file.fileName)}`;

  logger.warn('[PLACEHOLDER] uploadToS3 called — no file was actually stored', {
    bucket,
    key,
    mimeType: file.mimeType,
  });

  return `https://${bucket}.s3.amazonaws.com/${key}`;
}

function sanitise(fileName: string): string {
  return fileName.replace(/[^\w.\-]/g, '_').slice(0, 120);
}

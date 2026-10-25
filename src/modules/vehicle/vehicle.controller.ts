import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { ApiError } from '../../utils/ApiError';
import { MAX_IMAGE_BYTES } from '../../utils/imageStorage';
import * as vehicleService from './vehicle.service';
import { body, params, query } from '../../utils/validate';
import type {
  CreateVehicleClassInput,
  ImageText,
  ListVehicleQuery,
  UpdateImageInput,
  UpdateVehicleClassInput,
} from './vehicle.validation';

export async function list(req: Request, res: Response): Promise<void> {
  const { includeInactive } = query<ListVehicleQuery>(req);
  // Only an admin may see retired classes; every other role gets the bookable ones.
  const showAll = Boolean(includeInactive) && req.user?.role === 'admin';
  res.json({ success: true, data: await vehicleService.list(showAll) });
}

export async function create(req: Request, res: Response): Promise<void> {
  const data = await vehicleService.create(body<CreateVehicleClassInput>(req));
  res.status(201).json({ success: true, data });
}

export async function update(req: Request, res: Response): Promise<void> {
  const data = await vehicleService.update(
    req.params.id as string,
    body<UpdateVehicleClassInput>(req),
  );
  res.json({ success: true, data });
}

export async function remove(req: Request, res: Response): Promise<void> {
  const data = await vehicleService.remove(req.params.id as string);
  res.json({ success: true, data });
}

/* --------------------------------- photos ---------------------------------- */

/**
 * Reads ONE file from a multipart upload, into memory, up to the size limit. Anything the
 * uploader sends beyond that (more files, many fields) is refused rather than buffered.
 * The bytes are never trusted: vehicle.service checks what they really are.
 */
const receive = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 4, parts: 6 },
}).single('file');

/** Middleware: runs the upload parser and turns its failures into ordinary API errors. */
export function receiveImage(req: Request, res: Response, next: NextFunction): void {
  receive(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      return next(
        err.code === 'LIMIT_FILE_SIZE'
          ? new ApiError(413, `That image is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`, { code: 'IMAGE_TOO_LARGE' })
          : ApiError.badRequest('Upload a single image in the "file" field.'),
      );
    }
    return next(err);
  });
}

export async function addImage(req: Request, res: Response): Promise<void> {
  if (!req.file) throw ApiError.badRequest('Choose an image to upload.');
  const data = await vehicleService.addImage(params<{ id: string }>(req).id, req.file.buffer, body<ImageText>(req));
  res.status(201).json({ success: true, data });
}

export async function updateImage(req: Request, res: Response): Promise<void> {
  const { id, key } = params<{ id: string; key: string }>(req);
  const data = await vehicleService.updateImage(id, key, body<UpdateImageInput>(req));
  res.json({ success: true, data });
}

export async function removeImage(req: Request, res: Response): Promise<void> {
  const { id, key } = params<{ id: string; key: string }>(req);
  res.json({ success: true, data: await vehicleService.removeImage(id, key) });
}

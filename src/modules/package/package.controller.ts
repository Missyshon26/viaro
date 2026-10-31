import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { ApiError } from '../../utils/ApiError';
import { MAX_IMAGE_BYTES } from '../../utils/imageStorage';
import { body, params, query } from '../../utils/validate';
import * as service from './package.service';
import type { CreatePackageInput, ListPackagesQuery, UpdatePackageInput } from './package.validation';

const idOf = (req: Request) => params<{ id: string }>(req).id;

export async function listAdmin(req: Request, res: Response): Promise<void> {
  res.json({ success: true, data: await service.listForAdmin(query<ListPackagesQuery>(req)) });
}

export async function getAdmin(req: Request, res: Response): Promise<void> {
  res.json({ success: true, data: await service.getForAdmin(idOf(req)) });
}

export async function create(req: Request, res: Response): Promise<void> {
  res.status(201).json({ success: true, data: await service.create(body<CreatePackageInput>(req)) });
}

export async function update(req: Request, res: Response): Promise<void> {
  res.json({ success: true, data: await service.update(idOf(req), body<UpdatePackageInput>(req)) });
}

export async function remove(req: Request, res: Response): Promise<void> {
  res.json({ success: true, data: await service.remove(idOf(req)) });
}

/** One file from a multipart upload, kept in memory up to the size limit; the service checks what it is. */
const receive = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 2, parts: 4 },
}).single('file');

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

export async function setImage(req: Request, res: Response): Promise<void> {
  if (!req.file) throw ApiError.badRequest('Choose an image to upload.');
  res.json({ success: true, data: await service.setImage(idOf(req), req.file.buffer) });
}

export async function removeImage(req: Request, res: Response): Promise<void> {
  res.json({ success: true, data: await service.removeImage(idOf(req)) });
}

/* ------------------------------ booking page ------------------------------ */

export async function listPublic(_req: Request, res: Response): Promise<void> {
  res.json({ success: true, data: await service.listVisible() });
}

export async function getPublic(req: Request, res: Response): Promise<void> {
  res.json({ success: true, data: await service.getVisible(idOf(req)) });
}

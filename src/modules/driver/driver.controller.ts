import type { Request, Response } from 'express';
import * as driverService from './driver.service';
import * as documents from './driver.documents';
import { body, params, query } from '../../utils/validate';
import type {
  ApplyInput,
  DocumentIdParam,
  DocumentProfileInput,
  SetStatusInput,
  UploadDocumentQuery,
} from './driver.validation';

export async function setStatus(req: Request, res: Response): Promise<void> {
  const data = await driverService.setOwnStatus(req.user!.userId, body<SetStatusInput>(req));
  res.json({ success: true, data });
}

export async function me(req: Request, res: Response): Promise<void> {
  const data = await driverService.getOwnProfile(req.user!.userId);
  res.json({ success: true, data });
}

export async function apply(req: Request, res: Response): Promise<void> {
  const data = await driverService.apply(req.user!.userId, body<ApplyInput>(req));
  res.status(201).json({ success: true, data });
}

/* -------------------------------- documents -------------------------------- */

export async function myDocuments(req: Request, res: Response): Promise<void> {
  const data = await documents.getMyDocuments(req.user!.userId);
  res.json({ success: true, data });
}

export async function setDocumentProfile(req: Request, res: Response): Promise<void> {
  const data = await documents.setProfile(req.user!.userId, body<DocumentProfileInput>(req));
  res.json({ success: true, data });
}

export async function uploadDocument(req: Request, res: Response): Promise<void> {
  const q = query<UploadDocumentQuery>(req);
  const data = await documents.upload(req.user!.userId, {
    type: q.type,
    fileName: q.fileName,
    expiresAt: q.expiresAt,
    // express.raw hands over a Buffer; anything else means no file came through.
    mimeType: String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase(),
    data: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
  });
  res.status(201).json({ success: true, data });
}

export async function removeDocument(req: Request, res: Response): Promise<void> {
  const data = await documents.remove(req.user!.userId, params<DocumentIdParam>(req).documentId);
  res.json({ success: true, data });
}

export async function documentFile(req: Request, res: Response): Promise<void> {
  const file = await documents.openFile(params<DocumentIdParam>(req).documentId, req.user!);
  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('Content-Length', String(file.sizeBytes));
  res.setHeader('Content-Disposition', `inline; filename="${file.fileName.replace(/"/g, '')}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  file.stream.on('error', () => {
    if (!res.headersSent) res.status(404).end();
    else res.end();
  });
  file.stream.pipe(res);
}

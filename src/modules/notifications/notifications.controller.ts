import type { Request, Response } from 'express';
import * as notificationsService from './notifications.service';
import { params, query } from '../../utils/validate';
import type { PaginationQuery } from '../../utils/pagination';
import type { IdParam } from './notifications.validation';

export async function list(req: Request, res: Response): Promise<void> {
  const data = await notificationsService.listForUser(req.user!.userId, query<PaginationQuery>(req));
  res.json({ success: true, data });
}

export async function markRead(req: Request, res: Response): Promise<void> {
  const data = await notificationsService.markRead(params<IdParam>(req).id, req.user!.userId);
  res.json({ success: true, data });
}

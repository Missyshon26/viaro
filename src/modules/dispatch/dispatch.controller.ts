import type { Request, Response } from 'express';
import * as dispatchService from './dispatch.service';
import { body, query } from '../../utils/validate';
import type { PaginationQuery } from '../../utils/pagination';
import type { AssignDriverInput } from './dispatch.validation';

export async function pool(req: Request, res: Response): Promise<void> {
  // The driver-facing route serves the same pool without the rider's contact details.
  const data = await dispatchService.listDispatchPool(query<PaginationQuery>(req), req.user!.role);
  res.json({ success: true, data });
}

/** UML «Assign Driver to Booking» — admin-only manual dispatch. */
export async function assign(req: Request, res: Response): Promise<void> {
  const { driverId } = body<AssignDriverInput>(req);
  const data = await dispatchService.assignSpecificDriver(req.params.id as string, driverId);
  res.json({ success: true, data });
}

/** UML «Publish Booking to Public Pool» — normally automatic; this is the manual retry. */
export async function publish(req: Request, res: Response): Promise<void> {
  const data = await dispatchService.republishToPool(req.params.id as string);
  res.json({ success: true, data });
}

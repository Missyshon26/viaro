import type { Request, Response } from 'express';
import * as dispatchService from './dispatch.service';
import { body } from '../../utils/validate';
import type { AssignDriverInput } from './dispatch.validation';

/** UML «Assign Driver to Booking» — admin-only. */
export async function assign(req: Request, res: Response): Promise<void> {
  const { driverId } = body<AssignDriverInput>(req);
  const data = await dispatchService.assignSpecificDriver(req.params.id as string, driverId);
  res.json({ success: true, data });
}

import type { Request, Response } from 'express';
import * as tripService from './trip.service';
import { body, params, query } from '../../utils/validate';
import type { ListTripsQuery } from './trip.validation';
import type {
  AdminTripStatusInput,
  CancelInput,
  ChangeLocationInput,
  IdParam,
  RateInput,
  VehicleClassInput,
} from './trip.validation';

export async function accept(req: Request, res: Response): Promise<void> {
  const data = await tripService.acceptBooking(params<IdParam>(req).id, req.user!.userId);
  res.status(201).json({ success: true, data });
}

export async function list(req: Request, res: Response): Promise<void> {
  const data = await tripService.listTripsForUser(req.user!, query<ListTripsQuery>(req));
  res.json({ success: true, data });
}

export async function getById(req: Request, res: Response): Promise<void> {
  const data = await tripService.getTripForUser(params<IdParam>(req).id, req.user!);
  res.json({ success: true, data });
}

export async function start(req: Request, res: Response): Promise<void> {
  const data = await tripService.startTrip(params<IdParam>(req).id, req.user!.userId);
  res.json({ success: true, data });
}

export async function noShow(req: Request, res: Response): Promise<void> {
  const data = await tripService.markTripNoShow(params<IdParam>(req).id, req.user!.userId);
  res.json({ success: true, data });
}

export async function revertNoShow(req: Request, res: Response): Promise<void> {
  const data = await tripService.revertTripNoShow(params<IdParam>(req).id, req.user!.userId);
  res.json({ success: true, data });
}

export async function enroute(req: Request, res: Response): Promise<void> {
  const data = await tripService.markEnroute(params<IdParam>(req).id, req.user!.userId);
  res.json({ success: true, data });
}

export async function arrived(req: Request, res: Response): Promise<void> {
  const data = await tripService.markArrived(params<IdParam>(req).id, req.user!.userId);
  res.json({ success: true, data });
}

export async function complete(req: Request, res: Response): Promise<void> {
  const data = await tripService.completeTrip(params<IdParam>(req).id, req.user!.userId);
  res.json({ success: true, data });
}

export async function cancel(req: Request, res: Response): Promise<void> {
  const data = await tripService.cancelTripByDriver(
    params<IdParam>(req).id,
    req.user!.userId,
    body<CancelInput>(req)?.reason,
  );
  res.json({ success: true, data });
}

export async function changeVehicleClass(req: Request, res: Response): Promise<void> {
  const data = await tripService.changeVehicleClass(
    params<IdParam>(req).id,
    req.user!.userId,
    body<VehicleClassInput>(req).vehicleClass,
  );
  res.json({ success: true, data });
}

export async function changeLocation(req: Request, res: Response): Promise<void> {
  const data = await tripService.changeLocation(
    params<IdParam>(req).id,
    req.user!.userId,
    body<ChangeLocationInput>(req),
  );
  res.json({ success: true, data });
}

export async function rate(req: Request, res: Response): Promise<void> {
  const data = await tripService.rateTrip(
    params<IdParam>(req).id,
    req.user!.userId,
    body<RateInput>(req),
  );
  res.status(201).json({ success: true, data });
}

/** PATCH /trips/:id/status — admin-only manual move of the trip lifecycle. */
export async function adminSetStatus(req: Request, res: Response): Promise<void> {
  const { status, reason } = body<AdminTripStatusInput>(req);
  const data = await tripService.adminSetTripStatus(
    req.params.id as string,
    status,
    req.user!.userId,
    reason,
  );
  res.json({ success: true, data });
}

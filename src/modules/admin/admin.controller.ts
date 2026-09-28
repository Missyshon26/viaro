import type { Request, Response } from 'express';
import * as adminService from './admin.service';
import { body, params, query } from '../../utils/validate';
import type { PaginationQuery } from '../../utils/pagination';
import * as settingsService from './settings.service';
import type {
  CreateDriverInput,
  IdParam,
  PayoutDefaultsInput,
  SettingsUpdateInput,
  UpdateDriverInput,
} from './admin.validation';

export async function createDriver(req: Request, res: Response): Promise<void> {
  const data = await adminService.createDriver(req.user!.userId, body<CreateDriverInput>(req));
  res.status(201).json({ success: true, data });
}

export async function listDrivers(req: Request, res: Response): Promise<void> {
  const data = await adminService.listDrivers(req.user!, query<PaginationQuery>(req));
  res.json({ success: true, data });
}

export async function updateDriver(req: Request, res: Response): Promise<void> {
  const data = await adminService.updateDriver(
    req.user!,
    params<IdParam>(req).id,
    body<UpdateDriverInput>(req),
  );
  res.json({ success: true, data });
}

export async function dashboardBookings(req: Request, res: Response): Promise<void> {
  const data = await adminService.listAllBookings(query<PaginationQuery>(req));
  res.json({ success: true, data });
}

export async function dashboardUsers(req: Request, res: Response): Promise<void> {
  const data = await adminService.listAllUsers(query<PaginationQuery>(req));
  res.json({ success: true, data });
}

export async function subscriptionRevenue(_req: Request, res: Response): Promise<void> {
  const data = await adminService.subscriptionRevenue();
  res.json({ success: true, data });
}

export async function driverPenalties(req: Request, res: Response): Promise<void> {
  const data = await adminService.driverPenalties(req.user!);
  res.json({ success: true, data });
}

export async function getSettings(_req: Request, res: Response): Promise<void> {
  const data = await settingsService.getSettings();
  res.json({ success: true, data });
}

export async function updatePayoutDefaults(req: Request, res: Response): Promise<void> {
  const data = await settingsService.updatePayoutDefaults(
    req.user!.userId,
    body<PayoutDefaultsInput>(req),
  );
  res.json({ success: true, data });
}

export async function updateSettings(req: Request, res: Response): Promise<void> {
  const data = await settingsService.updateSettings(req.user!.userId, body<SettingsUpdateInput>(req));
  res.json({ success: true, data });
}

export async function publicSettings(_req: Request, res: Response): Promise<void> {
  const data = await settingsService.getPublicSettings();
  res.json({ success: true, data });
}

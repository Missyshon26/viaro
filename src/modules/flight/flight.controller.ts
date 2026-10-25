import type { Request, Response } from 'express';
import * as flightService from './flight.service';
import { params, query } from '../../utils/validate';
import type { FlightQuery } from './flight.validation';

export async function getFlight(req: Request, res: Response): Promise<void> {
  const { date } = query<FlightQuery>(req);
  const data = await flightService.getFlight(params<{ flightNumber: string }>(req).flightNumber, date);
  res.json({ success: true, data });
}

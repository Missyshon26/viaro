import type { Request, Response } from 'express';
import type { TripType } from '../../models/Booking';
import * as cancellationService from './cancellation.service';
import { body, params } from '../../utils/validate';
import type { CancelBody, IdParam } from './cancellation.validation';

/**
 * The three endpoints differ only by which trip type they accept — all of them evaluate
 * the SAME policy function (spec §8 rule 6).
 */
function handlerFor(tripType: TripType) {
  return async (req: Request, res: Response): Promise<void> => {
    const data = await cancellationService.cancelTripByCustomer(
      params<IdParam>(req).id,
      req.user!.userId,
      tripType,
      body<CancelBody>(req)?.reason,
    );
    res.json({ success: true, data });
  };
}

export const cancelPointToPoint = handlerFor('point2point');
export const cancelAirport = handlerFor('airport');
export const cancelHourly = handlerFor('hourly');

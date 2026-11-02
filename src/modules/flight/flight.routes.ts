import { Router } from 'express';
import * as controller from './flight.controller';
import { flightParamSchema, flightQuerySchema } from './flight.validation';
import { createRateLimiter } from '../../middlewares/rateLimiter';
import { validate } from '../../utils/validate';
import { asyncHandler } from '../../utils/asyncHandler';

/** Mounted at /flight */
const router = Router();

/*
 * Open to visitors: the booking form checks a flight before anyone signs in. Every lookup is a call
 * to a metered provider, so a caller is held to a modest number per minute and the service keeps
 * answers for a few minutes and caps real provider calls per hour (flight.service).
 */
const lookupLimiter = createRateLimiter({ windowMs: 60_000, max: 20, keyPrefix: 'ratelimit:flight' });

router.get(
  '/:flightNumber',
  lookupLimiter,
  validate({ params: flightParamSchema, query: flightQuerySchema }),
  asyncHandler(controller.getFlight),
);

export default router;

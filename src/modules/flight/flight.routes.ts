import { Router } from 'express';
import * as controller from './flight.controller';
import { flightParamSchema, flightQuerySchema } from './flight.validation';
import { createRateLimiter } from '../../middlewares/rateLimiter';
import { validate } from '../../utils/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { authGuard } from '../../middlewares/authGuard';
import { roleGuard } from '../../middlewares/roleGuard';

/** Mounted at /flight */
const router = Router();

/*
 * Every lookup is a call to a metered provider, and customers can now trigger them from
 * the booking form, so a signed-in user is held to a modest number per minute.
 */
const lookupLimiter = createRateLimiter({ windowMs: 60_000, max: 20, keyPrefix: 'ratelimit:flight' });

router.get(
  '/:flightNumber',
  authGuard,
  roleGuard('driver', 'admin', 'customer'),
  lookupLimiter,
  validate({ params: flightParamSchema, query: flightQuerySchema }),
  asyncHandler(controller.getFlight),
);

export default router;

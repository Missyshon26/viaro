import { Router } from 'express';
import * as controller from './booking.controller';
import {
  cancelBookingQuerySchema,
  createBookingSchema,
  favoriteDriverSchema,
  idParamSchema,
  ridesQuerySchema,
  updateBookingSchema,
} from './booking.validation';
import { validate } from '../../utils/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { authGuard } from '../../middlewares/authGuard';
import { roleGuard } from '../../middlewares/roleGuard';
import { bookingRateLimiter } from '../../middlewares/rateLimiter';

/** Mounted at /bookings */
export const bookingRouter = Router();
bookingRouter.use(authGuard);

bookingRouter.post(
  '/',
  roleGuard('customer'),
  // After authGuard, so the counter is per customer rather than per shared IP.
  bookingRateLimiter,
  validate({ body: createBookingSchema }),
  asyncHandler(controller.create),
);

// Spec §2 RBAC matrix: drivers have NO booking access — they read trip data instead.
bookingRouter.get(
  '/:id',
  roleGuard('customer', 'admin', 'company'),
  validate({ params: idParamSchema }),
  asyncHandler(controller.getById),
);

bookingRouter.patch(
  '/:id',
  roleGuard('customer'),
  validate({ params: idParamSchema, body: updateBookingSchema }),
  asyncHandler(controller.update),
);

bookingRouter.delete(
  '/:id',
  roleGuard('customer'),
  validate({ params: idParamSchema, query: cancelBookingQuerySchema }),
  asyncHandler(controller.cancel),
);

bookingRouter.post(
  '/:id/favorite-driver',
  roleGuard('customer'),
  validate({ params: idParamSchema, body: favoriteDriverSchema }),
  asyncHandler(controller.favoriteDriver),
);

/** Mounted at /users/me/rides — customer ride history and receipts (spec §4.3). */
export const customerRidesRouter = Router();
customerRidesRouter.use(authGuard, roleGuard('customer'));

customerRidesRouter.get('/', validate({ query: ridesQuerySchema }), asyncHandler(controller.myRides));
customerRidesRouter.get(
  '/:id/receipt',
  validate({ params: idParamSchema }),
  asyncHandler(controller.receipt),
);

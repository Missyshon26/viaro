import { Router } from 'express';
import * as controller from './dispatch.controller';
import { assignDriverSchema, poolQuerySchema } from './dispatch.validation';
import { idParamSchema } from '../booking/booking.validation';
import { validate } from '../../utils/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { authGuard } from '../../middlewares/authGuard';
import { roleGuard } from '../../middlewares/roleGuard';

/** Mounted at /admin/dispatch — ops visibility. */
export const adminDispatchRouter = Router();

adminDispatchRouter.get(
  '/pool',
  authGuard,
  roleGuard('admin'),
  validate({ query: poolQuerySchema }),
  asyncHandler(controller.pool),
);

/**
 * UML «Assign Driver to Booking», which the diagram associates with the Admin actor.
 *
 * Dispatch is otherwise automatic — a booking is broadcast the moment it is created —
 * so this is the manual override, and admin-only because the diagram draws no other
 * actor against it.
 */
adminDispatchRouter.post(
  '/:id/assign',
  authGuard,
  roleGuard('admin'),
  validate({ params: idParamSchema, body: assignDriverSchema }),
  asyncHandler(controller.assign),
);

/**
 * UML «Publish Booking to Public Pool».
 *
 * The diagram draws no actor on that use case, and the code agrees: publishing happens
 * by itself when a booking is created. This route exists for the case the automatic run
 * cannot cover — a booking left 'pending' because the fire-and-forget dispatch threw, or
 * one that needs re-broadcasting after nobody claimed it. Admin-only, like assignment.
 */
adminDispatchRouter.post(
  '/:id/publish',
  authGuard,
  roleGuard('admin'),
  validate({ params: idParamSchema }),
  asyncHandler(controller.publish),
);

/**
 * Mounted at /dispatch — the driver's own view of open requests
 * (driver screen 09 "Public pool", desktop 15 "Requests and pool").
 *
 * Same data as the admin pool, but reachable by drivers: they are the ones expected
 * to claim these. Previously only /admin/dispatch/pool existed, so a driver polling
 * for work got a 403.
 */
export const dispatchRouter = Router();

dispatchRouter.get(
  '/pool',
  authGuard,
  roleGuard('driver', 'admin'),
  validate({ query: poolQuerySchema }),
  asyncHandler(controller.pool),
);

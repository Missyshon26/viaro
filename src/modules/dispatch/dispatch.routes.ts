import { Router } from 'express';
import * as controller from './dispatch.controller';
import { assignDriverSchema } from './dispatch.validation';
import { idParamSchema } from '../booking/booking.validation';
import { validate } from '../../utils/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { authGuard } from '../../middlewares/authGuard';
import { roleGuard } from '../../middlewares/roleGuard';

/** Mounted at /admin/dispatch. */
export const adminDispatchRouter = Router();

/**
 * UML «Assign Driver to Booking», which the diagram associates with the Admin actor.
 *
 * A booking is not offered to drivers: it waits until an operator assigns one here. Admin-only,
 * because the diagram draws no other actor against it.
 */
adminDispatchRouter.post(
  '/:id/assign',
  authGuard,
  roleGuard('admin'),
  validate({ params: idParamSchema, body: assignDriverSchema }),
  asyncHandler(controller.assign),
);

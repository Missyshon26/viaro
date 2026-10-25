import { Router } from 'express';
import * as controller from './trip.controller';
import {
  adminTripStatusSchema,
  cancelSchema,
  changeLocationSchema,
  idParamSchema,
  listTripsQuerySchema,
  rateSchema,
  vehicleClassSchema,
} from './trip.validation';
import { validate } from '../../utils/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { authGuard } from '../../middlewares/authGuard';
import { roleGuard } from '../../middlewares/roleGuard';

/**
 * Mounted at /trips, alongside cancellation.routes and chat.routes. Guards stay on the
 * individual routes — router-level middleware would also run for requests destined for
 * those sibling routers.
 */
const router = Router();

// Accepts a booking id (build prompt) or a trip id (spec §4.5) — see trip.service.
router.post(
  '/:id/accept',
  authGuard,
  roleGuard('driver'),
  validate({ params: idParamSchema }),
  asyncHandler(controller.accept),
);

// Role-scoped list — must be declared before '/:id' or "trips" would match as an id.
router.get(
  '/',
  authGuard,
  roleGuard('customer', 'driver', 'admin', 'company'),
  validate({ query: listTripsQuerySchema }),
  asyncHandler(controller.list),
);

// All four roles may read a trip; ownership and field-stripping are applied in the service.
router.get(
  '/:id',
  authGuard,
  roleGuard('customer', 'driver', 'admin', 'company'),
  validate({ params: idParamSchema }),
  asyncHandler(controller.getById),
);

router.post(
  '/:id/no-show',
  authGuard,
  roleGuard('admin'),
  validate({ params: idParamSchema }),
  asyncHandler(controller.noShow),
);

router.post(
  '/:id/no-show/revert',
  authGuard,
  roleGuard('admin'),
  validate({ params: idParamSchema }),
  asyncHandler(controller.revertNoShow),
);

router.post(
  '/:id/enroute',
  authGuard,
  roleGuard('driver'),
  validate({ params: idParamSchema }),
  asyncHandler(controller.enroute),
);

router.post(
  '/:id/arrived',
  authGuard,
  roleGuard('driver'),
  validate({ params: idParamSchema }),
  asyncHandler(controller.arrived),
);

router.post(
  '/:id/start',
  authGuard,
  roleGuard('driver'),
  validate({ params: idParamSchema }),
  asyncHandler(controller.start),
);

router.post(
  '/:id/complete',
  authGuard,
  roleGuard('driver'),
  validate({ params: idParamSchema }),
  asyncHandler(controller.complete),
);

router.post(
  '/:id/cancel',
  authGuard,
  roleGuard('driver'),
  validate({ params: idParamSchema, body: cancelSchema }),
  asyncHandler(controller.cancel),
);

router.patch(
  '/:id/vehicle-class',
  authGuard,
  roleGuard('customer'),
  validate({ params: idParamSchema, body: vehicleClassSchema }),
  asyncHandler(controller.changeVehicleClass),
);

router.patch(
  '/:id/location',
  authGuard,
  roleGuard('customer'),
  validate({ params: idParamSchema, body: changeLocationSchema }),
  asyncHandler(controller.changeLocation),
);

/**
 * UML has no use case for this — it is an operations tool, not a product feature.
 * Admin-only because moving a trip by hand settles money and frees a chauffeur; see
 * tripService.adminSetTripStatus for why it runs the real side effects rather than
 * writing the status field.
 */
router.patch(
  '/:id/status',
  authGuard,
  roleGuard('admin'),
  validate({ params: idParamSchema, body: adminTripStatusSchema }),
  asyncHandler(controller.adminSetStatus),
);

router.post(
  '/:id/rate',
  authGuard,
  roleGuard('customer'),
  validate({ params: idParamSchema, body: rateSchema }),
  asyncHandler(controller.rate),
);

export default router;

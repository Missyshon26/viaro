import { Router } from 'express';
import * as controller from './admin.controller';
import {
  createDriverSchema,
  idParamSchema,
  listQuerySchema,
  payoutDefaultsSchema,
  settingsUpdateSchema,
  updateDriverSchema,
} from './admin.validation';
import { validate } from '../../utils/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { authGuard } from '../../middlewares/authGuard';
import { roleGuard } from '../../middlewares/roleGuard';

/** Mounted at /admin */
const router = Router();
router.use(authGuard);

/* -------------------------------- drivers --------------------------------- */

// Registered before '/drivers/:id' so the literal path is never captured as an id.
router.get(
  '/drivers/penalties',
  roleGuard('admin', 'company'),
  asyncHandler(controller.driverPenalties),
);

router.post(
  '/drivers',
  roleGuard('company'),
  validate({ body: createDriverSchema }),
  asyncHandler(controller.createDriver),
);

router.get(
  '/drivers',
  roleGuard('company', 'admin'),
  validate({ query: listQuerySchema }),
  asyncHandler(controller.listDrivers),
);

// Company edits its own roster; admin edits platform drivers and sets their per-trip
// charge. Ownership is enforced in the service.
router.patch(
  '/drivers/:id',
  roleGuard('company', 'admin'),
  validate({ params: idParamSchema, body: updateDriverSchema }),
  asyncHandler(controller.updateDriver),
);

/* -------------------------------- settings -------------------------------- */

// Business settings edited in the console instead of .env (settings.service.ts).
router.get('/settings', roleGuard('admin'), asyncHandler(controller.getSettings));

router.patch(
  '/settings',
  roleGuard('admin'),
  validate({ body: settingsUpdateSchema }),
  asyncHandler(controller.updateSettings),
);

router.patch(
  '/settings/payout',
  roleGuard('admin'),
  validate({ body: payoutDefaultsSchema }),
  asyncHandler(controller.updatePayoutDefaults),
);

/* ------------------------------- dashboards ------------------------------- */

router.get(
  '/dashboard/bookings',
  roleGuard('admin'),
  validate({ query: listQuerySchema }),
  asyncHandler(controller.dashboardBookings),
);

router.get(
  '/dashboard/users',
  roleGuard('admin'),
  validate({ query: listQuerySchema }),
  asyncHandler(controller.dashboardUsers),
);

/*
 * Admin only.
 *
 * This aggregates every customer subscription on the platform into a monthly revenue
 * figure — passenger income that belongs to Viaro, not to any fleet operator. A company
 * has no roster-scoped view of it to be given (subscriptions have no driver), so there is
 * nothing here it can legitimately see; allowing 'company' simply handed operators the
 * platform's own subscription takings.
 */
router.get(
  '/revenue/subscriptions',
  roleGuard('admin'),
  asyncHandler(controller.subscriptionRevenue),
);

export default router;

/**
 * Mounted at /settings — the one setting the public website needs: which inbox quote
 * requests and contact messages go to. No auth, and nothing commercial is exposed.
 */
export const publicSettingsRouter = Router();
publicSettingsRouter.get('/public', asyncHandler(controller.publicSettings));

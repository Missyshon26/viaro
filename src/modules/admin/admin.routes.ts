import { Router } from 'express';
import * as controller from './admin.controller';
import {
  adminAgreementReviewSchema,
  adminJourneySchema,
  adminRefundSchema,
  adminRejectSchema,
  adminTripSchema,
  createDriverSchema,
  idParamSchema,
  journeysQuerySchema,
  listQuerySchema,
  payoutDefaultsSchema,
  settingsUpdateSchema,
  updateDriverSchema,
  usersQuerySchema,
} from './admin.validation';
import {
  createCustomerSchema,
  exportCustomersQuerySchema,
  listCustomersQuerySchema,
  updateCustomerSchema,
} from './admin.customers.validation';
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

router.get('/dashboard/summary', roleGuard('admin'), asyncHandler(controller.dashboardSummary));

router.get('/places/autocomplete', roleGuard('admin'), asyncHandler(controller.placeSuggestions));

router.get(
  '/dashboard/journeys',
  roleGuard('admin'),
  validate({ query: journeysQuerySchema }),
  asyncHandler(controller.dashboardJourneys),
);

router.get(
  '/dashboard/users',
  roleGuard('admin'),
  validate({ query: usersQuerySchema }),
  asyncHandler(controller.dashboardUsers),
);

router.get(
  '/dashboard/users/:id',
  roleGuard('admin'),
  validate({ params: idParamSchema }),
  asyncHandler(controller.dashboardUser),
);

/* --------------------------------- clients ---------------------------------- */

// Registered before '/customers/:id' so "export" is never read as an id.
router.get(
  '/customers/export',
  roleGuard('admin'),
  validate({ query: exportCustomersQuerySchema }),
  asyncHandler(controller.exportCustomers),
);
router.get(
  '/customers',
  roleGuard('admin'),
  validate({ query: listCustomersQuerySchema }),
  asyncHandler(controller.listCustomers),
);
router.post(
  '/customers',
  roleGuard('admin'),
  validate({ body: createCustomerSchema }),
  asyncHandler(controller.createCustomer),
);
router.patch(
  '/customers/:id',
  roleGuard('admin'),
  validate({ params: idParamSchema, body: updateCustomerSchema }),
  asyncHandler(controller.updateCustomer),
);

/* ---------------------------- trips for clients ---------------------------- */

// Registered before anything keyed by id so "quote" is never read as one.
router.post(
  '/bookings/quote',
  roleGuard('admin'),
  validate({ body: adminTripSchema }),
  asyncHandler(controller.quoteTrip),
);
router.post(
  '/bookings/:id/reject',
  roleGuard('admin'),
  validate({ params: idParamSchema, body: adminRejectSchema }),
  asyncHandler(controller.rejectBookingRequest),
);
router.post(
  '/bookings/:id/refund',
  roleGuard('admin'),
  validate({ params: idParamSchema, body: adminRefundSchema }),
  asyncHandler(controller.refundBooking),
);
router.post(
  '/bookings/:id/payment-link',
  roleGuard('admin'),
  validate({ params: idParamSchema }),
  asyncHandler(controller.sendPaymentLink),
);
router.post(
  '/bookings/journey/quote',
  roleGuard('admin'),
  validate({ body: adminJourneySchema }),
  asyncHandler(controller.quoteJourney),
);
router.post(
  '/bookings/journey',
  roleGuard('admin'),
  validate({ body: adminJourneySchema }),
  asyncHandler(controller.createJourney),
);
router.post(
  '/bookings',
  roleGuard('admin'),
  validate({ body: adminTripSchema }),
  asyncHandler(controller.createTrip),
);

router.post(
  '/users/:id/agreement/review',
  roleGuard('admin'),
  validate({ params: idParamSchema, body: adminAgreementReviewSchema }),
  asyncHandler(controller.reviewUserAgreement),
);

router.get('/calendar/status', roleGuard('admin'), asyncHandler(controller.calendarState));

router.post(
  '/bookings/:id/calendar-sync',
  roleGuard('admin'),
  validate({ params: idParamSchema }),
  asyncHandler(controller.syncBookingToCalendar),
);

router.post(
  '/bookings/:id/email-invoice',
  roleGuard('admin'),
  validate({ params: idParamSchema }),
  asyncHandler(controller.emailInvoice),
);

// A passenger's signed agreement, with the signature image, for the user detail screen.
router.get(
  '/users/:id/agreement',
  roleGuard('admin'),
  validate({ params: idParamSchema }),
  asyncHandler(controller.userAgreement),
);

/*
 * Admin only.
 *
 * This aggregates every customer subscription on the platform into a monthly revenue
 * figure — passenger income that belongs to ABL, not to any fleet operator. A company
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

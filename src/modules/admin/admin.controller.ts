import type { Request, Response } from 'express';
import * as adminService from './admin.service';
import { body, params, query } from '../../utils/validate';
import type { PaginationQuery } from '../../utils/pagination';
import * as settingsService from './settings.service';
import * as usersService from '../users/users.service';
import * as customers from './admin.customers';
import * as adminTrips from './admin.trips';
import * as paymentLinks from '../payments/paymentLink';
import { refundBookingAmount } from '../payments/cardPayments';
import { rejectBooking } from '../booking/booking.reject';
import { calendarStatus, explain, syncInOrder } from '../calendar/calendar.sync';
import { ApiError } from '../../utils/ApiError';
import { emailInvoiceToCustomer } from '../booking/booking.invoiceMail';
import type {
  CreateCustomerInput,
  ExportCustomersQuery,
  ListCustomersQuery,
  UpdateCustomerInput,
} from './admin.customers.validation';
import type {
  AdminAgreementReviewInput,
  AdminJourneyInput,
  AdminRejectInput,
  AdminRefundInput,
  AdminTripInput,
  CreateDriverInput,
  IdParam,
  PayoutDefaultsInput,
  SettingsUpdateInput,
  UpdateDriverInput,
} from './admin.validation';

export async function createDriver(req: Request, res: Response): Promise<void> {
  const data = await adminService.createDriver(req.user!.userId, body<CreateDriverInput>(req));
  res.status(201).json({ success: true, data });
}

export async function listDrivers(req: Request, res: Response): Promise<void> {
  const data = await adminService.listDrivers(req.user!, query<PaginationQuery>(req));
  res.json({ success: true, data });
}

export async function updateDriver(req: Request, res: Response): Promise<void> {
  const data = await adminService.updateDriver(
    req.user!,
    params<IdParam>(req).id,
    body<UpdateDriverInput>(req),
  );
  res.json({ success: true, data });
}

export async function dashboardBookings(req: Request, res: Response): Promise<void> {
  const data = await adminService.listAllBookings(query<PaginationQuery>(req));
  res.json({ success: true, data });
}

export async function dashboardUsers(req: Request, res: Response): Promise<void> {
  const data = await adminService.listAllUsers(query<PaginationQuery>(req));
  res.json({ success: true, data });
}

export async function subscriptionRevenue(_req: Request, res: Response): Promise<void> {
  const data = await adminService.subscriptionRevenue();
  res.json({ success: true, data });
}

export async function driverPenalties(req: Request, res: Response): Promise<void> {
  const data = await adminService.driverPenalties(req.user!);
  res.json({ success: true, data });
}

export async function getSettings(_req: Request, res: Response): Promise<void> {
  const data = await settingsService.getSettings();
  res.json({ success: true, data });
}

export async function updatePayoutDefaults(req: Request, res: Response): Promise<void> {
  const data = await settingsService.updatePayoutDefaults(
    req.user!.userId,
    body<PayoutDefaultsInput>(req),
  );
  res.json({ success: true, data });
}

export async function updateSettings(req: Request, res: Response): Promise<void> {
  const data = await settingsService.updateSettings(req.user!.userId, body<SettingsUpdateInput>(req));
  res.json({ success: true, data });
}

export async function publicSettings(_req: Request, res: Response): Promise<void> {
  const data = await settingsService.getPublicSettings();
  res.json({ success: true, data });
}

export async function userAgreement(req: Request, res: Response): Promise<void> {
  const data = await usersService.getAgreementStatus(params<IdParam>(req).id, { withSignature: true });
  res.json({ success: true, data });
}

/* --------------------------------- clients ---------------------------------- */

export async function listCustomers(req: Request, res: Response): Promise<void> {
  const data = await customers.listCustomers(query<ListCustomersQuery>(req));
  res.json({ success: true, data });
}

export async function createCustomer(req: Request, res: Response): Promise<void> {
  const data = await customers.createCustomer(body<CreateCustomerInput>(req));
  res.status(201).json({ success: true, data });
}

export async function updateCustomer(req: Request, res: Response): Promise<void> {
  const data = await customers.updateCustomer(params<IdParam>(req).id, body<UpdateCustomerInput>(req));
  res.json({ success: true, data });
}

/** GET /admin/customers/export — the clients list as a spreadsheet download. */
export async function exportCustomers(req: Request, res: Response): Promise<void> {
  const file = await customers.exportCustomers(query<ExportCustomersQuery>(req));
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
  res.setHeader('Content-Length', String(file.buffer.length));
  // Names, emails and phone numbers: nothing between here and the operator should keep a copy.
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(file.buffer);
}

/** POST /admin/bookings/quote — the price of a trip for a client; nothing is saved. */
export async function quoteTrip(req: Request, res: Response): Promise<void> {
  const { customerId, trip } = body<AdminTripInput>(req);
  res.json({ success: true, data: await adminTrips.quoteTrip(customerId, trip) });
}

/** POST /admin/bookings — books a trip on a client's behalf (unpaid until collected). */
export async function createTrip(req: Request, res: Response): Promise<void> {
  const { customerId, trip } = body<AdminTripInput>(req);
  const data = await adminTrips.createTripForCustomer(req.user!.userId, customerId, trip);
  res.status(201).json({ success: true, data });
}

/** POST /admin/bookings/journey/quote — each leg's price and the total; nothing is saved. */
export async function quoteJourney(req: Request, res: Response): Promise<void> {
  const { customerId, legs } = body<AdminJourneyInput>(req);
  res.json({ success: true, data: await adminTrips.quoteJourney(customerId, legs) });
}

/** POST /admin/bookings/journey — books a multi-city journey or round trip for a client. */
export async function createJourney(req: Request, res: Response): Promise<void> {
  const { customerId, legs } = body<AdminJourneyInput>(req);
  const data = await adminTrips.createJourneyForCustomer(req.user!.userId, customerId, legs);
  res.status(201).json({ success: true, data });
}

/** POST /admin/bookings/:id/payment-link — emails the client a link to pay this booking. */
export async function sendPaymentLink(req: Request, res: Response): Promise<void> {
  const data = await paymentLinks.sendPaymentLink(params<IdParam>(req).id, req.user!.userId);
  res.json({ success: true, data });
}

/** POST /admin/bookings/:id/refund — refunds all or part of a card payment to the card. */
export async function refundBooking(req: Request, res: Response): Promise<void> {
  const { amount, requestId, note } = body<AdminRefundInput>(req);
  const data = await refundBookingAmount({
    bookingId: params<IdParam>(req).id,
    amount,
    requestId,
    adminId: req.user!.userId,
    note,
  });
  res.json({ success: true, data });
}

/** POST /admin/bookings/:id/reject — turns down a request nobody has accepted yet. */
export async function rejectBookingRequest(req: Request, res: Response): Promise<void> {
  const data = await rejectBooking(params<IdParam>(req).id, req.user!.userId, body<AdminRejectInput>(req).reason);
  res.json({ success: true, data });
}

/** POST /admin/users/:id/agreement/review — approve or reject a client's signed agreement. */
export async function reviewUserAgreement(req: Request, res: Response): Promise<void> {
  const data = await usersService.reviewAgreement(
    params<IdParam>(req).id,
    body<AdminAgreementReviewInput>(req).decision,
    req.user!.userId,
  );
  res.json({ success: true, data });
}

/** POST /admin/bookings/:id/email-invoice — emails the client their invoice. */
export async function emailInvoice(req: Request, res: Response): Promise<void> {
  const data = await emailInvoiceToCustomer(params<IdParam>(req).id);
  res.json({ success: true, data });
}

/** GET /admin/calendar/status — is the shared calendar set up, reachable and shared with us? */
export async function calendarState(_req: Request, res: Response): Promise<void> {
  res.json({ success: true, data: await calendarStatus() });
}

/**
 * POST /admin/bookings/:id/calendar-sync — put this booking on the calendar now.
 * Reports Google's own reason when it cannot, so a setup problem is visible, not silent.
 */
export async function syncBookingToCalendar(req: Request, res: Response): Promise<void> {
  const id = params<IdParam>(req).id;
  const status = await calendarStatus();
  if (!status.enabled) throw ApiError.conflict('The calendar is not set up yet. Add GOOGLE_CALENDAR_ID and GOOGLE_SERVICE_ACCOUNT_JSON to the server settings.');
  try {
    res.json({ success: true, data: await syncInOrder(id) });
  } catch (err) {
    throw new ApiError(502, `Could not update the calendar: ${explain(err)}`);
  }
}

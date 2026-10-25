import { Types } from 'mongoose';
import { Booking, type IBooking } from '../../models/Booking';
import { Trip, type ITrip } from '../../models/Trip';
import { Driver } from '../../models/Driver';
import { User } from '../../models/User';
import { adminWebUrl, env, isTest } from '../../config/env';
import { format } from '../../config/timezone';
import { logger } from '../../utils/logger';
import { sendEmail, type EmailAttachment } from '../../integrations/email';
import {
  accountCreatedEmail,
  adminNewBookingEmail,
  adminNewCustomerEmail,
  adminTripCancelledEmail,
  bookingCancellationEmail,
  bookingRejectionEmail,
  chauffeurArrivedEmail,
  contactNumberResetEmail,
  documentApprovedEmail,
  documentRejectedEmail,
  noShowEmail,
  tripConfirmedEmail,
  chauffeurAssignedEmail,
  chauffeurEnrouteEmail,
  onboardEmail,
  paymentReceiptEmail,
  prePaymentInvoiceEmail,
  reminderEmail,
  thankYouEmail,
  tripCompletedEmail,
  type RenderedEmail,
} from '../../integrations/emailTemplates';
import * as vehicleService from '../vehicle/vehicle.service';
import { renderStoredDocument } from '../booking/booking.documents.load';
import { getSettingsValues } from '../admin/settings.service';

/**
 * Who gets which email, and when. The emails themselves are in integrations/emailTemplates.ts.
 *
 * Driven from notify.send(), so every place that already notifies emails too, without each
 * call site having to remember to:
 *
 *   booking.created                     paid by card   -> "Payment Received" + receipt PDF
 *                                       not yet paid   -> "Your … Invoice" + invoice PDF
 *                                       and to operations: "New Booking"
 *   booking.cancelled / trip.cancelled  -> "Booking Cancellation Confirmation"
 *                                       and to operations: "Trip Cancelled"
 *   trip.driver_assigned                -> "Chauffeur Assignment Confirmation for Your Trip"
 *   trip.enroute / trip.arrived         -> "Enroute Trip" / "Chauffeur Arrived!"
 *   trip.started                        -> "Onboard Trip"
 *   trip.completed                      -> "All Black Limo Trip Completed" + invoice/receipt PDF
 *                                          (closed by hand from the console: the short "Trip Completed")
 *   booking.cancelled, rejected by ops  -> "Booking Rejection Notice" with the reason
 *   booking.cancellation_window_closing -> "Upcoming Trip – Please Confirm Your Details"
 *
 * Everything else a notification can say (a booking amended, a refund, a job offered to a
 * chauffeur…) stays in the app: the original system sent no email for those, and neither
 * does this one.
 *
 * Never throws and is never awaited by the caller: a mail server that is slow or down must
 * not slow or fail the booking that triggered it.
 */

type Payload = Record<string, unknown>;
type Lean<T> = T & { _id: Types.ObjectId };

const TRIP_TYPE_LABEL: Record<string, string> = {
  point2point: 'Point to point',
  airport: 'Airport transfer',
  hourly: 'Hourly charter',
};

const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

/**
 * Short, human-quotable booking reference. The same `ABL-` + last 6 of the id that the
 * passenger site, the driver app and the admin console print, so a customer quoting the
 * email is quoting what operations sees.
 */
export const bookingRef = (id: Types.ObjectId | string) => `ABL-${String(id).slice(-6).toUpperCase()}`;

export interface Context {
  booking: Lean<IBooking> | null;
  trip: Lean<ITrip> | null;
  vehicleLabel: string;
  chauffeur?: { name: string; phone: string };
}

export async function loadContext(payload: Payload): Promise<Context> {
  const bookingId = str(payload.bookingId);
  const tripId = str(payload.tripId);

  let trip = tripId ? await Trip.findById(tripId).lean<Lean<ITrip>>() : null;
  const booking = bookingId
    ? await Booking.findById(bookingId).lean<Lean<IBooking>>()
    : trip
      ? await Booking.findById(trip.bookingId).lean<Lean<IBooking>>()
      : null;
  if (!trip && booking) trip = await Trip.findOne({ bookingId: booking._id }).lean<Lean<ITrip>>();

  let chauffeur: Context['chauffeur'];
  if (trip?.driverId) {
    const driver = await Driver.findById(trip.driverId).select('userId').lean();
    const user = driver ? await User.findById(driver.userId).select('name phone').lean() : null;
    if (user) chauffeur = { name: user.name, phone: user.phone };
  }

  return {
    booking,
    trip,
    vehicleLabel: await vehicleService.labelFor(booking?.vehicleClass),
    chauffeur,
  };
}

/** The invoice or receipt as an attachment. A failure to make it never stops the email. */
async function pdf(bookingId: Types.ObjectId | string, kind: 'invoice' | 'receipt'): Promise<EmailAttachment[]> {
  try {
    const doc = await renderStoredDocument(String(bookingId), kind);
    return [{ filename: doc.filename, content: doc.buffer, contentType: 'application/pdf' }];
  } catch (err) {
    logger.warn(`[email] could not attach the ${kind} for booking ${String(bookingId)}`, err);
    return [];
  }
}

export type Recipient = { name: string; email: string; role: string; phone?: string };
export type Built = { message: RenderedEmail; attachments?: EmailAttachment[] };

export async function emailFor(
  type: string,
  to: Recipient,
  ctx: Context,
  payload: Payload = {},
): Promise<Built | null> {
  const b = ctx.booking;
  // Chauffeurs and staff are told in the app; these emails are for the passenger.
  if (!b || to.role !== 'customer') return null;
  const ref = bookingRef(b._id);

  switch (type) {
    case 'booking.created':
      return b.payment
        ? {
            message: paymentReceiptEmail({ name: to.name, ref, amount: b.payment.amount }),
            attachments: await pdf(b._id, 'receipt'),
          }
        : { message: prePaymentInvoiceEmail({ name: to.name, ref }), attachments: await pdf(b._id, 'invoice') };

    case 'booking.cancelled':
    case 'trip.cancelled':
      // Operations turned the request down: the customer is told why, not just "cancelled".
      return payload.rejected
        ? { message: bookingRejectionEmail({ name: to.name, reason: str(payload.reason) ?? 'No reason was given.', ref }) }
        : { message: bookingCancellationEmail({ name: to.name }) };

    case 'trip.driver_assigned':
      return {
        message: chauffeurAssignedEmail({
          name: to.name,
          driverName: ctx.chauffeur?.name,
          driverPhone: ctx.chauffeur?.phone,
        }),
      };

    case 'trip.confirmed':
      return {
        message: tripConfirmedEmail({
          name: to.name,
          ref,
          driverName: ctx.chauffeur?.name,
          driverPhone: ctx.chauffeur?.phone,
          pickup: b.pickup.address,
          when: format(b.scheduledAt),
          vehicle: ctx.vehicleLabel,
        }),
      };

    case 'trip.no_show':
      return { message: noShowEmail({ name: to.name, ref }) };

    case 'trip.enroute':
      return {
        message: chauffeurEnrouteEmail({ name: to.name, driverName: ctx.chauffeur?.name, driverPhone: ctx.chauffeur?.phone }),
      };

    case 'trip.arrived':
      return {
        message: chauffeurArrivedEmail({ name: to.name, driverName: ctx.chauffeur?.name, driverPhone: ctx.chauffeur?.phone }),
      };

    case 'trip.started':
      return {
        message: onboardEmail({ name: to.name, driverName: ctx.chauffeur?.name, driverPhone: ctx.chauffeur?.phone }),
      };

    case 'trip.completed':
      // Closed by hand from the console: the short note. The chauffeur finishing the ride
      // gets the thank-you with the paperwork.
      if (payload.closedBy === 'admin') return { message: tripCompletedEmail({ name: to.name }) };
      return {
        message: thankYouEmail({
          name: to.name,
          ref,
          when: format(b.scheduledAt),
          pickup: b.pickup.address,
          drop: b.drop.address,
          price: ctx.trip?.fareAmount ?? b.estimatedFare,
          vehicle: ctx.vehicleLabel,
          phone: to.phone,
          email: to.email,
        }),
        // A paid ride gets its receipt; one still to be paid gets the invoice.
        attachments: await pdf(b._id, b.payment || ctx.trip?.settled ? 'receipt' : 'invoice'),
      };

    case 'booking.cancellation_window_closing':
      return {
        message: reminderEmail({
          name: to.name,
          when: format(b.scheduledAt),
          pickup: b.pickup.address,
          drop: b.drop.address,
          chauffeur: ctx.chauffeur?.name,
        }),
      };

    default:
      return null;
  }
}

/* -------------------------------- operations ------------------------------ */

async function operationsInbox(): Promise<string | undefined> {
  return env.BOOKINGS_INBOX_EMAIL || (await getSettingsValues()).supportInboxEmail || undefined;
}

/** New bookings and cancellations, copied to the operations inbox so dispatch sees them. */
export async function alertOperations(type: string, ctx: Context, payload: Payload): Promise<void> {
  // A request operations rejected themselves needs no alert to operations.
  if (payload.rejected) return;
  if (type !== 'booking.created' && type !== 'booking.cancelled' && type !== 'trip.cancelled' && type !== 'trip.no_show') return;
  const b = ctx.booking;
  if (!b) return;

  const inbox = await operationsInbox();
  if (!inbox) return;

  const customer = await User.findById(b.customerId).select('name email phone').lean();
  const ref = bookingRef(b._id);

  // A no-show is copied to operations as its own email, headed with whose it is, so it can
  // be read at a glance in the inbox. It says what the customer was told.
  if (type === 'trip.no_show') {
    const copy = noShowEmail({ name: customer?.name, ref });
    await sendEmail({ to: inbox, ...copy, subject: `Copy - No Show - ${customer?.name || 'Guest'}` });
    return;
  }

  const message =
    type === 'booking.created'
      ? adminNewBookingEmail({
          customer: { name: customer?.name, phone: customer?.phone, email: customer?.email },
          ref,
          bookedOn: format(b.createdAt),
          tripType: TRIP_TYPE_LABEL[b.tripType] ?? b.tripType,
          vehicle: ctx.vehicleLabel,
          when: format(b.scheduledAt),
          pickup: b.pickup.address,
          drop: b.drop.address,
          viewUrl: adminWebUrl ? `${adminWebUrl}/trips/${String(b._id)}` : undefined,
        })
      : adminTripCancelledEmail({
          ref,
          customer: { name: customer?.name, email: customer?.email, phone: customer?.phone },
          pickup: b.pickup.address,
          drop: b.drop.address,
          when: format(b.scheduledAt),
          total: b.estimatedFare,
          refund: b.payment?.refundedAmount,
          cancelledBy: b.cancellation?.byName ?? b.cancellation?.by,
        });

  await sendEmail({ to: inbox, replyTo: customer?.email, ...message });
}

/* ---------------------------------- entry --------------------------------- */

export async function emailForNotification(
  userId: Types.ObjectId | string,
  type: string,
  payload: Payload,
): Promise<void> {
  if (isTest) return;
  try {
    const user = await User.findById(userId).select('name email role phone').lean();
    if (!user?.email) return;

    const ctx = await loadContext(payload);
    const built = await emailFor(type, user, ctx, payload);
    if (built) await sendEmail({ to: user.email, ...built.message, attachments: built.attachments });

    // Once per event: the customer's copy is the trigger, not the chauffeur's.
    if (user.role === 'customer') await alertOperations(type, ctx, payload);
  } catch (err) {
    logger.warn(`[email] could not send '${type}' email`, err);
  }
}

/* --------------------------------- sign-ups -------------------------------- */

/** A customer signed up: welcome them, and tell operations. */
export async function sendWelcomeEmail(user: { name: string; email: string; phone?: string }): Promise<void> {
  if (isTest) return;
  try {
    await sendEmail({ to: user.email, ...accountCreatedEmail({ name: user.name }) });
  } catch (err) {
    logger.warn('[email] could not send the welcome email', err);
  }
  await alertNewCustomer(user, false);
}

/** Operations hear about every new customer; a guest booking is flagged as one. */
export async function alertNewCustomer(
  user: { name: string; email: string; phone?: string },
  guest: boolean,
): Promise<void> {
  if (isTest) return;
  try {
    const inbox = await operationsInbox();
    if (!inbox) return;
    await sendEmail({ to: inbox, ...adminNewCustomerEmail({ ...user, guest }) });
  } catch (err) {
    logger.warn('[email] could not tell operations about a new customer', err);
  }
}

/* ------------------------------ account changes ------------------------------ */

/** The number on the account changed, whoever changed it: tell the account's email. */
export async function sendContactNumberReset(user: { name: string; email: string }, phone: string): Promise<void> {
  if (isTest) return;
  try {
    await sendEmail({ to: user.email, ...contactNumberResetEmail({ name: user.name, phone }) });
  } catch (err) {
    logger.warn('[email] could not send the contact number notice', err);
  }
}

/** Operations' verdict on a signed agreement. */
export async function sendDocumentDecision(user: { name: string; email: string }, approved: boolean): Promise<void> {
  if (isTest) return;
  try {
    await sendEmail({
      to: user.email,
      ...(approved ? documentApprovedEmail({ name: user.name }) : documentRejectedEmail({ name: user.name })),
    });
  } catch (err) {
    logger.warn('[email] could not send the document decision', err);
  }
}

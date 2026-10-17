import { Types } from 'mongoose';
import { Booking, type IBooking } from '../../models/Booking';
import { Trip, type ITrip } from '../../models/Trip';
import { Driver } from '../../models/Driver';
import { User } from '../../models/User';
import { appWebUrl, env, isTest } from '../../config/env';
import { format } from '../../config/timezone';
import { CONTACT_EMAIL, CONTACT_PHONE } from '../../config/constants';
import { logger } from '../../utils/logger';
import { sendEmail } from '../../integrations/email';
import { detailsEmail, welcomeEmail, type Contact, type DetailRow, type RenderedEmail } from '../../integrations/emailTemplates';
import * as vehicleService from '../vehicle/vehicle.service';
import { isPrimetime, PRIMETIME } from '../pricing/pricing.service';
import { REFUND_PCT_WHEN_ELIGIBLE, REFUND_THRESHOLD_HOURS } from '../cancellation/cancellation.service';
import { getSettingsValues } from '../admin/settings.service';

/**
 * Email for the notification types a customer (or chauffeur) should have in their inbox,
 * not only in the app: booking confirmed / changed / cancelled, chauffeur assigned, trip
 * receipt, refunds and the cancellation-window reminder.
 *
 * Driven from notify.send(), so every place that already notifies — customer, driver and
 * admin paths alike — emails too, without each call site having to remember to. Ride
 * offers, trip-started and penalty events stay in-app only: they are either too frequent
 * or only matter while the app is open.
 *
 * Never throws and is never awaited by the caller: a mail server that is slow or down
 * must not slow or fail the booking that triggered it.
 */

type Payload = Record<string, unknown>;
type Lean<T> = T & { _id: Types.ObjectId };

const TRIP_TYPE_LABEL: Record<string, string> = {
  point2point: 'Point to point',
  airport: 'Airport transfer',
  hourly: 'Hourly charter',
};

const money = (n?: number | null) => (typeof n === 'number' ? `$${n.toFixed(2)}` : undefined);
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

/** Short, human-quotable booking reference — the last 8 hex characters of the id. */
export const bookingRef = (id: Types.ObjectId | string) => String(id).slice(-8).toUpperCase();

function contact(): Contact {
  return { phone: CONTACT_PHONE, email: CONTACT_EMAIL };
}

function policyNote(tripType: string): string {
  const hours = REFUND_THRESHOLD_HOURS[tripType as keyof typeof REFUND_THRESHOLD_HOURS] ?? 24;
  return (
    `Cancellation policy: cancel at least ${hours} hours before pickup for a ${REFUND_PCT_WHEN_ELIGIBLE}% refund ` +
    `(a ${100 - REFUND_PCT_WHEN_ELIGIBLE}% admin fee applies). Cancellations within ${hours} hours of pickup are not refunded.`
  );
}

interface Context {
  booking: Lean<IBooking> | null;
  trip: Lean<ITrip> | null;
  vehicleLabel: string;
  chauffeur?: { name: string; phone: string };
}

async function loadContext(payload: Payload): Promise<Context> {
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

function journeyRows(ctx: Context): DetailRow[] {
  const b = ctx.booking;
  if (!b) return [];
  return [
    ['Booking ref', bookingRef(b._id)],
    ['Pickup time', format(b.scheduledAt)],
    ['Service', TRIP_TYPE_LABEL[b.tripType] ?? b.tripType],
    ['Vehicle', ctx.vehicleLabel],
    ['Passengers', b.passengers ? String(b.passengers) : undefined],
    ['Pickup', b.pickup?.address],
    ['Drop-off', b.drop?.address],
    ['Flight', b.flightDetails?.flightNumber],
  ];
}

function fareTotal(b: IBooking | null): [string, string] | undefined {
  const amount = money(b?.estimatedFare);
  return amount ? ['Fare (before tax)', amount] : undefined;
}

function primetimeNote(b: IBooking | null): string[] {
  return b && isPrimetime(b.scheduledAt)
    ? [`Includes the $${PRIMETIME.surcharge} primetime surcharge for pickups between 10pm and 7am.`]
    : [];
}

const tripLink = (b: IBooking & { _id: Types.ObjectId }) => ({
  href: `${appWebUrl}/trips/${String(b._id)}`,
  label: 'View booking',
});

/* ------------------------------ per-type builders ------------------------- */

type Recipient = { name: string; email: string; role: string };

function build(type: string, to: Recipient, ctx: Context, payload: Payload): RenderedEmail | null {
  const b = ctx.booking;
  const ref = b ? bookingRef(b._id) : '';
  const isCustomer = to.role === 'customer';

  switch (type) {
    case 'booking.created':
      if (!b) return null;
      return detailsEmail({
        subject: `Booking confirmed · ${format(b.scheduledAt)} · Ref ${ref}`,
        preheader: `Your ${ctx.vehicleLabel} is booked for ${format(b.scheduledAt)}.`,
        eyebrow: 'Booking confirmed',
        heading: 'Your ride is booked',
        name: to.name,
        intro: [
          "Thank you for booking with us. Here are your trip details. We'll email you again with your chauffeur's name and phone number once one is assigned.",
        ],
        rows: journeyRows(ctx),
        total: fareTotal(b),
        cta: tripLink(b),
        notes: [...primetimeNote(b), policyNote(b.tripType)],
        contact: contact(),
      });

    case 'booking.updated':
      if (!b) return null;
      return detailsEmail({
        subject: `Booking updated · Ref ${ref}`,
        preheader: `Your booking for ${format(b.scheduledAt)} has changed.`,
        eyebrow: 'Booking updated',
        heading: 'Your booking has changed',
        name: to.name,
        intro: [
          typeof payload.previousFare === 'number'
            ? `Your booking was updated and the fare changed from ${money(payload.previousFare as number)} to ${money(b.estimatedFare)}. The updated details are below.`
            : 'Your booking was updated. The updated details are below.',
        ],
        rows: journeyRows(ctx),
        total: fareTotal(b),
        cta: tripLink(b),
        notes: [...primetimeNote(b), "Didn't make this change? Contact us straight away."],
        contact: contact(),
      });

    case 'booking.cancelled':
    case 'trip.cancelled': {
      if (!b) return null;
      if (!isCustomer) {
        return detailsEmail({
          subject: `Job cancelled · ${format(b.scheduledAt)} · Ref ${ref}`,
          preheader: 'A job assigned to you was cancelled.',
          eyebrow: 'Job cancelled',
          heading: 'This job was cancelled',
          name: to.name,
          intro: ['The job below has been cancelled. You do not need to go to the pickup.'],
          rows: journeyRows(ctx),
        });
      }
      const refundAmount = typeof payload.refundAmount === 'number' ? payload.refundAmount : undefined;
      return detailsEmail({
        subject: `Booking cancelled · Ref ${ref}`,
        preheader: `Your booking for ${format(b.scheduledAt)} was cancelled.`,
        eyebrow: 'Booking cancelled',
        heading: 'Your booking was cancelled',
        name: to.name,
        intro: [str(payload.message) ?? 'Your booking has been cancelled.'],
        rows: [
          ...journeyRows(ctx),
          ['Reason', str(payload.reason) ?? b.cancellation?.reason],
          ['Refunded to wallet', refundAmount ? money(refundAmount) : undefined],
        ],
        notes: ['Want to rebook? You can book a new ride any time from your account.'],
        contact: contact(),
      });
    }

    case 'trip.driver_assigned':
      if (!b) return null;
      if (isCustomer) {
        return detailsEmail({
          subject: `Your chauffeur is confirmed · Ref ${ref}`,
          preheader: ctx.chauffeur ? `${ctx.chauffeur.name} will be driving you.` : 'Your chauffeur is confirmed.',
          eyebrow: 'Chauffeur assigned',
          heading: 'Your chauffeur is confirmed',
          name: to.name,
          intro: ['A chauffeur has been assigned to your ride. Their details are below.'],
          rows: [
            ['Chauffeur', ctx.chauffeur?.name],
            ['Chauffeur phone', ctx.chauffeur?.phone],
            ...journeyRows(ctx),
          ],
          total: fareTotal(b),
          cta: tripLink(b),
          contact: contact(),
        });
      }
      return detailsEmail({
        subject: `New job · ${format(b.scheduledAt)} · Ref ${ref}`,
        preheader: `You have a job for ${format(b.scheduledAt)}.`,
        eyebrow: 'New job',
        heading: "You've been assigned a job",
        name: to.name,
        intro: ['Open the Viaro driver app for directions, the passenger chat and live updates.'],
        rows: journeyRows(ctx),
      });

    case 'trip.completed':
      // A chauffeur's completion notice is their earnings line — that stays in-app.
      if (!b || !isCustomer) return null;
      return detailsEmail({
        subject: `Your receipt · Ref ${ref}`,
        preheader: `Thanks for riding with us. Total ${money(ctx.trip?.fareAmount ?? b.estimatedFare) ?? ''}.`,
        eyebrow: 'Trip complete',
        heading: 'Thanks for riding with us',
        name: to.name,
        intro: ['Your trip is complete. Here is your receipt.'],
        rows: [
          ...journeyRows(ctx),
          ['Chauffeur', ctx.chauffeur?.name],
          ['Completed', str(payload.completedAt)],
          ['Wallet credit applied', ctx.trip?.creditApplied ? money(ctx.trip.creditApplied) : undefined],
        ],
        total: ['Fare', money(ctx.trip?.fareAmount ?? b.estimatedFare) ?? '—'],
        cta: { href: `${appWebUrl}/trips/${String(b._id)}`, label: 'Rate your trip' },
        contact: contact(),
      });

    case 'wallet.refund_issued': {
      const amount = typeof payload.refundAmount === 'number' ? payload.refundAmount : undefined;
      if (!amount) return null;
      return detailsEmail({
        subject: `Refund issued · ${money(amount)}`,
        preheader: `${money(amount)} has been credited to your wallet.`,
        eyebrow: 'Refund',
        heading: `${money(amount)} refunded`,
        name: to.name,
        intro: ['A refund has been credited to your Viaro wallet. You can use it on your next ride.'],
        rows: b ? [['Booking ref', ref], ['Pickup time', format(b.scheduledAt)]] : [],
        total: ['Refunded', money(amount) as string],
        cta: { href: `${appWebUrl}/wallet`, label: 'View wallet' },
        contact: contact(),
      });
    }

    case 'booking.cancellation_window_closing':
      if (!b) return null;
      return detailsEmail({
        subject: `Reminder: your ride on ${format(b.scheduledAt)}`,
        preheader: 'Your free-cancellation window is about to close.',
        eyebrow: 'Reminder',
        heading: 'Your ride is coming up',
        name: to.name,
        intro: [
          str(payload.message) ??
            'Your cancellation window is about to close. After that, cancelling will not be refunded.',
        ],
        rows: journeyRows(ctx),
        cta: tripLink(b),
        notes: [policyNote(b.tripType)],
        contact: contact(),
      });

    default:
      return null;
  }
}

/* -------------------------------- operations ------------------------------ */

/** New bookings and cancellations, copied to the operations inbox so dispatch sees them. */
async function alertOperations(type: string, ctx: Context): Promise<void> {
  if (type !== 'booking.created' && type !== 'booking.cancelled' && type !== 'trip.cancelled') return;
  const b = ctx.booking;
  if (!b) return;

  const inbox = env.BOOKINGS_INBOX_EMAIL || (await getSettingsValues()).supportInboxEmail;
  if (!inbox) return;

  const customer = await User.findById(b.customerId).select('name email phone').lean();
  const created = type === 'booking.created';
  const message = detailsEmail({
    subject: `${created ? '[New booking]' : '[Cancelled]'} ${format(b.scheduledAt)} · ${ctx.vehicleLabel} · Ref ${bookingRef(b._id)}`,
    preheader: created ? 'A new booking was made.' : 'A booking was cancelled.',
    eyebrow: created ? 'New booking' : 'Booking cancelled',
    heading: created ? 'New booking' : 'Booking cancelled',
    name: null,
    intro: [created ? 'A customer just made a booking.' : 'A booking was cancelled.'],
    rows: [
      ['Customer', customer?.name],
      ['Customer phone', customer?.phone],
      ['Customer email', customer?.email],
      ...journeyRows(ctx),
      ['Cancelled by', b.cancellation?.byName ?? b.cancellation?.by],
      ['Reason', b.cancellation?.reason],
    ],
    total: fareTotal(b),
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
    const user = await User.findById(userId).select('name email role').lean();
    if (!user?.email) return;

    const ctx = await loadContext(payload);
    const message = build(type, user, ctx, payload);
    if (message) await sendEmail({ to: user.email, ...message });

    // Once per event: the customer's copy is the trigger, not the chauffeur's.
    if (user.role === 'customer') await alertOperations(type, ctx);
  } catch (err) {
    logger.warn(`[email] could not send '${type}' email`, err);
  }
}

export async function sendWelcomeEmail(user: { name: string; email: string }): Promise<void> {
  if (isTest) return;
  try {
    await sendEmail({ to: user.email, ...welcomeEmail({ name: user.name, link: `${appWebUrl}/book` }) });
  } catch (err) {
    logger.warn('[email] could not send welcome email', err);
  }
}

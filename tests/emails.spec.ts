import { describe, expect, it, vi } from 'vitest';
import * as t from '../src/integrations/emailTemplates';

vi.mock('../src/modules/booking/booking.documents.load', () => ({
  renderStoredDocument: vi.fn(async (_id: string, kind: string) => ({
    filename: `abl-${kind}-ABL-123456.pdf`,
    buffer: Buffer.from('%PDF-1.4 test'),
  })),
}));
vi.mock('../src/modules/vehicle/vehicle.service', () => ({ labelFor: async () => 'Business Sedan' }));

import { emailFor, type Context, type Recipient } from '../src/modules/notifications/notification.emails';

const trip = { pickup: 'Hotel Andra, Seattle', drop: 'Sea-Tac Airport', when: 'Nov 3, 2:00 PM', vehicle: 'Business Sedan' };

/** One of every template, with realistic input. */
const ALL: Record<string, t.RenderedEmail> = {
  accountCreatedEmail: t.accountCreatedEmail({ name: 'Pat Rider' }),
  accountInviteEmail: t.accountInviteEmail({ name: 'Pat Rider', link: 'https://x.test/r?token=abc', expiresInMinutes: 60 }),
  guestWelcomeEmail: t.guestWelcomeEmail({ name: 'Pat Rider', link: 'https://x.test/r?token=abc', expiresInMinutes: 60 }),
  resetPasswordEmail: t.resetPasswordEmail({ name: 'Pat Rider', link: 'https://x.test/r?token=abc', expiresInMinutes: 60 }),
  contactNumberResetEmail: t.contactNumberResetEmail({ name: 'Pat Rider', phone: '+12065550100' }),
  prePaymentInvoiceEmail: t.prePaymentInvoiceEmail({ name: 'Pat Rider', ref: 'ABL-123456' }),
  paymentReceiptEmail: t.paymentReceiptEmail({ name: 'Pat Rider', ref: 'ABL-123456', amount: 147.4 }),
  paymentRequestedEmail: t.paymentRequestedEmail({ name: 'Pat Rider', ref: 'ABL-123456', amount: 147.4, link: 'https://pay.test/c', expiresLabel: 'Nov 4', trip }),
  invoiceEmail: t.invoiceEmail(),
  reminderEmail: t.reminderEmail({ name: 'Pat Rider', when: trip.when, pickup: trip.pickup, drop: trip.drop }),
  chauffeurAssignedEmail: t.chauffeurAssignedEmail({ name: 'Pat Rider', driverName: 'Dee Driver', driverPhone: '+12065550111' }),
  tripConfirmedEmail: t.tripConfirmedEmail({ name: 'Pat Rider', ref: 'ABL-123456', driverName: 'Dee Driver', driverPhone: '+12065550111', pickup: trip.pickup, when: trip.when, vehicle: 'Business Sedan' }),
  chauffeurEnrouteEmail: t.chauffeurEnrouteEmail({ name: 'Pat Rider', driverName: 'Dee Driver', driverPhone: '+12065550111' }),
  chauffeurArrivedEmail: t.chauffeurArrivedEmail({ name: 'Pat Rider', driverName: 'Dee Driver', driverPhone: '+12065550111' }),
  onboardEmail: t.onboardEmail({ name: 'Pat Rider', driverName: 'Dee Driver', driverPhone: '+12065550111' }),
  tripCompletedEmail: t.tripCompletedEmail({ name: 'Pat Rider' }),
  thankYouEmail: t.thankYouEmail({ name: 'Pat Rider', ref: 'ABL-123456', when: trip.when, pickup: trip.pickup, drop: trip.drop, price: 147.4, vehicle: 'Business Sedan', phone: '+12065550100', email: 'pat@example.com' }),
  bookingCancellationEmail: t.bookingCancellationEmail({ name: 'Pat Rider' }),
  bookingRejectionEmail: t.bookingRejectionEmail({ name: 'Pat Rider', reason: 'No chauffeur available', ref: 'ABL-123456' }),
  noShowEmail: t.noShowEmail({ name: 'Pat Rider', ref: 'ABL-123456' }),
  documentApprovedEmail: t.documentApprovedEmail({ name: 'Pat Rider' }),
  documentRejectedEmail: t.documentRejectedEmail({ name: 'Pat Rider' }),
  adminNewCustomerEmail: t.adminNewCustomerEmail({ name: 'Pat Rider', email: 'pat@example.com', phone: '+12065550100' }),
  adminNewBookingEmail: t.adminNewBookingEmail({ customer: { name: 'Pat Rider', phone: '+1206', email: 'pat@example.com' }, ref: 'ABL-123456', bookedOn: 'Nov 1', tripType: 'Point to point', vehicle: 'Business Sedan', when: trip.when, pickup: trip.pickup, drop: trip.drop, viewUrl: 'https://admin.test/trips/1' }),
  adminTripCancelledEmail: t.adminTripCancelledEmail({ ref: 'ABL-123456', customer: { name: 'Pat Rider', email: 'pat@example.com', phone: '+1206' }, pickup: trip.pickup, drop: trip.drop, when: trip.when, total: 147.4, refund: 100, cancelledBy: 'customer' }),
};

describe('the email set', () => {
  it('has exactly the templates the registry lists', () => {
    expect(Object.keys(ALL).sort()).toEqual(Object.keys(t.EMAIL_TEMPLATES).sort());
  });

  it.each(Object.entries(ALL))('%s has a subject, an html body and a matching plain-text part', (_name, mail) => {
    expect(mail.subject.length).toBeGreaterThan(3);
    expect(mail.html).toContain('<!doctype html>');
    expect(mail.html).toContain('Best regards,');
    expect(mail.text).toContain('Best regards,');
    expect(mail.html).not.toMatch(/undefined|\[object Object\]|NaN/);
    expect(mail.text).not.toMatch(/undefined|\[object Object\]|NaN/);
  });

  it('keeps the original subjects', () => {
    const subjects = Object.fromEntries(Object.entries(ALL).map(([k, v]) => [k, v.subject]));
    expect(subjects).toMatchObject({
      accountCreatedEmail: 'Welcome to All Black Limo – Your Account Has Been Created',
      guestWelcomeEmail: 'Welcome to All Black Limo - set your password',
      resetPasswordEmail: 'Reset Password',
      prePaymentInvoiceEmail: 'Your All Black Limo Invoice - Trip #ABL-123456',
      paymentReceiptEmail: 'Payment Received - All Black Limo - Trip #ABL-123456',
      paymentRequestedEmail: 'Payment requested',
      invoiceEmail: 'Invoice',
      chauffeurAssignedEmail: 'Chauffeur Assignment Confirmation for Your Trip',
      tripConfirmedEmail: 'Trip Confirmed',
      chauffeurEnrouteEmail: 'Enroute Trip',
      chauffeurArrivedEmail: 'Chauffeur Arrived!',
      onboardEmail: 'Onboard Trip',
      tripCompletedEmail: 'Trip Completed',
      thankYouEmail: 'All Black Limo Trip Completed',
      bookingCancellationEmail: 'Booking Cancellation Confirmation',
      bookingRejectionEmail: 'Booking Rejection Notice',
      noShowEmail: 'Your Reservation Has Been Marked as a No-Show',
      adminNewBookingEmail: 'New Booking',
      adminTripCancelledEmail: 'Trip Cancelled - #ABL-123456',
    });
  });

  it('wears the original look: black header with the title, social footer, no-reply note', () => {
    const mail = ALL.chauffeurArrivedEmail;
    expect(mail.html).toContain('background:#000000');
    expect(mail.html).toContain('Chauffeur Arrived!');
    for (const name of ['Facebook', 'Instagram', 'YouTube', 'X']) expect(mail.html).toContain(`alt="${name}"`);
    expect(mail.html).toContain('/email_icons/facebook.png');
    expect(mail.html).toContain('Please do not reply to this email.');
  });

  it('invites a reply on the emails that ask for one', () => {
    expect(ALL.noShowEmail.html).not.toContain('Please do not reply');
    expect(ALL.bookingRejectionEmail.html).not.toContain('Please do not reply');
  });

  it('puts the details a customer needs in the right emails', () => {
    expect(ALL.chauffeurAssignedEmail.text).toContain('Dee Driver');
    expect(ALL.chauffeurAssignedEmail.text).toContain('+12065550111');
    expect(ALL.paymentReceiptEmail.text).toContain('$147.40');
    expect(ALL.paymentRequestedEmail.html).toContain('href="https://pay.test/c"');
    expect(ALL.paymentRequestedEmail.text).toContain('https://pay.test/c');
    expect(ALL.tripConfirmedEmail.text).toContain('Business Sedan');
    expect(ALL.thankYouEmail.text).toContain('Hotel Andra, Seattle');
    expect(ALL.adminNewBookingEmail.html).toContain('View trip');
    expect(ALL.resetPasswordEmail.html).toContain('href="https://x.test/r?token=abc"');
  });

  it('leaves a row out rather than printing a blank, and says Hello to a guest with no name', () => {
    const noPhone = t.chauffeurAssignedEmail({ name: 'Pat', driverName: 'Dee', driverPhone: undefined });
    expect(noPhone.text).toContain('Driver Name: Dee');
    expect(noPhone.text).not.toContain('Driver Contact');
    expect(t.guestWelcomeEmail({ name: 'Guest', link: 'https://x.test', expiresInMinutes: 60 }).text).toContain('Hello,');
  });

  it('escapes anything a customer typed, in the html', () => {
    const mail = t.bookingRejectionEmail({ name: '<script>alert(1)</script>', reason: '"><img src=x onerror=alert(1)>', ref: 'ABL-1' });
    expect(mail.html).not.toContain('<script>alert(1)</script>');
    expect(mail.html).not.toContain('<img src=x onerror');
    expect(mail.html).toContain('&lt;script&gt;');
  });

  it('shows a button that links where it says', () => {
    expect(ALL.accountInviteEmail.html).toContain('Set Your Password');
    expect(ALL.paymentRequestedEmail.html).toContain('Pay Now');
  });
});

/* -------------------------------- who gets what -------------------------------- */

const customer: Recipient = { name: 'Pat Rider', email: 'pat@example.com', role: 'customer', phone: '+12065550100' };
const driver: Recipient = { name: 'Dee Driver', email: 'dee@example.com', role: 'driver' };

const booking = (over: Record<string, unknown> = {}) =>
  ({
    _id: '5f9d88b8b54764421b7156c9',
    customerId: 'c1',
    pickup: { address: 'Hotel Andra, Seattle' },
    drop: { address: 'Sea-Tac Airport' },
    scheduledAt: new Date('2026-11-03T22:00:00Z'),
    createdAt: new Date('2026-11-01T18:00:00Z'),
    vehicleClass: 'sedan',
    tripType: 'point2point',
    estimatedFare: 140,
    ...over,
  }) as never;

const ctx = (b: unknown, extra: Partial<Context> = {}): Context => ({
  booking: b as never,
  trip: null,
  vehicleLabel: 'Business Sedan',
  ...extra,
});

describe('which email each event sends', () => {
  it('a booking paid by card sends the receipt, with the receipt PDF', async () => {
    const paid = booking({ payment: { amount: 140, status: 'paid' } });
    const built = await emailFor('booking.created', customer, ctx(paid));
    expect(built!.message.subject).toMatch(/^Payment Received - All Black Limo - Trip #ABL-/);
    expect(built!.attachments).toHaveLength(1);
    expect(built!.attachments![0]).toMatchObject({ filename: 'abl-receipt-ABL-123456.pdf', contentType: 'application/pdf' });
  });

  it('a booking not yet paid sends the invoice, with the invoice PDF', async () => {
    const built = await emailFor('booking.created', customer, ctx(booking()));
    expect(built!.message.subject).toMatch(/^Your All Black Limo Invoice - Trip #ABL-/);
    expect(built!.attachments![0].filename).toBe('abl-invoice-ABL-123456.pdf');
  });

  it('a cancellation sends the cancellation confirmation, for a booking or a trip', async () => {
    for (const type of ['booking.cancelled', 'trip.cancelled']) {
      const built = await emailFor(type, customer, ctx(booking()));
      expect(built!.message.subject).toBe('Booking Cancellation Confirmation');
    }
  });

  it('assigning a chauffeur sends their name and number', async () => {
    const built = await emailFor('trip.driver_assigned', customer, ctx(booking(), { chauffeur: { name: 'Dee Driver', phone: '+12065550111' } }));
    expect(built!.message.subject).toBe('Chauffeur Assignment Confirmation for Your Trip');
    expect(built!.message.text).toContain('Dee Driver');
  });

  it('starting the ride sends the onboard note', async () => {
    const built = await emailFor('trip.started', customer, ctx(booking(), { chauffeur: { name: 'Dee Driver', phone: '+1' } }));
    expect(built!.message.subject).toBe('Onboard Trip');
  });

  it('completing a trip sends the thank-you with a receipt if paid, an invoice if not', async () => {
    const paid = await emailFor('trip.completed', customer, ctx(booking({ payment: { amount: 140 } })));
    expect(paid!.message.subject).toBe('All Black Limo Trip Completed');
    expect(paid!.attachments![0].filename).toContain('receipt');
    const unpaid = await emailFor('trip.completed', customer, ctx(booking()));
    expect(unpaid!.attachments![0].filename).toContain('invoice');
    expect(unpaid!.message.text).toContain('Mobile: +12065550100');
  });

  it('"on the way" and "arrived" send their notes with the chauffeur\'s details', async () => {
    const chauffeur = { chauffeur: { name: 'Dee Driver', phone: '+12065550111' } };
    const enroute = await emailFor('trip.enroute', customer, ctx(booking(), chauffeur));
    expect(enroute!.message.subject).toBe('Enroute Trip');
    expect(enroute!.message.text).toContain('Dee Driver');
    const arrived = await emailFor('trip.arrived', customer, ctx(booking(), chauffeur));
    expect(arrived!.message.subject).toBe('Chauffeur Arrived!');
    expect(arrived!.message.text).toContain('+12065550111');
    expect(await emailFor('trip.arrived', driver, ctx(booking(), chauffeur))).toBeNull();
  });

  it('a trip closed by hand sends the short note, not the thank-you', async () => {
    const closed = await emailFor('trip.completed', customer, ctx(booking()), { closedBy: 'admin' });
    expect(closed!.message.subject).toBe('Trip Completed');
    expect(closed!.attachments).toBeUndefined();
    const driven = await emailFor('trip.completed', customer, ctx(booking()), {});
    expect(driven!.message.subject).toBe('All Black Limo Trip Completed');
  });

  it('a rejected request sends the rejection notice with the reason, not the cancellation', async () => {
    const rejected = await emailFor('booking.cancelled', customer, ctx(booking()), {
      rejected: true,
      reason: 'No chauffeur available that night',
    });
    expect(rejected!.message.subject).toBe('Booking Rejection Notice');
    expect(rejected!.message.text).toContain('No chauffeur available that night');
    expect(rejected!.message.text).toContain('ABL-');
    const ordinary = await emailFor('booking.cancelled', customer, ctx(booking()), {});
    expect(ordinary!.message.subject).toBe('Booking Cancellation Confirmation');
  });

  it('confirming a trip sends the full details; a no-show sends the no-show notice', async () => {
    const confirmed = await emailFor('trip.confirmed', customer, ctx(booking(), { chauffeur: { name: 'Dee Driver', phone: '+12065550111' } }));
    expect(confirmed!.message.subject).toBe('Trip Confirmed');
    expect(confirmed!.message.text).toContain('Dee Driver');
    expect(confirmed!.message.text).toContain('Hotel Andra, Seattle');
    expect(confirmed!.message.text).toContain('Business Sedan');
    const noShow = await emailFor('trip.no_show', customer, ctx(booking()));
    expect(noShow!.message.subject).toBe('Your Reservation Has Been Marked as a No-Show');
    expect(noShow!.message.text).toContain('No-Show');
    expect(await emailFor('trip.no_show', driver, ctx(booking()))).toBeNull();
  });

  it('the window-closing reminder is the upcoming-trip reminder', async () => {
    const built = await emailFor('booking.cancellation_window_closing', customer, ctx(booking()));
    expect(built!.message.subject).toBe('Upcoming Trip – Please Confirm Your Details');
  });

  it('sends nothing for what the original system never emailed', async () => {
    for (const type of ['booking.updated', 'booking.repriced', 'wallet.refund_issued', 'dispatch.ride_offer', 'driver.penalty_applied', 'wallet.payout_ready', 'flight.arrival_time']) {
      expect(await emailFor(type, customer, ctx(booking()))).toBeNull();
    }
  });

  it('never emails a chauffeur: they are told in the app', async () => {
    for (const type of ['booking.created', 'booking.cancelled', 'trip.cancelled', 'trip.driver_assigned', 'trip.completed']) {
      expect(await emailFor(type, driver, ctx(booking()))).toBeNull();
    }
  });

  it('sends nothing when there is no booking to talk about', async () => {
    expect(await emailFor('booking.created', customer, ctx(null))).toBeNull();
  });

  it('a failed PDF never stops the email', async () => {
    const docs = await import('../src/modules/booking/booking.documents.load');
    vi.mocked(docs.renderStoredDocument).mockRejectedValueOnce(new Error('pdf broke'));
    const built = await emailFor('booking.created', customer, ctx(booking()));
    expect(built!.message.subject).toMatch(/Invoice/);
    expect(built!.attachments).toEqual([]);
  });
});

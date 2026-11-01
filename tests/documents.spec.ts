import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const mocks = vi.hoisted(() => ({ findById: vi.fn(), tripFindOne: vi.fn(), labelFor: vi.fn() }));

vi.mock('../src/models/Booking', async (orig) => {
  const actual = await orig<typeof import('../src/models/Booking')>();
  return { ...actual, Booking: Object.assign(actual.Booking, { findById: mocks.findById }) };
});
vi.mock('../src/models/Trip', async (orig) => {
  const actual = await orig<typeof import('../src/models/Trip')>();
  return { ...actual, Trip: Object.assign(actual.Trip, { findOne: mocks.tripFindOne }) };
});
vi.mock('../src/modules/vehicle/vehicle.service', async (orig) => {
  const actual = await orig<typeof import('../src/modules/vehicle/vehicle.service')>();
  return { ...actual, labelFor: mocks.labelFor };
});

import app from '../src/app';
import { useServer } from './server';
import { env } from '../src/config/env';
import {
  availableDocuments,
  bookingReference,
  buildDocument,
  isPaid,
  pdfSafe,
  renderDocumentPdf,
  type DocumentInput,
} from '../src/modules/booking/booking.documents';
import { fareBreakdownFor } from '../src/modules/booking/booking.service';

const server = useServer(app);

const ID = '5f9d88b8b54764421b7156c9';
const issuedAt = new Date('2026-10-26T18:00:00Z');

const baseBooking = (over: Record<string, unknown> = {}) =>
  ({
    _id: ID,
    customerId: 'u1',
    pickup: { lat: 1, lng: 1, address: '123 Pine St, Seattle' },
    drop: { lat: 1, lng: 1, address: 'Sea-Tac Airport' },
    vehicleClass: 'sedan',
    tripType: 'point2point',
    status: 'assigned',
    scheduledAt: new Date('2026-11-03T17:00:00Z'),
    estimatedFare: 195,
    passengers: 2,
    fareBreakdown: {
      classFare: 140,
      primetimeSurcharge: 20,
      meetAndGreetFee: 25,
      stopCount: 1,
      stopFee: 10,
      pricingModel: 'flat',
    },
    amendments: [],
    ...over,
  }) as unknown as DocumentInput['booking'];

const card = (over: Record<string, unknown> = {}) => ({
  provider: 'stripe',
  intentId: 'pi_1',
  leg: 0,
  amount: 195,
  currency: 'USD',
  status: 'paid',
  brand: 'visa',
  last4: '4242',
  refundedAmount: 0,
  refundIds: [],
  paidAt: new Date('2026-10-20T10:00:00Z'),
  ...over,
});

const input = (booking = baseBooking(), over: Partial<DocumentInput> = {}): DocumentInput => ({
  booking,
  trip: null,
  customer: { name: 'Sam Rider', email: 'sam@example.com', phone: '+12065550148' },
  vehicleLabel: 'Business Sedan',
  issuedAt,
  ...over,
});

describe('who has paid', () => {
  it('counts a card payment at booking', () => {
    expect(isPaid({ payment: card() as never })).toBe(true);
  });
  it('counts a settled, completed trip', () => {
    expect(isPaid({}, { status: 'completed', settled: true })).toBe(true);
  });
  it('does not count a completed trip nobody settled, or a ride still to come', () => {
    expect(isPaid({}, { status: 'completed', settled: false })).toBe(false);
    expect(isPaid({}, { status: 'accepted', settled: false })).toBe(false);
    expect(isPaid({}, null)).toBe(false);
  });
  it('always offers the invoice, the receipt only once paid', () => {
    expect(availableDocuments({})).toEqual({ invoice: true, receipt: false });
    expect(availableDocuments({ payment: card() as never })).toEqual({ invoice: true, receipt: true });
  });
});

describe('buildDocument — invoice', () => {
  it('itemises the fare the customer was quoted, and the lines add up to the total', () => {
    const doc = buildDocument('invoice', input());
    expect(doc.lines.map((l) => [l.label, l.amount])).toEqual([
      ['Point to point · Business Sedan', 140],
      ['Primetime surcharge (10pm to 7am)', 20],
      ['Meet and Greet', 25],
      ['Additional stop', 10],
    ]);
    expect(doc.lines.reduce((s, l) => s + l.amount, 0)).toBe(doc.total);
    expect(doc.total).toBe(195);
  });

  it('numbers it from the booking reference', () => {
    const doc = buildDocument('invoice', input());
    expect(doc.reference).toBe(bookingReference(ID));
    expect(doc.number).toBe('INV-' + bookingReference(ID).slice(4));
  });

  it('prints the booking\'s running trip number, as the old site did, on invoice and receipt', () => {
    const booking = { ...baseBooking(), tripNo: '13776', payment: card() as never } as ReturnType<typeof baseBooking>;
    expect(buildDocument('invoice', input(booking)).number).toBe('13776');
    expect(buildDocument('receipt', input(booking)).number).toBe('13776');
  });

  it('keeps an imported old booking\'s own trip number', () => {
    const booking = { ...baseBooking(), legacy: { tripId: ID, tripNo: '13001', legIndex: 0, legCount: 1 } } as never;
    expect(buildDocument('invoice', input(booking)).number).toBe('13001');
  });

  it('itemises a fare with every extra, and the lines still add up to the total charged', () => {
    // trip 226 = 129 + 12 miles + 20 primetime + 25 meet and greet + 40 stop; then fuel, tip, discount, tax
    const booking = baseBooking({
      estimatedFare: 305.96,
      fareBreakdown: {
        classFare: 129,
        distanceFee: 12,
        extraMiles: 4,
        perMileRate: 3,
        primetimeSurcharge: 20,
        meetAndGreetFee: 25,
        stopCount: 1,
        stopFee: 40,
        fuelSurchargePct: 10,
        fuelSurcharge: 23,
        gratuityPct: 20,
        gratuity: 46,
        discountKind: 'welcome',
        discount: 10,
        taxPct: 8,
        tax: 20.96,
        pricingModel: 'flat',
      },
    });
    const doc = buildDocument('invoice', input(booking));
    expect(doc.lines.map((l) => l.label)).toEqual([
      'Point to point · Business Sedan',
      'Additional miles (4 × $3.00)',
      'Primetime surcharge (10pm to 7am)',
      'Meet and Greet',
      'Additional stop',
      'Fuel surcharge (10%)',
      'Gratuity (20%)',
      'Welcome discount',
      'Tax (8%)',
    ]);
    expect(Math.round(doc.lines.reduce((s, l) => s + l.amount, 0) * 100) / 100).toBe(doc.total);
    expect(doc.total).toBe(305.96);
  });

  it('shows an unpaid ride as due', () => {
    const doc = buildDocument('invoice', input());
    expect(doc).toMatchObject({ status: 'due', amountPaid: 0, balanceDue: 195 });
    expect(doc.payment).toBeUndefined();
  });

  it('shows a card-paid ride as paid, with how and when', () => {
    const doc = buildDocument('invoice', input(baseBooking({ payment: card() })));
    expect(doc).toMatchObject({ status: 'paid', amountPaid: 195, balanceDue: 0 });
    expect(doc.payment?.method).toBe('VISA ending 4242');
    expect(doc.payment?.paidAt).toEqual(new Date('2026-10-20T10:00:00Z'));
  });

  it('falls back to one honest line when the make-up was never recorded', () => {
    const doc = buildDocument('invoice', input(baseBooking({ fareBreakdown: undefined })));
    expect(doc.lines).toEqual([{ label: 'Chauffeur service · Business Sedan', amount: 195 }]);
  });

  it('lists free car seats at no charge and plural stops', () => {
    const doc = buildDocument(
      'invoice',
      input(baseBooking({ carSeats: 2, fareBreakdown: { classFare: 140, primetimeSurcharge: 0, meetAndGreetFee: 0, stopCount: 3, stopFee: 30, pricingModel: 'flat' } })),
    );
    expect(doc.lines).toContainEqual({ label: 'Additional stops × 3', amount: 30 });
    expect(doc.lines).toContainEqual({ label: 'Child car seats × 2', amount: 0 });
  });

  it('describes an hourly charter and a fixed route price', () => {
    const hourly = buildDocument('invoice', input(baseBooking({ tripType: 'hourly', hours: 3, fareBreakdown: { classFare: 516, primetimeSurcharge: 0, meetAndGreetFee: 0, stopCount: 0, stopFee: 0, pricingModel: 'hourly', hours: 3 } })));
    expect(hourly.lines[0]).toMatchObject({ label: 'Hourly charter · Business Sedan', note: '3 hours' });
    const route = buildDocument('invoice', input(baseBooking({ fareBreakdown: { classFare: 140, primetimeSurcharge: 0, meetAndGreetFee: 0, stopCount: 0, stopFee: 0, pricingModel: 'route', route: 'Tacoma ↔ Sea-Tac' } })));
    expect(route.lines[0].note).toBe('Fixed route price: Tacoma ↔ Sea-Tac');
  });

  it('carries stops, flight and leg of a journey', () => {
    const doc = buildDocument(
      'invoice',
      input(baseBooking({ stops: [{ lat: 1, lng: 1, address: 'Pike Place' }], flightDetails: { flightNumber: 'AS123' }, journey: { index: 1, count: 3 } })),
    );
    expect(doc.journey).toMatchObject({ stops: ['Pike Place'], flight: 'AS123', leg: 'Leg 2 of 3' });
  });

  it('flags a cancelled booking, and refunds, and nets wallet credit', () => {
    expect(buildDocument('invoice', input(baseBooking({ status: 'cancelled' }))).status).toBe('cancelled');
    expect(buildDocument('invoice', input(baseBooking({ payment: card({ status: 'refunded', refundedAmount: 195 }) }))).status).toBe('refunded');
    const partial = buildDocument('invoice', input(baseBooking({ payment: card({ status: 'partially_refunded', refundedAmount: 97.5 }) })));
    expect(partial).toMatchObject({ status: 'partially_refunded', refunded: 97.5 });

    const credit = buildDocument('invoice', input(baseBooking(), { trip: { status: 'accepted', settled: false, fareAmount: 195, creditApplied: 50, timestamps: {} } }));
    expect(credit).toMatchObject({ creditApplied: 50, balanceDue: 145 });
  });
});

describe('buildDocument — receipt', () => {
  it('refuses a ride nobody has paid for', () => {
    expect(() => buildDocument('receipt', input())).toThrowError(/once the ride has been paid/);
    try {
      buildDocument('receipt', input());
    } catch (err) {
      expect((err as { statusCode: number }).statusCode).toBe(409);
    }
  });

  it('is issued for a card payment', () => {
    const doc = buildDocument('receipt', input(baseBooking({ payment: card() })));
    expect(doc.number).toBe('RCT-' + bookingReference(ID).slice(4));
    expect(doc.amountPaid).toBe(195);
  });

  it('is issued for a trip paid after the fact, net of credit', () => {
    const doc = buildDocument('receipt', input(baseBooking(), { trip: { status: 'completed', settled: true, fareAmount: 195, creditApplied: 45, timestamps: { completed: new Date('2026-11-03T18:00:00Z') } } }));
    expect(doc).toMatchObject({ amountPaid: 150, creditApplied: 45, balanceDue: 0 });
    expect(doc.payment?.method).toBe('Collected after the trip');
  });
});

describe('fareBreakdownFor', () => {
  const fare = { fare: 195, classFare: 140, primetimeSurcharge: 20, meetAndGreetFee: 25, stopCount: 1, stopFee: 10, pricingModel: 'flat', hours: undefined } as never;

  it('keeps the make-up when it matches what was charged', () => {
    expect(fareBreakdownFor(fare, 195)).toMatchObject({ classFare: 140, stopFee: 10, pricingModel: 'flat' });
    expect(fareBreakdownFor(fare)).toBeDefined();
  });

  it('refuses to state a make-up that would not add up to the charge', () => {
    expect(fareBreakdownFor(fare, 180)).toBeUndefined();
  });
});

describe('the PDF', () => {
  /**
   * Text the PDF draws, recovered from the (uncompressed) content stream. pdfkit writes
   * each text run as a TJ array of hex strings split at kerning pairs, so the pieces of
   * one run are joined with nothing between them and separate runs with a space.
   */
  const textOf = (pdf: Buffer) =>
    [...pdf.toString('latin1').matchAll(/\[((?:\s*<[0-9a-f]*>\s*-?[\d.]*)+)\]\s*TJ/g)]
      .map((run) =>
        [...run[1].matchAll(/<([0-9a-f]*)>/g)].map((m) => Buffer.from(m[1], 'hex').toString('latin1')).join(''),
      )
      .join(' ');

  it('is a real PDF', async () => {
    const pdf = await renderDocumentPdf(buildDocument('invoice', input()));
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.subarray(-6).toString()).toContain('%%EOF');
  });

  it('calls an imported booking\'s old fuel charge a fuel surcharge, not a gratuity', () => {
    const doc = buildDocument(
      'invoice',
      input(baseBooking({ legacy: { tripId: 1, legIndex: 0 }, fareBreakdown: { classFare: 140, subtotal: 140, gratuityPct: 8, gratuity: 11, primetimeSurcharge: 0, meetAndGreetFee: 0, stopFee: 0, stopCount: 0 }, estimatedFare: 151 })),
    );
    expect(doc.lines.map((l) => l.label)).toContain('Fuel surcharge (8%)');
    expect(doc.lines.map((l) => l.label).join()).not.toContain('Gratuity');
  });

  it('says what the data says', async () => {
    const data = buildDocument('receipt', input(baseBooking({ payment: card(), stops: [{ lat: 1, lng: 1, address: 'Pike Place' }] })));
    const text = textOf(await renderDocumentPdf(data, { compress: false }));
    for (const expected of ['RECEIPT', data.number, 'Sam Rider', '123 Pine St, Seattle', 'Pike Place', 'Sea-Tac Airport', '$195.00', 'VISA ending 4242']) {
      expect(text).toContain(expected);
    }
  });

  it('shows an unpaid invoice\'s banner and balance', async () => {
    const text = textOf(await renderDocumentPdf(buildDocument('invoice', input()), { compress: false }));
    expect(text).toContain('PAYMENT DUE');
    expect(text).toContain('Balance due');
  });

  it('survives characters the built-in font cannot draw', async () => {
    expect(pdfSafe('Café – 東京 🚗')).toBe('Café ? ?? ??');
    const pdf = await renderDocumentPdf(buildDocument('invoice', input(baseBooking({ pickup: { lat: 1, lng: 1, address: '東京駅 Tokyo' } }))));
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('handles a long itinerary without throwing', async () => {
    const stops = Array.from({ length: 5 }, (_, i) => ({ lat: 1, lng: 1, address: `Stop number ${i + 1} on a rather long street name, Seattle, WA` }));
    const pdf = await renderDocumentPdf(buildDocument('invoice', input(baseBooking({ stops }))));
    expect(pdf.length).toBeGreaterThan(1000);
  });
});

describe('GET /bookings/:id/documents/:kind', () => {
  const token = (role: string, userId = 'u1') =>
    `Bearer ${jwt.sign({ userId, role }, env.JWT_ACCESS_SECRET, { expiresIn: '5m' })}`;

  const found = (doc: unknown) =>
    mocks.findById.mockReturnValue({ populate: () => ({ lean: async () => doc }) });
  const owned = (over: Record<string, unknown> = {}) => ({
    ...baseBooking(over),
    customerId: { _id: 'u1', name: 'Sam Rider', email: 'sam@example.com', phone: '+12065550148' },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tripFindOne.mockReturnValue({ lean: async () => null });
    mocks.labelFor.mockResolvedValue('Business Sedan');
  });

  it('serves the owner an invoice as a PDF download', async () => {
    found(owned());
    const res = await request(server).get(`/bookings/${ID}/documents/invoice`).set('Authorization', token('customer'));

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toBe(`attachment; filename="abl-invoice-${bookingReference(ID)}.pdf"`);
    expect(res.headers['cache-control']).toContain('no-store');
    expect(Buffer.from(res.body).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('serves a receipt once the ride is paid', async () => {
    found(owned({ payment: card() }));
    const res = await request(server).get(`/bookings/${ID}/documents/receipt`).set('Authorization', token('customer'));
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('abl-receipt-');
  });

  it('refuses a receipt for an unpaid ride with a message the customer can act on', async () => {
    found(owned());
    const res = await request(server).get(`/bookings/${ID}/documents/receipt`).set('Authorization', token('customer'));
    expect(res.status).toBe(409);
    expect(res.body.message).toContain('invoice');
  });

  it('refuses someone else\'s booking', async () => {
    found(owned());
    const res = await request(server).get(`/bookings/${ID}/documents/invoice`).set('Authorization', token('customer', 'intruder'));
    expect(res.status).toBe(403);
  });

  it('lets an admin produce one for any customer', async () => {
    found(owned());
    const res = await request(server).get(`/bookings/${ID}/documents/invoice`).set('Authorization', token('admin', 'a1'));
    expect(res.status).toBe(200);
  });

  it('keeps chauffeurs and operators out', async () => {
    for (const role of ['driver', 'company']) {
      const res = await request(server).get(`/bookings/${ID}/documents/invoice`).set('Authorization', token(role));
      expect(res.status).toBe(403);
    }
  });

  it('is a 404 for a booking that is not there, and a 400 for a kind that does not exist', async () => {
    found(null);
    expect((await request(server).get(`/bookings/${ID}/documents/invoice`).set('Authorization', token('customer'))).status).toBe(404);
    expect((await request(server).get(`/bookings/${ID}/documents/statement`).set('Authorization', token('customer'))).status).toBe(400);
    expect((await request(server).get(`/bookings/not-an-id/documents/invoice`).set('Authorization', token('customer'))).status).toBe(400);
  });

  it('needs a login', async () => {
    expect((await request(server).get(`/bookings/${ID}/documents/invoice`)).status).toBe(401);
  });
});

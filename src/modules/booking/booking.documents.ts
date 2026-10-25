import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import type { BookingDocument, IBooking, IFareBreakdown } from '../../models/Booking';
import type { ITrip } from '../../models/Trip';
import { CONTACT_EMAIL, CONTACT_PHONE } from '../../config/constants';
import { format, toDate, now } from '../../config/timezone';
import { ApiError } from '../../utils/ApiError';
import { round2 } from '../../utils/money';
import { formatAddress, type Address } from '../../utils/profile';

/**
 * Invoices and receipts for a booking, as PDFs.
 *
 *   INVOICE  what the journey costs, itemised. Available for any booking, whatever its
 *            state — it is the bill, and says plainly whether it is paid, due or cancelled.
 *   RECEIPT  proof that it was paid. Only exists once money has actually been taken, so a
 *            receipt can never be produced for a ride nobody paid for.
 *
 * The data is built by a pure function (buildDocument) and drawn by another
 * (renderDocumentPdf), so what a document SAYS can be tested without parsing a PDF.
 */

export const DOCUMENT_KINDS = ['invoice', 'receipt'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export interface DocumentLine {
  label: string;
  /** Dollars. 0 renders as "Free" where the line is a free extra. */
  amount: number;
  note?: string;
}

export interface DocumentData {
  kind: DocumentKind;
  /** ABL-AB12CD → INV-AB12CD / RCT-AB12CD */
  number: string;
  reference: string;
  issuedAt: Date;
  customer: { name: string; email?: string; phone?: string; address?: string };
  journey: {
    pickup: string;
    stops: string[];
    drop: string;
    when: string;
    service: string;
    vehicle: string;
    passengers?: number;
    flight?: string;
    leg?: string;
  };
  lines: DocumentLine[];
  total: number;
  creditApplied: number;
  /** What has actually been paid (by card at booking, or collected after the trip). */
  amountPaid: number;
  refunded: number;
  /** Total less credit and payments, never negative. */
  balanceDue: number;
  payment?: { method: string; paidAt?: Date };
  /** A banner for states a reader must not miss. */
  status: 'paid' | 'due' | 'cancelled' | 'refunded' | 'partially_refunded';
}

/**
 * The logo for the top of a document. Resolved from this file so it is found both when run
 * from source (src/modules/booking) and from the build (dist/modules/booking): the assets
 * folder sits three levels up in each case. If it is ever missing, the document is drawn
 * with the name as text instead of failing — a bill without a logo is still a bill.
 */
const LOGO_PATH = path.resolve(__dirname, '../../../assets/abl-logo.png');
const LOGO_AVAILABLE = fs.existsSync(LOGO_PATH);

export const bookingReference = (id: unknown) => `ABL-${String(id).slice(-6).toUpperCase()}`;

const SERVICE_LABEL: Record<IBooking['tripType'], string> = {
  point2point: 'Point to point',
  airport: 'Airport transfer',
  hourly: 'Hourly charter',
};

/**
 * Has this ride been paid for? The one place the answer lives, so the receipt route, the
 * receipt screen's "download" link and the document itself cannot disagree.
 *
 * Paid at booking by card, or collected after the trip (a settled, completed trip).
 */
export function isPaid(
  booking: Pick<IBooking, 'payment'>,
  trip?: Pick<ITrip, 'status' | 'settled'> | null,
): boolean {
  return Boolean(booking.payment) || Boolean(trip && trip.status === 'completed' && trip.settled);
}

/** Which documents can be downloaded for this booking right now. */
export function availableDocuments(
  booking: Pick<IBooking, 'payment'>,
  trip?: Pick<ITrip, 'status' | 'settled'> | null,
): Record<DocumentKind, boolean> {
  return { invoice: true, receipt: isPaid(booking, trip) };
}

function linesFor(booking: IBooking, vehicle: string, total: number): DocumentLine[] {
  const b: IFareBreakdown | undefined = booking.fareBreakdown;

  // No recorded make-up (an older booking): one honest line rather than an invented split.
  if (!b) return [{ label: `Chauffeur service · ${vehicle}`, amount: total }];

  const lines: DocumentLine[] = [
    {
      label: `${SERVICE_LABEL[booking.tripType]} · ${vehicle}`,
      amount: b.classFare,
      note:
        b.pricingModel === 'route' && b.route
          ? `Fixed route price: ${b.route}`
          : b.pricingModel === 'hourly' || booking.tripType === 'hourly'
            ? `${b.hours ?? booking.hours ?? 1} hour${(b.hours ?? booking.hours ?? 1) === 1 ? '' : 's'}`
            : undefined,
    },
  ];
  if (b.primetimeSurcharge) lines.push({ label: 'Primetime surcharge (10pm to 7am)', amount: b.primetimeSurcharge });
  if (b.meetAndGreetFee) lines.push({ label: 'Meet and Greet', amount: b.meetAndGreetFee });
  if (b.stopFee) {
    lines.push({
      label: `Additional stop${b.stopCount > 1 ? `s × ${b.stopCount}` : ''}`,
      amount: b.stopFee,
    });
  }
  if (booking.carSeats) {
    lines.push({
      label: `Child car seat${booking.carSeats > 1 ? `s × ${booking.carSeats}` : ''}`,
      amount: 0,
    });
  }
  // The rest of the bill, only when it applied: a booking from before these existed has none.
  if (b.gratuity) lines.push({ label: `Gratuity (${b.gratuityPct}%)`, amount: b.gratuity });
  if (b.discount) {
    lines.push({ label: b.discountKind === 'welcome' ? 'Welcome discount' : 'Loyalty discount', amount: -b.discount });
  }
  if (b.tax) lines.push({ label: `Tax (${b.taxPct}%)`, amount: b.tax });
  return lines;
}

export interface DocumentInput {
  booking: IBooking & { _id: unknown };
  trip?: Pick<ITrip, 'status' | 'settled' | 'fareAmount' | 'creditApplied' | 'timestamps'> | null;
  customer: { name?: string; email?: string; phone?: string; address?: Partial<Address> | null } | null;
  vehicleLabel: string;
  /** Injectable so a document is reproducible in tests. */
  issuedAt?: Date;
}

/**
 * Everything a document says, in one structure. Throws a 409 for a receipt that cannot
 * exist yet, with a message a customer can act on.
 */
export function buildDocument(kind: DocumentKind, input: DocumentInput): DocumentData {
  const { booking, trip, customer, vehicleLabel } = input;

  if (kind === 'receipt' && !isPaid(booking, trip)) {
    throw new ApiError(
      409,
      'A receipt is available once the ride has been paid for. You can download the invoice now.',
      { code: 'RECEIPT_NOT_AVAILABLE' },
    );
  }

  const total = round2(trip?.fareAmount ?? booking.estimatedFare ?? 0);
  const card = booking.payment;
  const credit = round2(trip?.creditApplied ?? 0);

  // Card at booking is exact. A trip paid after the fact is the fare less any credit.
  const amountPaid = card ? round2(card.amount) : isPaid(booking, trip) ? round2(Math.max(0, total - credit)) : 0;
  const refunded = round2(card?.refundedAmount ?? 0);
  const balanceDue = round2(Math.max(0, total - credit - amountPaid));

  const cancelled = booking.status === 'cancelled' || trip?.status === 'cancelled';
  let status: DocumentData['status'] = balanceDue > 0 ? 'due' : 'paid';
  if (card?.status === 'refunded') status = 'refunded';
  else if (card?.status === 'partially_refunded') status = 'partially_refunded';
  else if (cancelled) status = 'cancelled';

  const ref = bookingReference(booking._id);
  const paidAt = card?.paidAt ?? trip?.timestamps?.completed;

  return {
    kind,
    number: `${kind === 'invoice' ? 'INV' : 'RCT'}-${ref.slice(4)}`,
    reference: ref,
    issuedAt: input.issuedAt ?? toDate(now()),
    customer: {
      name: customer?.name || 'Customer',
      ...(customer?.email ? { email: customer.email } : {}),
      ...(customer?.phone ? { phone: customer.phone } : {}),
      ...(formatAddress(customer?.address) ? { address: formatAddress(customer?.address) } : {}),
    },
    journey: {
      pickup: booking.pickup.address,
      stops: (booking.stops ?? []).map((s) => s.address),
      drop: booking.drop.address,
      when: format(booking.scheduledAt),
      service: SERVICE_LABEL[booking.tripType],
      vehicle: vehicleLabel,
      ...(booking.passengers ? { passengers: booking.passengers } : {}),
      ...(booking.flightDetails?.flightNumber ? { flight: booking.flightDetails.flightNumber } : {}),
      ...(booking.journey ? { leg: `Leg ${booking.journey.index + 1} of ${booking.journey.count}` } : {}),
    },
    lines: linesFor(booking, vehicleLabel, total),
    total,
    creditApplied: credit,
    amountPaid,
    refunded,
    balanceDue,
    ...(amountPaid > 0
      ? {
          payment: {
            method: card
              ? `${card.brand ? card.brand.toUpperCase() : 'Card'}${card.last4 ? ` ending ${card.last4}` : ''}`
              : 'Collected after the trip',
            ...(paidAt ? { paidAt } : {}),
          },
        }
      : {}),
    status,
  };
}

/* ---------------------------------- PDF ----------------------------------- */

/**
 * pdfkit's built-in fonts cover Latin-1 only. Anything outside it (emoji, arrows, other
 * scripts in an address) would draw as garbage, so it is replaced with "?" — a visible,
 * honest gap rather than a corrupt line.
 */
export function pdfSafe(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[^ -~ -ÿ]/g, '?');
}

const usd = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(2)}`;

const STATUS_BANNER: Record<DocumentData['status'], string | null> = {
  paid: null,
  due: 'PAYMENT DUE',
  cancelled: 'CANCELLED',
  refunded: 'REFUNDED',
  partially_refunded: 'PARTIALLY REFUNDED',
};

export function renderDocumentPdf(
  data: DocumentData,
  /** `compress: false` keeps the page content readable, for tests. */
  options: { compress?: boolean } = {},
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      margin: 50,
      size: 'LETTER',
      compress: options.compress ?? true,
      info: { Title: `${data.kind} ${data.number}` },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const width = right - left;
    const muted = '#6b7280';
    const t = pdfSafe;

    // Masthead
    let textLeft = left;
    if (LOGO_AVAILABLE) {
      doc.image(LOGO_PATH, left, 42, { height: 58 });
      textLeft = left + 96; // the contact line sits to the right of the logo
    } else {
      doc.fillColor('#111827').font('Helvetica-Bold').fontSize(22).text('ABL', left, 50);
    }
    doc
      .font('Helvetica-Bold')
      .fontSize(16)
      .text(data.kind === 'invoice' ? 'INVOICE' : 'RECEIPT', left, 52, { width, align: 'right' });
    doc.font('Helvetica').fontSize(9).fillColor(muted);
    doc.text(`${t(data.number)}`, left, 72, { width, align: 'right' });
    doc.text(`Issued ${t(format(data.issuedAt))}`, left, 84, { width, align: 'right' });
    doc.text(`Booking ref ${t(data.reference)}`, left, 96, { width, align: 'right' });
    doc.text(`${CONTACT_PHONE}  ·  ${CONTACT_EMAIL}`, textLeft, LOGO_AVAILABLE ? 62 : 74, {
      width: width / 2 - (textLeft - left),
    });

    const banner = STATUS_BANNER[data.status];
    let y = 122;
    if (banner) {
      doc.roundedRect(left, y, width, 24, 4).fill(data.status === 'due' ? '#fef3c7' : '#fee2e2');
      doc.fillColor('#7c2d12').font('Helvetica-Bold').fontSize(10).text(banner, left, y + 7, { width, align: 'center' });
      y += 36;
    }

    // Customer + journey
    doc.fillColor(muted).font('Helvetica-Bold').fontSize(8).text('BILLED TO', left, y);
    doc.fillColor('#111827').font('Helvetica').fontSize(10);
    doc.text(t(data.customer.name), left, y + 12);
    if (data.customer.email) doc.text(t(data.customer.email));
    if (data.customer.phone) doc.text(t(data.customer.phone));
    if (data.customer.address) doc.text(t(data.customer.address), { width: width / 2 - 16 });

    const jx = left + width / 2;
    doc.fillColor(muted).font('Helvetica-Bold').fontSize(8).text('JOURNEY', jx, y);
    doc.fillColor('#111827').font('Helvetica').fontSize(10);
    doc.text(t(data.journey.when), jx, y + 12, { width: width / 2 });
    doc.text(t(`From: ${data.journey.pickup}`), { width: width / 2 });
    data.journey.stops.forEach((stop, i) => doc.text(t(`Stop ${i + 1}: ${stop}`), { width: width / 2 }));
    doc.text(t(`To: ${data.journey.drop}`), { width: width / 2 });
    doc.fillColor(muted).fontSize(9);
    const extra = [
      data.journey.service,
      data.journey.vehicle,
      data.journey.passengers ? `${data.journey.passengers} passenger${data.journey.passengers === 1 ? '' : 's'}` : null,
      data.journey.flight ? `Flight ${data.journey.flight}` : null,
      data.journey.leg,
    ].filter(Boolean);
    doc.text(t(extra.join('  ·  ')), { width: width / 2 });

    y = Math.max(doc.y, y + 70) + 22;

    // Lines
    doc.moveTo(left, y).lineTo(right, y).strokeColor('#e5e7eb').stroke();
    doc.fillColor(muted).font('Helvetica-Bold').fontSize(8);
    doc.text('DESCRIPTION', left, y + 8);
    doc.text('AMOUNT', left, y + 8, { width, align: 'right' });
    y += 24;

    doc.font('Helvetica').fontSize(10).fillColor('#111827');
    for (const line of data.lines) {
      const startY = y;
      doc.text(t(line.label), left, y, { width: width - 90 });
      if (line.note) {
        doc.fillColor(muted).fontSize(8).text(t(line.note), left, doc.y, { width: width - 90 });
        doc.fillColor('#111827').fontSize(10);
      }
      doc.text(line.amount === 0 ? 'Free' : usd(line.amount), left, startY, { width, align: 'right' });
      y = Math.max(doc.y, startY + 16) + 6;
    }

    // Totals
    doc.moveTo(left, y).lineTo(right, y).strokeColor('#e5e7eb').stroke();
    y += 10;
    const row = (label: string, value: string, bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 12 : 10).fillColor('#111827');
      doc.text(label, left, y, { width: width - 110 });
      doc.text(value, left, y, { width, align: 'right' });
      y += bold ? 20 : 16;
    };
    row('Total', usd(data.total), true);
    if (data.creditApplied) row('Wallet credit applied', `-${usd(data.creditApplied)}`);
    if (data.amountPaid) row(data.kind === 'receipt' ? 'Amount paid' : 'Paid', usd(data.amountPaid));
    if (data.refunded) row('Refunded', `-${usd(data.refunded)}`);
    if (data.kind === 'invoice' || data.balanceDue > 0) row('Balance due', usd(data.balanceDue), data.balanceDue > 0);

    if (data.payment) {
      y += 6;
      doc.font('Helvetica').fontSize(9).fillColor(muted);
      doc.text(
        t(`Paid with ${data.payment.method}${data.payment.paidAt ? ` on ${format(data.payment.paidAt)}` : ''}.`),
        left,
        y,
        { width },
      );
    }

    // Footer
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(muted)
      .text(
        'Thank you for travelling with ABL. Questions about this document? Reply to the email it came with or call us.',
        left,
        doc.page.height - 70,
        { width, align: 'center' },
      );

    doc.end();
  });
}

/* ------------------------------ the entry point --------------------------- */

export interface GeneratedDocument {
  buffer: Buffer;
  filename: string;
  data: DocumentData;
}

export async function generateDocument(
  kind: DocumentKind,
  input: DocumentInput,
): Promise<GeneratedDocument> {
  const data = buildDocument(kind, input);
  const buffer = await renderDocumentPdf(data);
  return { buffer, filename: `abl-${kind}-${data.reference}.pdf`, data };
}

export type { BookingDocument };

import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { CONTACT_EMAIL } from '../../config/constants';
import { format } from '../../config/timezone';
import type { DocumentData, DocumentLine } from './booking.documents';

/**
 * The invoice, laid out as the old ABL one was: logo and address at the top, "INVOICE" in the
 * middle, who and what in two columns, a DATE / SERVICE / DESCRIPTION / RATE table, the totals,
 * then the Terms and Conditions. The numbers come from the same DocumentData as before; only
 * the drawing differs.
 */
const LOGO_PATH = path.resolve(__dirname, '../../../assets/abl-invoice-logo.png');
const LOGO_AVAILABLE = fs.existsSync(LOGO_PATH);

const usd = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(2)}`;
/** The built-in font draws Latin-1 only; anything else becomes "?". Line breaks are kept. */
const safe = (text: string) => text.replace(/[^\n\u0020-\u007e\u00a0-\u00ff]/g, '?');

interface Row {
  date: string;
  service: string;
  description: string;
  rate: string;
}

const SERVICE_NAME: Record<string, string> = {
  'Point to point': 'Point To Point',
  'Airport transfer': 'Airport',
  'Hourly charter': 'Hourly Trip',
};

/** The old table: the trip row, then Prime Time, Meet & Greet, car seats, stops and the fuel charge. */
function rowsFor(data: DocumentData): Row[] {
  const j = data.journey;
  const find = (prefix: string) => data.lines.find((l) => l.label.startsWith(prefix));
  const base = data.lines[0];
  const distance = find('Additional miles');
  const stops = data.lines.filter((l) => l.label.startsWith('Additional stop'));
  const seats = find('Child car seat');
  const fuel = find('Fuel surcharge');
  const tip = find('Gratuity');

  const description = [
    `Pickup Time : ${j.time}`,
    `Pickup : ${j.pickup}`,
    ...j.stops.map((s, i) => `Stop ${i + 1} : ${s}`),
    `Dropoff : ${j.drop}`,
    `Flight Info : ${j.flight ?? ''}`,
    `Description : ${j.notes ?? ''}`,
  ].join('\n');

  const rows: Row[] = [
    { date: j.date, service: `${SERVICE_NAME[j.service] ?? j.service}${j.leg ? `\n${j.leg}` : ''}`, description, rate: usd(base ? base.amount : data.total) },
  ];
  if (distance) rows.push({ date: '', service: '', description: distance.label + (distance.note ? `\n${distance.note}` : ''), rate: usd(distance.amount) });

  const money = (l?: DocumentLine) => usd(l ? l.amount : 0);
  rows.push({ date: '', service: 'Additional Info', description: 'Prime Time', rate: money(find('Primetime')) });
  rows.push({ date: '', service: '', description: 'Meet & Greet', rate: money(find('Meet and Greet')) });
  if (seats) rows.push({ date: '', service: 'Car Seat', description: seats.label.replace('Child car seat', 'Child car seat'), rate: money(seats) });
  stops.forEach((stop, i) => rows.push({ date: '', service: i === 0 ? 'Stops' : '', description: stop.label, rate: money(stop) }));
  rows.push({ date: '', service: '', description: fuel ? fuel.label.replace('Fuel surcharge', 'Fuel Charge') : 'Fuel Charge (0%)', rate: money(fuel) });
  if (tip) rows.push({ date: '', service: '', description: tip.label, rate: money(tip) });
  return rows;
}

// No banner for an unpaid invoice: the old site's invoice never said "payment due".
const BANNER: Partial<Record<DocumentData['status'], string>> = {
  cancelled: 'CANCELLED',
  refunded: 'REFUNDED',
  partially_refunded: 'PARTIALLY REFUNDED',
};

export function renderInvoicePdf(data: DocumentData, options: { compress?: boolean } = {}): Promise<Buffer> {
  const isReceipt = data.kind === 'receipt';
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      margin: 50,
      size: 'A4',
      bufferPages: true,
      compress: options.compress ?? true,
      info: { Title: `${isReceipt ? 'Receipt' : 'Invoice'} ${data.number}` },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const hr = (y: number) => doc.strokeColor('#aaaaaa').lineWidth(1).moveTo(50, y).lineTo(550, y).stroke();

    /* ------------------------------- header ------------------------------- */
    if (LOGO_AVAILABLE) doc.image(LOGO_PATH, 55, 40, { width: 100 });
    else doc.fillColor('#111111').font('Helvetica-Bold').fontSize(22).text('ABL', 55, 50);
    doc.fillColor('#444444').font('Helvetica').fontSize(10);
    doc.text('5800 Soundview Dr A104,', 370, 55);
    doc.text('Gig Harbor, WA 98335', 370, 70);
    doc.text(CONTACT_EMAIL, 370, 85);
    doc.text('206-672-8281', 370, 100);
    doc.fillColor('#000000').fontSize(20).text(isReceipt ? 'PAYMENT RECEIPT' : 'INVOICE', 50, 130, { align: 'center' });
    hr(155);

    /* ------------------------------ details ------------------------------- */
    const j = data.journey;
    let leftY = 165;
    const rowHeight = 15;
    doc.fontSize(10).fillColor('#000000');
    const left = (label: string, value: string, bold = false) => {
      doc.font('Helvetica').text(label, 50, leftY);
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').text(safe(value), 150, leftY, { width: 140 });
      leftY += Math.max(rowHeight, doc.heightOfString(safe(value), { width: 140 }));
    };
    left(isReceipt ? 'Receipt no:' : 'Invoice no:', data.number, true);
    left(isReceipt ? 'Payment Date:' : 'Invoice Date:', format(isReceipt ? (data.payment?.paidAt ?? data.issuedAt) : data.issuedAt, 'LLL dd, yyyy'));
    if (isReceipt) left('Payment Method:', data.payment?.method ?? 'Card');
    left('Vehicle:', j.vehicle);
    left('Passengers:', String(j.passengers ?? ''));
    left('Bags:', String(j.bags));

    let rightY = 165;
    doc.font('Helvetica').text(isReceipt ? 'Billed to:' : 'Bill to:', 300, rightY);
    doc.font('Helvetica-Bold').text(safe(data.customer.name), 350, rightY, { width: 200 });
    rightY += rowHeight;
    doc.font('Helvetica');
    for (const line of [data.customer.address, data.customer.email, data.customer.phone]) {
      if (!line) continue;
      doc.text(safe(line), 350, rightY, { width: 200 });
      rightY += Math.max(rowHeight, doc.heightOfString(safe(line), { width: 200 }));
    }

    const banner = BANNER[data.status];
    let y = Math.max(245, Math.max(leftY, rightY) + 15);
    if (banner) {
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#b91c1c').text(banner, 50, y - 12, { width: 500, align: 'center' });
      doc.fillColor('#000000').fontSize(10);
      y += 14;
    }

    /* -------------------------------- table ------------------------------- */
    const col = { date: 50, service: 110, description: 190, rate: 500 };
    const drawHeader = () => {
      doc.font('Helvetica-Bold').fillColor('#000000').fontSize(10);
      doc.text('DATE', col.date, y).text('SERVICE', col.service, y).text('DESCRIPTION', col.description, y);
      doc.text('RATE', col.rate, y, { width: 50, align: 'right' });
      hr(y + 20);
      y += 30;
    };
    drawHeader();

    doc.font('Helvetica').fontSize(10);
    rowsFor(data).forEach((item, i) => {
      const text = safe(item.description);
      const height = Math.max(doc.heightOfString(text, { width: 300 }), doc.heightOfString(item.service, { width: 100 }), 5);
      if (y + height > doc.page.height - 50) {
        doc.addPage();
        y = 50;
        drawHeader();
      }
      if (i === 0) hr(y - 8);
      doc.font('Helvetica');
      doc.text(item.date, col.date, y, { width: 55 });
      doc.text(item.service, col.service, y, { width: 75 });
      doc.text(text, col.description, y, { width: 300 });
      doc.text(item.rate, col.rate, y, { width: 50, align: 'right' });
      y += height + 10;
    });

    /* ------------------------------- totals ------------------------------- */
    if (y > doc.page.height - 200) {
      doc.addPage();
      y = 50;
    }
    hr(y);
    const sub = data.total + data.discount - data.tax;
    const total = (label: string, value: string, at: number, bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor('#000000');
      doc.text(label, 50, at, { width: 420, align: 'right' });
      doc.text(value, 480, at, { width: 70, align: 'right' });
    };
    total('Sub total', usd(sub), y + 15);
    total('Discount', usd(data.discount), y + 30);
    total('Tax', usd(data.tax), y + 45);
    total('Grand total', usd(data.total), y + 60, true);
    let tail = y + 80;
    if (data.creditApplied) {
      total('Wallet credit applied', `-${usd(data.creditApplied)}`, tail);
      tail += 15;
    }
    if (data.amountPaid) {
      total('Paid', usd(data.amountPaid), tail);
      tail += 15;
    }
    if (data.refunded) {
      total('Refunded', `-${usd(data.refunded)}`, tail);
      tail += 15;
    }
    // A plain unpaid invoice ends at the grand total, as on the old site; the balance is only
    // spelled out once something has been paid, credited or refunded against it.
    if (data.amountPaid || data.creditApplied || data.refunded) {
      total('Balance due', usd(data.balanceDue), tail, data.balanceDue > 0);
      tail += 15;
    }
    if (data.payment && !isReceipt) {
      doc.font('Helvetica').fontSize(9).fillColor('#555555');
      doc.text(
        safe(`Paid with ${data.payment.method}${data.payment.paidAt ? ` on ${format(data.payment.paidAt)}` : ''}.`),
        50,
        tail + 5,
        { width: 500, align: 'right' },
      );
      tail += 20;
    }
    doc.y = tail + 20;

    if (isReceipt) {
      // The old receipt closed with a line of thanks and carried no terms.
      doc.font('Helvetica-Bold').fontSize(12).fillColor('black');
      doc.text('Thank you for your payment. Your reservation is now fully paid and confirmed.', 50, doc.y, {
        width: 495,
        align: 'center',
      });
    } else {
      /* ------------------------- terms and conditions ------------------- */
      termsAndConditions(doc);
    }

    doc.end();
  });
}

const STANDBY_RATES: [string, string][] = [
  ['Sedan', '$27'],
  ['First Class Sedan', '$35'],
  ['MPV', '$32'],
  ['SUV First Class', '$40'],
  ['Minibus', '$49'],
  ['Executive Limo', '$67'],
];

/** The old invoice's terms, word for word. */
function termsAndConditions(doc: PDFKit.PDFDocument) {
  const width = 495;
  const heading = (text: string) => {
    doc.moveDown(0.5);
    doc.font('Helvetica-Bold').fontSize(11).fillColor('black');
    doc.text(text, 50, doc.y, { width });
    doc.font('Helvetica').fontSize(10);
  };
  const paragraph = (text: string) => {
    doc.moveDown(0.25);
    doc.text(text, 50, doc.y, { width });
  };
  const bullet = (text: string) => {
    doc.moveDown(0.15);
    doc.text(`•  ${text}`, 60, doc.y, { width: width - 10 });
  };
  const hr = (y: number) => doc.strokeColor('#aaaaaa').lineWidth(1).moveTo(50, y).lineTo(550, y).stroke();

  doc.font('Helvetica-Bold').fontSize(13).fillColor('black');
  doc.text('Terms and Conditions', 50, doc.y, { width });
  doc.font('Helvetica').fontSize(10);

  paragraph(
    'By booking transportation services, providing a credit card, authorizing payment, or paying an invoice, the client acknowledges and agrees to the following Terms and Conditions.',
  );

  heading('Service Charge');
  paragraph(
    'The service charge is a temporary fuel surcharge added to help offset unusually high fuel costs. This charge will remain in effect until fuel prices return to normal operating levels.',
  );
  paragraph('The service charge is not a gratuity or chauffeur tip.');

  heading('Weather and Hazardous Road Conditions');
  paragraph(
    'If weather or road conditions become severe, hazardous, or unusually difficult, an additional surcharge may be applied based on the severity of the conditions, additional travel time, and operational requirements.',
  );
  paragraph(
    'All Black Limo reserves the right to delay, reroute, modify, or discontinue transportation when conditions are determined to be unsafe.',
  );

  // The heading, its three lines and the rate table are read together: if they do not fit in
  // what is left of the page they start the next one, rather than splitting a table row in two.
  if (doc.y + 300 > doc.page.height - 50) doc.addPage();
  heading('Standby / Wait Time');
  paragraph('Airport Pickups: A one-hour complimentary standby period is included.');
  paragraph('All Other Reservations: A 15-minute complimentary standby period is included.');
  paragraph('After the complimentary standby period expires, standby charges are billed in 15-minute increments as follows:');

  doc.moveDown(0.5);
  doc.font('Helvetica-Bold');
  const headerRowY = doc.y;
  doc.text('Vehicle', 60, headerRowY);
  doc.text('Standby Charge per 15 Minutes', 320, headerRowY);
  doc.moveDown(0.3);
  hr(doc.y);
  doc.moveDown(0.3);
  doc.font('Helvetica');
  for (const [vehicleType, rate] of STANDBY_RATES) {
    const rowY = doc.y;
    doc.text(vehicleType, 60, rowY);
    doc.text(rate, 320, rowY);
    doc.moveDown(0.45);
  }
  hr(doc.y);

  paragraph('Any portion of an additional 15-minute period may be billed as a full 15-minute increment.');
  paragraph(
    'Standby charges continue until the passenger arrives, the vehicle is released, or the reservation is classified as a no-show.',
  );

  heading('Reservation Changes');
  paragraph('All reservation changes must be submitted directly to All Black Limo by email or SMS:');
  paragraph('Email: Reservations@allblacklimoseattle.com');
  paragraph('SMS: 206-672-8281');
  paragraph(
    'Changes communicated only to the chauffeur, through another phone number, social media, a third party, or another method may not be considered an authorized reservation change.',
  );
  paragraph(
    'Any changes requested within 24 hours of the scheduled pickup time may incur applicable standby charges and/or additional service charges.',
  );
  paragraph('All changes are subject to chauffeur, vehicle, scheduling, and operational availability.');

  heading('Cancellations');
  paragraph(
    'Reservations canceled within 24 hours of the scheduled pickup time will be charged the full reservation fare and are non-refundable.',
  );

  heading('No-Shows');
  paragraph('No-shows are treated the same as late cancellations and are non-refundable.');
  paragraph(
    'The chauffeur reserves the right to terminate the reservation and depart if the client has not arrived within one hour of the scheduled pickup time, unless otherwise authorized by All Black Limo.',
  );
  paragraph('Applicable standby charges may also be assessed before the reservation is terminated as a no-show.');

  heading('Refunds and Credits');
  paragraph('All approved refunds are subject to a 10% processing fee, unless otherwise required by law.');
  paragraph('Credits are valid for 90 days from the original booking date and:');
  bullet('Have no cash value.');
  bullet('Are not eligible for cash refunds.');
  bullet('Must be used within the 90-day validity period.');

  heading('Billing and Merchant Information');
  paragraph('All Black Limo LLC is a division of Saywa Inc.');
  paragraph(
    'All invoices, charges, and refunds are processed for All Black Limo transportation services. The client’s credit card statement, banking statement, or receipt may display Saywa as the merchant of record.',
  );
  paragraph('Credit card transactions may therefore appear under Saywa.');

  heading('Acceptance of Terms');
  paragraph(
    'By booking a reservation, providing payment information, authorizing a credit card charge, or making payment, the client confirms that they have reviewed, understood, and agreed to these Terms and Conditions.',
  );
  paragraph(
    'All Black Limo reserves the right to charge the authorized payment method on file for the original reservation, standby time, approved reservation changes, additional services, surcharges, and other applicable charges incurred under these Terms and Conditions.',
  );

  doc.moveDown(0.2);
  doc.fontSize(11).fillColor('gray').text('----------- [END] -----------', 50, doc.y, { width, align: 'center' });
}

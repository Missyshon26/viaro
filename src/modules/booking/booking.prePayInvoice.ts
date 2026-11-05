import { Types } from 'mongoose';
import { Booking, type IBooking } from '../../models/Booking';
import { User } from '../../models/User';
import { isTest } from '../../config/env';
import { now, toDate } from '../../config/timezone';
import { logger } from '../../utils/logger';
import { sendEmail } from '../../integrations/email';
import { copyFor } from '../../integrations/emailCopy';
import { prePaymentInvoiceEmail } from '../../integrations/emailTemplates';
import * as vehicleService from '../vehicle/vehicle.service';
import { buildDocument, renderDocumentPdf } from './booking.documents';
import { fareBreakdownFor } from './booking.service';
import type { CreateBookingInput } from './booking.validation';
import type { FareBreakdown as FareQuote } from '../pricing/pricing.service';

/**
 * The unpaid invoice a customer is emailed the moment they press Pay, as on the old site
 * (which emailed it before sending them to Stripe). No booking exists yet at that point —
 * it is only made once the card succeeds — so the invoice is built from the quoted trip,
 * under the trip number that booking will carry (reserved by startCheckout).
 *
 * Fire-and-forget: a slow or failing mail server must never hold up the payment.
 */
export async function sendPrePaymentInvoice(input: {
  userId: string;
  legs: CreateBookingInput[];
  fares: FareQuote[];
  vehicleClasses: string[];
  tripNo: string;
  /** The Pay Now link to put in the email, when one could be made. */
  pay?: { amount: number; link: string; expiresLabel: string } | null;
}): Promise<void> {
  if (isTest) return;
  try {
    const customer = await User.findById(input.userId).select('name email phone address').lean();
    if (!customer?.email) return;

    const attachments = [];
    for (const [index, leg] of input.legs.entries()) {
      const fare = input.fares[index];
      // An unsaved booking, only so the invoice is drawn by the same code as every other one.
      const draft = new Booking({
        customerId: input.userId,
        tripNo: input.tripNo,
        pickup: leg.pickup,
        drop: leg.drop,
        vehicleClass: input.vehicleClasses[index],
        passengers: leg.passengers,
        tripType: leg.tripType,
        ...(leg.packageId && fare.packageName ? { packageId: leg.packageId, packageName: fare.packageName } : {}),
        city: leg.city,
        // Through the shared helper: an offset-less time is Pacific wall time, as on a real booking.
        scheduledAt: leg.scheduledAt ? toDate(leg.scheduledAt) : toDate(now()),
        ...(leg.hours ? { hours: leg.hours } : {}),
        ...(leg.stops?.length ? { stops: leg.stops } : {}),
        carSeats: leg.carSeats ?? 0,
        ...(leg.checkedBags !== undefined ? { checkedBags: leg.checkedBags } : {}),
        ...(leg.carryOnBags !== undefined ? { carryOnBags: leg.carryOnBags } : {}),
        ...(leg.flightDetails ? { flightDetails: { flightNumber: leg.flightDetails.flightNumber } } : {}),
        ...(leg.description ? { description: leg.description } : {}),
        estimatedFare: fare.fare,
        fareBreakdown: fareBreakdownFor(fare),
        ...(input.legs.length > 1 ? { journey: { index, count: input.legs.length } } : {}),
        status: 'pending',
      }).toObject() as IBooking & { _id: Types.ObjectId };

      const data = buildDocument('invoice', {
        booking: draft,
        trip: null,
        customer,
        vehicleLabel: await vehicleService.labelFor(input.vehicleClasses[index]),
      });
      // No booking reference yet: the invoice is known by its number.
      data.reference = input.tripNo;
      attachments.push({
        filename: `abl-invoice-${input.tripNo}${input.legs.length > 1 ? `-leg${index + 1}` : ''}.pdf`,
        content: await renderDocumentPdf(data),
        contentType: 'application/pdf',
      });
    }

    await sendEmail({
      to: customer.email,
      ...copyFor(customer.email),
      ...prePaymentInvoiceEmail({ name: customer.name, ref: input.tripNo, pay: input.pay }),
      attachments,
    });
  } catch (err) {
    logger.warn('[email] could not send the pre-payment invoice', err);
  }
}

import { Booking } from '../../models/Booking';
import { User } from '../../models/User';
import { ApiError } from '../../utils/ApiError';
import { sendEmail } from '../../integrations/email';
import { invoiceEmail } from '../../integrations/emailTemplates';
import { renderStoredDocument } from './booking.documents.load';
import { linkForInvoice } from '../payments/paymentLink';
import { format, toDate } from '../../config/timezone';
import { copyFor } from '../../integrations/emailCopy';

/**
 * Emails the customer their invoice, on request (an operator pressing "Send invoice" or
 * "Send invoice & payment link").
 *
 * Unlike the automatic emails this REPORTS failure: the operator asked for it and is
 * waiting to tell the customer it is on its way, so "sent" has to mean sent.
 */
export async function emailInvoiceToCustomer(bookingId: string, adminId = 'system', withPaymentLink = true) {
  const booking = await Booking.findById(bookingId).select('customerId').lean();
  if (!booking) throw ApiError.notFound('Booking not found');

  const customer = await User.findById(booking.customerId).select('name email').lean();
  if (!customer?.email) throw ApiError.notFound('The customer has no email address to send an invoice to');

  const doc = await renderStoredDocument(bookingId, 'invoice');
  // "Send invoice & payment link": an unpaid trip's invoice carries a Pay Now link; a paid one has nothing to pay.
  // "Send invoice": the PDF alone, and no link is made (so none is retired or created as a side effect).
  const link = withPaymentLink ? await linkForInvoice(bookingId, adminId) : null;
  const result = await sendEmail({
    to: customer.email,
    ...copyFor(customer.email),
    ...invoiceEmail(link ? { amount: link.amount, link: link.url, expiresLabel: format(toDate(link.expiresAt)) } : null),
    attachments: [{ filename: doc.filename, content: doc.buffer, contentType: 'application/pdf' }],
  });
  if (!result.sent) {
    throw new ApiError(502, "The invoice email could not be sent right now. Download the invoice and send it another way, or try again shortly.");
  }
  return { sentTo: customer.email, filename: doc.filename, paymentLinkIncluded: Boolean(link) };
}

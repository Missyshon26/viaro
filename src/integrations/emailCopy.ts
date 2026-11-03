import { env } from '../config/env';

/**
 * The blind copy for an email an operator sends a customer (an invoice, a payment link), so
 * reservations keeps what the customer was sent. Nothing when it is switched off, or when
 * the customer IS that address (they would get it twice).
 */
export function copyFor(to: string): { bcc?: string } {
  const bcc = env.INVOICE_BCC_EMAIL.trim();
  return bcc && bcc.toLowerCase() !== to.trim().toLowerCase() ? { bcc } : {};
}

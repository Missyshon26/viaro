import { notifyOps, OPS_NOTIFICATIONS } from '../notifications/ops.notify';
import { logger } from '../../utils/logger';
import { completeCheckout } from '../booking/booking.checkout';
import { syncStripeRefunds } from './cardPayments';
import { handleCheckoutCompleted } from './paymentLink';
import type { StripeCheckoutSession } from '../../integrations/paymentGateway';

/**
 * Stripe webhook events for card payments taken at booking. Called after the signature
 * has been verified (wallet.controller webhook), alongside the ledger handler.
 *
 *   payment_intent.succeeded — finish a checkout the browser did not (closed tab, lost
 *                              connection): the customer paid, so the booking is made.
 *   checkout.session.completed — a payment link sent from the console was paid; the booking
 *                              is marked paid (paymentLink.ts).
 *   charge.refunded          — a refund, including one made in the Stripe dashboard,
 *                              is recorded on the booking (checklist §3).
 *
 * Every branch is idempotent: Stripe delivers events more than once.
 */
export async function handleStripeEvent(event: {
  type?: string;
  data?: { object?: Record<string, unknown> };
}): Promise<void> {
  const object = event.data?.object ?? {};
  try {
    if (event.type === 'payment_intent.succeeded') {
      const metadata = object.metadata as { kind?: string } | undefined;
      if (metadata?.kind === 'booking') await completeCheckout(null, String(object.id));
    } else if (event.type === 'payment_intent.payment_failed') {
      const metadata = object.metadata as { kind?: string } | undefined;
      if (metadata?.kind === 'booking') {
        const reason = (object.last_payment_error as { message?: string } | undefined)?.message;
        void notifyOps(OPS_NOTIFICATIONS.PAYMENT_FAILED, {
          message: `A card payment failed at checkout${reason ? `: ${reason}` : ''}. No booking was made.`,
        });
      }
    } else if (event.type === 'checkout.session.completed') {
      // A payment link an operator sent was paid.
      await handleCheckoutCompleted(object as unknown as StripeCheckoutSession);
    } else if (event.type === 'charge.refunded') {
      const intentId = object.payment_intent;
      if (typeof intentId === 'string') await syncStripeRefunds(intentId);
    }
  } catch (err) {
    // Logged, not thrown: a 5xx makes Stripe retry an event that will fail the same way.
    logger.error(`Stripe event '${event.type}' could not be applied`, err);
  }
}

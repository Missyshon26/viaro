import crypto from 'node:crypto';
import { env } from '../config/env';
import { logger } from '../utils/logger';

/**
 * Payment gateway client (spec §4.7).
 *
 * PAYMENT_GATEWAY_PROVIDER selects the adapter: `stripe` is implemented against the live
 * REST API (no SDK dependency); with no provider or key configured it falls back to
 * `mock` so the system still runs end to end. Adding checkout.com / tap means adding one
 * adapter here and nothing else.
 */
export interface ChargeRequest {
  amount: number;
  currency?: string;
  reference: string;
  description?: string;
  /** Saved payment method / customer token, when the client already holds one. */
  paymentMethodId?: string;
  /** The gateway customer the saved method belongs to — Stripe requires it off-session. */
  customerId?: string;
}

export interface ChargeResult {
  success: boolean;
  gatewayReference: string;
  amount: number;
  currency: string;
  provider: string;
  status: string;
  placeholder: boolean;
  /** Present when the gateway needs the customer to complete 3-D Secure. */
  requiresAction?: boolean;
  clientSecret?: string;
}

const REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_CURRENCY = 'USD';

export async function collectPayment(request: ChargeRequest): Promise<ChargeResult> {
  const provider = (env.PAYMENT_GATEWAY_PROVIDER || '').toLowerCase();
  const currency = request.currency ?? DEFAULT_CURRENCY;

  if (!provider || !env.PAYMENT_GATEWAY_SECRET_KEY) return mockCharge(request, currency, provider || 'mock');

  try {
    switch (provider) {
      case 'stripe':
        return await chargeStripe(request, currency);
      default:
        logger.warn(`Unknown PAYMENT_GATEWAY_PROVIDER '${provider}' — no charge attempted`);
        return mockCharge(request, currency, provider);
    }
  } catch (err) {
    logger.error(`Payment failed for ${request.reference} via ${provider}`, err);
    return {
      success: false,
      gatewayReference: '',
      amount: request.amount,
      currency,
      provider,
      status: 'failed',
      placeholder: false,
    };
  }
}

/* ---------------------------------- stripe -------------------------------- */

interface StripePaymentIntent {
  id: string;
  status: string;
  amount: number;
  currency: string;
  client_secret?: string;
}

async function chargeStripe(request: ChargeRequest, currency: string): Promise<ChargeResult> {
  // Stripe works in the currency's smallest unit — cents, not dollars.
  const form = new URLSearchParams({
    amount: String(Math.round(request.amount * 100)),
    currency: currency.toLowerCase(),
    'metadata[reference]': request.reference,
    confirm: 'true',
  });

  if (request.description) form.set('description', request.description);
  if (request.paymentMethodId) form.set('payment_method', request.paymentMethodId);
  if (request.customerId) form.set('customer', request.customerId);
  // Off-session: the trip is already over, the customer is not at the checkout page.
  form.set('off_session', 'true');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch('https://api.stripe.com/v1/payment_intents', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.PAYMENT_GATEWAY_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        // Protects against a retried request charging the customer twice.
        'Idempotency-Key': `abl_${request.reference}`,
      },
      body: form,
      signal: controller.signal,
    });

    const intent = (await res.json()) as StripePaymentIntent & { error?: { message: string } };

    if (!res.ok) throw new Error(intent.error?.message ?? `${res.status} ${res.statusText}`);

    return {
      success: intent.status === 'succeeded',
      gatewayReference: intent.id,
      amount: intent.amount / 100,
      currency: intent.currency.toUpperCase(),
      provider: 'stripe',
      status: intent.status,
      placeholder: false,
      requiresAction: intent.status === 'requires_action',
      clientSecret: intent.client_secret,
    };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------ stripe checkout ---------------------------- */

/** True when real card payments are switched on (PAYMENT_GATEWAY_PROVIDER=stripe + key). */
export const isStripeEnabled = () =>
  (env.PAYMENT_GATEWAY_PROVIDER || '').toLowerCase() === 'stripe' && Boolean(env.PAYMENT_GATEWAY_SECRET_KEY);

/** Stripe's error, kept for logs. `message` is safe to show a customer for card errors. */
export class StripeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly type?: string,
  ) {
    super(message);
  }
}

/**
 * One call to the Stripe REST API (no SDK dependency, same as chargeStripe above).
 * Form-encoded body for writes, query string for reads.
 */
export async function stripeRequest<T>(
  method: 'GET' | 'POST',
  path: string,
  params: Record<string, string | number | undefined> = {},
  idempotencyKey?: string,
): Promise<T> {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) body.append(k, String(v));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const url = `https://api.stripe.com/v1/${path}${method === 'GET' && body.toString() ? `?${body}` : ''}`;
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${env.PAYMENT_GATEWAY_SECRET_KEY}`,
        ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      ...(method === 'POST' ? { body } : {}),
      signal: controller.signal,
    });
    const json = (await res.json()) as T & { error?: { message: string; code?: string; type?: string } };
    if (!res.ok) {
      throw new StripeError(
        json.error?.message ?? `${res.status} ${res.statusText}`,
        res.status,
        json.error?.code,
        json.error?.type,
      );
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

export interface StripePaymentIntentFull {
  id: string;
  status: string;
  amount: number;
  amount_received: number;
  currency: string;
  customer: string | null;
  client_secret: string;
  description: string | null;
  metadata: Record<string, string>;
  latest_charge: string | null;
  payment_method:
    | string
    | { id: string; card?: { brand: string; last4: string; exp_month: number; exp_year: number } }
    | null;
}

/** Amounts cross this boundary in dollars; Stripe works in cents. */
const toCents = (amount: number) => Math.round(amount * 100);

export function createPaymentIntent(input: {
  amount: number;
  customerId: string;
  description: string;
  metadata: Record<string, string>;
  currency?: string;
}): Promise<StripePaymentIntentFull> {
  const params: Record<string, string | number> = {
    amount: toCents(input.amount),
    currency: (input.currency ?? DEFAULT_CURRENCY).toLowerCase(),
    customer: input.customerId,
    description: input.description,
    'payment_method_types[]': 'card',
    // Keeps the card on the customer, so a subscription can be charged later without
    // asking for it again.
    setup_future_usage: 'off_session',
  };
  for (const [k, v] of Object.entries(input.metadata)) params[`metadata[${k}]`] = v;
  return stripeRequest('POST', 'payment_intents', params);
}

/* ---------------------- hosted payment page (payment links) ---------------------- */

export interface StripeCheckoutSession {
  id: string;
  url: string | null;
  status: 'open' | 'complete' | 'expired';
  payment_status: 'paid' | 'unpaid' | 'no_payment_required';
  payment_intent: string | null;
  amount_total: number | null;
  currency: string | null;
  expires_at: number;
  metadata: Record<string, string>;
}

/**
 * A Stripe-hosted page where one amount is paid by card — the "payment link" an operator
 * sends. The PaymentIntent it creates carries the same metadata, so a refund or webhook
 * about that payment can be traced back to the booking.
 */
export function createCheckoutSession(input: {
  amount: number;
  customerId: string;
  name: string;
  description: string;
  metadata: Record<string, string>;
  successUrl: string;
  cancelUrl: string;
  /** Unix seconds; Stripe allows 30 minutes to 24 hours from now. */
  expiresAt: number;
  idempotencyKey?: string;
}): Promise<StripeCheckoutSession> {
  const params: Record<string, string | number> = {
    mode: 'payment',
    customer: input.customerId,
    'payment_method_types[0]': 'card',
    'line_items[0][quantity]': 1,
    'line_items[0][price_data][currency]': DEFAULT_CURRENCY.toLowerCase(),
    'line_items[0][price_data][unit_amount]': toCents(input.amount),
    'line_items[0][price_data][product_data][name]': input.name,
    'line_items[0][price_data][product_data][description]': input.description,
    'payment_intent_data[description]': input.description,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    expires_at: input.expiresAt,
  };
  for (const [k, v] of Object.entries(input.metadata)) {
    params[`metadata[${k}]`] = v;
    params[`payment_intent_data[metadata][${k}]`] = v;
  }
  return stripeRequest('POST', 'checkout/sessions', params, input.idempotencyKey);
}

/** Stops a link being paid. Fails if it was already paid or already ended. */
export function expireCheckoutSession(id: string): Promise<StripeCheckoutSession> {
  return stripeRequest('POST', `checkout/sessions/${encodeURIComponent(id)}/expire`);
}

export function retrieveCheckoutSession(id: string): Promise<StripeCheckoutSession> {
  return stripeRequest('GET', `checkout/sessions/${encodeURIComponent(id)}`);
}

export function retrievePaymentIntent(id: string): Promise<StripePaymentIntentFull> {
  return stripeRequest('GET', `payment_intents/${encodeURIComponent(id)}`, {
    'expand[]': 'payment_method',
  });
}

/** Closes a payment that was opened but never paid, so it cannot be paid a second time. */
export function cancelPaymentIntent(id: string): Promise<StripePaymentIntentFull> {
  return stripeRequest('POST', `payment_intents/${encodeURIComponent(id)}/cancel`);
}

/** A saved customer id can belong to another Stripe mode (test) or have been deleted; this finds out. */
export function retrieveStripeCustomer(id: string): Promise<{ id: string; deleted?: boolean }> {
  return stripeRequest('GET', `customers/${encodeURIComponent(id)}`);
}

export function createStripeCustomer(input: {
  email: string;
  name: string;
  userId: string;
}): Promise<{ id: string }> {
  return stripeRequest(
    'POST',
    'customers',
    { email: input.email, name: input.name, 'metadata[userId]': input.userId },
    // One customer per user, even if two checkouts race to create it.
    `abl_customer_${input.userId}`,
  );
}

export interface StripeRefund {
  id: string;
  amount: number;
  status: string;
  payment_intent: string;
  metadata: Record<string, string>;
}

/** Refunds part or all of a payment back to the card. `amount` in dollars. */
export function refundToCard(input: {
  paymentIntentId: string;
  amount: number;
  metadata: Record<string, string>;
  idempotencyKey: string;
}): Promise<StripeRefund> {
  const params: Record<string, string | number> = {
    payment_intent: input.paymentIntentId,
    amount: toCents(input.amount),
  };
  for (const [k, v] of Object.entries(input.metadata)) params[`metadata[${k}]`] = v;
  return stripeRequest('POST', 'refunds', params, input.idempotencyKey);
}

export async function listRefunds(paymentIntentId: string): Promise<StripeRefund[]> {
  const page = await stripeRequest<{ data: StripeRefund[] }>('GET', 'refunds', {
    payment_intent: paymentIntentId,
    limit: 100,
  });
  return page.data;
}

/* ---------------------------------- payouts ------------------------------- */

/**
 * UML: "Withdraw Wallet Balance" «include» «system» Payment Gateway / Wallet.
 *
 * Money leaving the platform to a driver's bank/card. On Stripe this is a Transfer to a
 * connected account; other gateways call it a payout or disbursement.
 *
 * `destination` is the driver's gateway account id. Until drivers are onboarded to the
 * gateway there will be none, in which case this returns a mock result — the ledger entry
 * is still authoritative and the real transfer can be replayed from it.
 */
export interface PayoutRequest {
  amount: number;
  currency?: string;
  reference: string;
  destination?: string;
  description?: string;
}

export async function payoutToBeneficiary(request: PayoutRequest): Promise<ChargeResult> {
  const provider = (env.PAYMENT_GATEWAY_PROVIDER || '').toLowerCase();
  const currency = request.currency ?? DEFAULT_CURRENCY;

  if (!provider || !env.PAYMENT_GATEWAY_SECRET_KEY || !request.destination) {
    logger.warn('paymentGateway: mock payout — no provider/key/destination configured', {
      reference: request.reference,
      amount: request.amount,
    });
    return {
      success: true,
      gatewayReference: `mock_payout_${crypto.randomUUID()}`,
      amount: request.amount,
      currency,
      provider: provider || 'mock',
      status: 'paid',
      placeholder: true,
    };
  }

  try {
    if (provider !== 'stripe') {
      logger.warn(`Payouts not implemented for provider '${provider}'`);
      throw new Error(`Payouts not implemented for '${provider}'`);
    }

    const form = new URLSearchParams({
      amount: String(Math.round(request.amount * 100)),
      currency: currency.toLowerCase(),
      destination: request.destination,
      'metadata[reference]': request.reference,
    });
    if (request.description) form.set('description', request.description);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch('https://api.stripe.com/v1/transfers', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.PAYMENT_GATEWAY_SECRET_KEY}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          // Stops a retried withdrawal from paying the driver twice.
          'Idempotency-Key': `abl_payout_${request.reference}`,
        },
        body: form,
        signal: controller.signal,
      });

      const transfer = (await res.json()) as {
        id?: string;
        amount?: number;
        currency?: string;
        error?: { message: string };
      };

      if (!res.ok) throw new Error(transfer.error?.message ?? `${res.status} ${res.statusText}`);

      return {
        success: true,
        gatewayReference: transfer.id ?? '',
        amount: (transfer.amount ?? 0) / 100,
        currency: (transfer.currency ?? currency).toUpperCase(),
        provider: 'stripe',
        status: 'paid',
        placeholder: false,
      };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    logger.error(`Payout failed for ${request.reference}`, err);
    return {
      success: false,
      gatewayReference: '',
      amount: request.amount,
      currency,
      provider,
      status: 'failed',
      placeholder: false,
    };
  }
}

/* ------------------------------ webhook security -------------------------- */

/**
 * Verifies a webhook came from the gateway.
 *
 * `rawBody` MUST be the exact bytes received — app.ts captures them before JSON parsing,
 * because re-serialising the parsed object changes key order and whitespace and the
 * signature then never matches.
 *
 * Stripe signs `${timestamp}.${payload}` with HMAC-SHA256 and sends
 * `t=<ts>,v1=<sig>`. Unknown providers fall back to a plain HMAC of the body.
 * The check is always enforced — an unsigned request is rejected either way.
 */
export function verifyWebhookSignature(rawBody: string, signature: string | undefined): boolean {
  const secret = env.PAYMENT_GATEWAY_WEBHOOK_SECRET;

  if (!secret) {
    logger.error('Payment webhook rejected — PAYMENT_GATEWAY_WEBHOOK_SECRET is not configured');
    return false;
  }
  if (!signature) return false;

  const provider = (env.PAYMENT_GATEWAY_PROVIDER || '').toLowerCase();
  return provider === 'stripe'
    ? verifyStripeSignature(rawBody, signature, secret)
    : timingSafeEquals(signature, crypto.createHmac('sha256', secret).update(rawBody).digest('hex'));
}

/** Rejects replays older than this even when the signature itself is valid. */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

function verifyStripeSignature(rawBody: string, header: string, secret: string): boolean {
  const parts = Object.fromEntries(
    header.split(',').map((kv) => {
      const [k, ...rest] = kv.split('=');
      return [k.trim(), rest.join('=').trim()];
    }),
  );

  const timestamp = parts.t;
  const provided = parts.v1;
  if (!timestamp || !provided) return false;

  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > WEBHOOK_TOLERANCE_SECONDS) {
    logger.warn('Payment webhook rejected — signature timestamp outside tolerance');
    return false;
  }

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');

  return timingSafeEquals(provided, expected);
}

function timingSafeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // Length check first — timingSafeEqual throws on a length mismatch.
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/* ----------------------------------- mock --------------------------------- */

function mockCharge(request: ChargeRequest, currency: string, provider: string): ChargeResult {
  logger.warn('paymentGateway: mock charge — no provider/key configured, no money moved', {
    reference: request.reference,
    amount: request.amount,
    provider,
  });

  return {
    success: true,
    gatewayReference: `mock_${crypto.randomUUID()}`,
    amount: request.amount,
    currency,
    provider: provider || 'mock',
    status: 'succeeded',
    placeholder: true,
  };
}

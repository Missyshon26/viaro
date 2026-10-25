import crypto from 'node:crypto';
import { isProduction } from '../config/env';
import { env } from '../config/env';
import { logger } from '../utils/logger';

/**
 * SMS / push delivery (spec §4.8), called from notifications.service.send().
 *
 * SMS_PUSH_PROVIDER selects the adapter:
 *   twilio   — SMS via the Twilio REST API (needs TWILIO_ACCOUNT_SID + TWILIO_FROM_NUMBER)
 *   firebase — push via FCM HTTP v1 (needs FCM_PROJECT_ID + a service account, see below)
 *   expo     — push via Expo, if the mobile app is built with Expo
 * With nothing configured it logs what would have been sent, so local runs stay quiet
 * and free.
 */
export interface DeliveryMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  /** Device push token — required by the push providers, ignored by SMS. */
  deviceToken?: string;
}

export interface DeliveryResult {
  delivered: boolean;
  provider: string;
  reference?: string;
  placeholder: boolean;
  error?: string;
}

const REQUEST_TIMEOUT_MS = 10_000;

export async function sendSmsOrPush(message: DeliveryMessage): Promise<DeliveryResult> {
  const provider = (env.SMS_PUSH_PROVIDER || '').toLowerCase();

  if (!provider || !env.SMS_PUSH_API_KEY) return logOnly(message, provider || 'mock');

  try {
    switch (provider) {
      case 'twilio':
        return await sendTwilio(message);
      case 'firebase':
      case 'fcm':
        return await sendFcm(message);
      case 'expo':
        return await sendExpo(message);
      default:
        logger.warn(`Unknown SMS_PUSH_PROVIDER '${provider}' — nothing sent`);
        return logOnly(message, provider);
    }
  } catch (err) {
    // Delivery is best-effort: the notification is already persisted and on the socket.
    logger.warn(`Notification delivery failed via ${provider}`, err);
    return {
      delivered: false,
      provider,
      placeholder: false,
      error: err instanceof Error ? err.message : 'unknown error',
    };
  }
}

/* ----------------------------------- twilio ------------------------------- */

async function sendTwilio(message: DeliveryMessage): Promise<DeliveryResult> {
  const accountSid = env.TWILIO_ACCOUNT_SID;
  const from = env.TWILIO_FROM_NUMBER;

  if (!accountSid || !from) {
    throw new Error('TWILIO_ACCOUNT_SID and TWILIO_FROM_NUMBER are required for the twilio provider');
  }

  const form = new URLSearchParams({
    To: message.to,
    From: from,
    Body: `${message.title}\n${message.body}`.slice(0, 1600),
  });

  const auth = Buffer.from(`${accountSid}:${env.SMS_PUSH_API_KEY}`).toString('base64');

  const body = (await postJson(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    form,
    { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
  )) as { sid?: string; message?: string };

  return { delivered: true, provider: 'twilio', reference: body.sid, placeholder: false };
}

/* ------------------------------------ fcm --------------------------------- */

/**
 * FCM HTTP v1 needs a short-lived OAuth token minted from a service-account key, not a
 * static API key. Set FCM_PROJECT_ID and FCM_ACCESS_TOKEN (from your token-minting job),
 * or swap in google-auth-library here if you would rather this process mint it.
 */
async function sendFcm(message: DeliveryMessage): Promise<DeliveryResult> {
  const projectId = env.FCM_PROJECT_ID;
  if (!projectId) throw new Error('FCM_PROJECT_ID is required for the firebase provider');
  if (!message.deviceToken) throw new Error('deviceToken is required for push delivery');

  const payload = {
    message: {
      token: message.deviceToken,
      notification: { title: message.title, body: message.body },
      data: stringifyValues(message.data ?? {}),
    },
  };

  const body = (await postJson(
    `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
    JSON.stringify(payload),
    {
      Authorization: `Bearer ${env.FCM_ACCESS_TOKEN ?? env.SMS_PUSH_API_KEY}`,
      'Content-Type': 'application/json',
    },
  )) as { name?: string };

  return { delivered: true, provider: 'firebase', reference: body.name, placeholder: false };
}

/* ----------------------------------- expo --------------------------------- */

async function sendExpo(message: DeliveryMessage): Promise<DeliveryResult> {
  if (!message.deviceToken) throw new Error('deviceToken is required for push delivery');

  const body = (await postJson(
    'https://exp.host/--/api/v2/push/send',
    JSON.stringify({
      to: message.deviceToken,
      title: message.title,
      body: message.body,
      data: message.data ?? {},
    }),
    { Authorization: `Bearer ${env.SMS_PUSH_API_KEY}`, 'Content-Type': 'application/json' },
  )) as { data?: { id?: string } };

  return { delivered: true, provider: 'expo', reference: body.data?.id, placeholder: false };
}

/* ---------------------------------- shared -------------------------------- */

async function postJson(
  url: string,
  body: string | URLSearchParams,
  headers: Record<string, string>,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, { method: 'POST', headers, body, signal: controller.signal });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new Error(String(json.message ?? json.error ?? `${res.status} ${res.statusText}`));
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

/** FCM data payloads must be flat string maps. */
function stringifyValues(data: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]),
  );
}

function logOnly(message: DeliveryMessage, provider: string): DeliveryResult {
  /*
   * The body carries OTPs. It is printed only outside production.
   *
   * With no SMS provider configured the fallback wrote the whole message to the
   * application log — and the shipped .env.example leaves the provider blank, so a
   * deployment that never wired one up was logging every one-time code in plaintext to
   * wherever its logs are shipped. Locally the code on stdout is the point; in production
   * it is a credential in a log aggregator.
   */
  logger.info('smsPush: no provider configured — message not delivered', {
    to: message.to,
    title: message.title,
    ...(isProduction ? { body: '[redacted]' } : { body: message.body }),
  });
  return { delivered: false, provider, reference: `local_${crypto.randomUUID()}`, placeholder: true };
}

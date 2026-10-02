import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ quiet: true });

/**
 * Single source of truth for environment configuration.
 * Nothing else in the codebase should read `process.env` directly — import `env` from here.
 *
 * Keys marked PLACEHOLDER stay optional on purpose: the provider for flights, payments,
 * SMS/push and S3 is not chosen yet (spec §10), so the app must boot without them.
 */
const envSchema = z.object({
  /**
   * Deliberately NOT defaulted.
   *
   * It used to fall back to 'development', so a deployment that simply forgot to set it
   * ran with development semantics in production — stack traces and absolute file paths
   * in every 500 response, and a permissive CORS policy. Failing to boot is a far better
   * outcome than silently serving internals, and the value is trivial to supply.
   */
  NODE_ENV: z.enum(['development', 'test', 'production'], {
    message: "NODE_ENV must be set explicitly to 'development', 'test' or 'production'",
  }),
  PORT: z.coerce.number().int().positive().default(5000),

  MONGO_URI: z.string().min(1, 'MONGO_URI is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  JWT_ACCESS_SECRET: z.string().min(1, 'JWT_ACCESS_SECRET is required'),
  JWT_REFRESH_SECRET: z.string().min(1, 'JWT_REFRESH_SECRET is required'),

  // Flight data: aviationstack | flightaware. Empty = mock data.
  FLIGHT_API_PROVIDER: z.string().optional(),
  FLIGHT_API_KEY: z.string().optional(),

  // Payment gateway: stripe. Empty = mock charges, no money moves.
  PAYMENT_GATEWAY_PROVIDER: z.string().optional(),
  PAYMENT_GATEWAY_SECRET_KEY: z.string().optional(),
  PAYMENT_GATEWAY_WEBHOOK_SECRET: z.string().optional(),

  // SMS/push delivery: twilio | firebase | expo. Empty = log only, nothing sent.
  SMS_PUSH_PROVIDER: z.string().optional(),
  /** Twilio auth token, FCM/Expo access token — whichever the provider needs. */
  SMS_PUSH_API_KEY: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),
  FCM_PROJECT_ID: z.string().optional(),
  FCM_ACCESS_TOKEN: z.string().optional(),

  // Transactional email (password resets, support alerts): 'resend' or 'smtp'.
  // Empty = log only.
  EMAIL_PROVIDER: z.string().optional(),
  EMAIL_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_SECURE: z.enum(['true', 'false']).optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  /** Where the password-reset link points (the frontend). See appWebUrl below. */
  APP_WEB_URL: z.string().optional(),

  // PLACEHOLDER — driver document storage
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),

  // Timezone, token lifetimes: config/constants.ts. Payout, revenue split, withdrawal
  // fee and the support inbox: admin console (modules/admin/settings.service.ts).

  CORS_ORIGIN: z.string().default('*'),

  /**
   * Rate limits. Defaults are the production posture; raise AUTH_RATE_LIMIT_MAX locally
   * when running the Postman/Newman collection repeatedly, which otherwise trips the
   * login limiter within 15 minutes.
   */
  API_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
  AUTH_RATE_LIMIT_WINDOW_MIN: z.coerce.number().int().positive().default(15),
});

export type Env = z.infer<typeof envSchema>;

const parsed = envSchema
  .safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  // Fail fast and loudly — a half-configured process is worse than no process.
  console.error(`Invalid environment configuration:\n${details}\n\nCopy .env.example to .env and fill it in.`);
  process.exit(1);
}

export const env: Env = parsed.data;

export const isProduction = env.NODE_ENV === 'production';

/**
 * Base URL of the passenger site, for links in emails.
 *
 * It used to default to http://localhost:3000 everywhere, so a production server without
 * APP_WEB_URL emailed reset links to localhost — which opens nothing on a customer's
 * phone. Production now falls back to the hosted site instead; set APP_WEB_URL to move it.
 */
export const appWebUrl = (
  env.APP_WEB_URL || (isProduction ? 'https://viaro-frontend.vercel.app' : 'http://localhost:3000')
).replace(/\/+$/, '');

/**
 * CORS policy, derived once and shared by the HTTP app and the socket server.
 *
 * `CORS_ORIGIN='*'` used to become `origin: true`, which reflects the caller's own Origin
 * header back — and paired with `credentials: true` that is an allow-any-site-with-
 * credentials policy, exactly what the same-origin policy exists to prevent. Bearer
 * tokens limit the damage today, but the refresh cookie the consoles use is precisely the
 * kind of credential this would expose.
 *
 * A wildcard is therefore refused outright in production, and everywhere else it is
 * honoured only WITHOUT credentials — the combination the CORS spec itself forbids.
 */
export function corsOptions(): { origin: true | string[]; credentials: boolean } {
  const wildcard = env.CORS_ORIGIN.trim() === '*';

  if (wildcard && env.NODE_ENV === 'production') {
    throw new Error(
      "CORS_ORIGIN must list explicit origins in production — '*' with credentials is unsafe",
    );
  }

  if (wildcard) return { origin: true, credentials: false };

  return {
    origin: env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean),
    credentials: true,
  };
}
export const isTest = env.NODE_ENV === 'test';

/**
 * Fixed business facts, kept in code rather than .env.
 *
 * .env is for what differs between environments or must stay secret (connection strings,
 * keys, ports, URLs). These are the same everywhere; changing one is a product decision
 * that should go through review and a deploy, not an edit on the server.
 *
 * Values operations change day to day (payout, revenue split, withdrawal fee, support
 * inbox) are not here either — they are edited in the admin console
 * (modules/admin/settings.service.ts).
 */

/** Every pickup, peak window, report month and cron runs in Pacific time (Seattle). */
export const APP_TIMEZONE = 'America/Los_Angeles';

/** Access token lifetime. Short: it cannot be revoked before it expires on its own. */
export const ACCESS_TOKEN_TTL = '15m';

/** Refresh token lifetime — how long a device stays signed in without a password. */
export const REFRESH_TOKEN_TTL = '30d';

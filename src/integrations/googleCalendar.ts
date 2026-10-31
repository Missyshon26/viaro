import { JWT } from 'google-auth-library';
import { env } from '../config/env';
import { logger } from '../utils/logger';

/**
 * A thin client for the Google Calendar events API, signed in as a service account.
 *
 * A service account is a robot with no password and no login token to expire, so the sync
 * keeps working until someone removes its access. By default it can only touch a calendar
 * shared with it. With GOOGLE_CALENDAR_IMPERSONATE (domain-wide delegation, authorised once by a
 * Workspace admin) it instead acts as that user and writes straight into their own calendar.
 * Either way events carry no guest list: people see them by having the calendar.
 *
 * Everything the sync needs is the `CalendarApi` interface below, so tests (and any future
 * provider) can stand in for Google without touching the sync logic.
 */
export interface CalendarEventBody {
  summary: string;
  location?: string;
  description: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  colorId?: string;
  reminders: { useDefault: false; overrides: { method: 'popup'; minutes: number }[] };
  /** Our own bookkeeping on the event, invisible to people looking at it. */
  extendedProperties?: { private: Record<string, string> };
  status?: 'confirmed' | 'cancelled';
}

export interface CalendarEventResult {
  id: string;
  htmlLink?: string;
}

/** Raised for any non-2xx from Google, carrying the status so callers can branch on it. */
export class CalendarError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface CalendarApi {
  /** Creates the event with this id. Rejects with status 409 when the id is already taken. */
  insert(id: string, body: CalendarEventBody): Promise<CalendarEventResult>;
  /** Changes an existing event. Rejects with 404 or 410 when it is gone. */
  patch(id: string, body: Partial<CalendarEventBody>): Promise<CalendarEventResult>;
  /** Removes the event. Resolves quietly when it is already gone. */
  remove(id: string): Promise<void>;
  /** Proves the calendar is reachable and shared with us; returns its name. */
  check(): Promise<{ name: string }>;
}

const BASE = 'https://www.googleapis.com/calendar/v3';
const SCOPE = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly';

interface Credentials {
  client_email: string;
  private_key: string;
}

/** Reads the service account key from the environment; null (with a reason) if unusable. */
export function readCredentials(raw: string | undefined): { ok: true; value: Credentials } | { ok: false; reason: string } {
  if (!raw?.trim()) return { ok: false, reason: 'GOOGLE_SERVICE_ACCOUNT_JSON is not set' };
  let parsed: Partial<Credentials>;
  try {
    parsed = JSON.parse(raw) as Partial<Credentials>;
  } catch {
    return { ok: false, reason: 'GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON' };
  }
  if (!parsed.client_email || !parsed.private_key) {
    return { ok: false, reason: 'GOOGLE_SERVICE_ACCOUNT_JSON has no client_email or private_key' };
  }
  return {
    ok: true,
    // A key pasted into an .env file often arrives with literal "\n" instead of line breaks.
    value: { client_email: parsed.client_email, private_key: parsed.private_key.replace(/\\n/g, '\n') },
  };
}

function googleApi(calendarId: string, credentials: Credentials, actAs?: string): CalendarApi {
  const auth = new JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: SCOPE.split(' '),
    // Domain-wide delegation: sign in as this user, not as the robot.
    ...(actAs ? { subject: actAs } : {}),
  });
  const events = `${BASE}/calendars/${encodeURIComponent(calendarId)}/events`;

  async function call<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, data?: unknown): Promise<T> {
    try {
      const res = await auth.request<T>({ url, method, data, params: method === 'GET' ? undefined : { sendUpdates: 'none' }, timeout: 15_000 });
      return res.data;
    } catch (err) {
      const e = err as { response?: { status?: number; data?: { error?: { message?: string } } }; message?: string };
      const status = e.response?.status ?? 0;
      const reason = e.response?.data?.error?.message ?? e.message ?? 'Google Calendar request failed';
      throw new CalendarError(reason, status);
    }
  }

  return {
    insert: (id, body) => call<CalendarEventResult>('POST', events, { ...body, id }),
    patch: (id, body) => call<CalendarEventResult>('PATCH', `${events}/${encodeURIComponent(id)}`, body),
    async remove(id) {
      try {
        await call<void>('DELETE', `${events}/${encodeURIComponent(id)}`);
      } catch (err) {
        if (err instanceof CalendarError && (err.status === 404 || err.status === 410)) return;
        throw err;
      }
    },
    async check() {
      const cal = await call<{ summary?: string }>('GET', `${BASE}/calendars/${encodeURIComponent(calendarId)}`);
      return { name: cal.summary ?? calendarId };
    },
  };
}

let override: CalendarApi | null = null;
let cached: { key: string; api: CalendarApi | null } | null = null;

/** For tests: use this in place of Google. Pass null to go back to the real one. */
export function setCalendarApi(api: CalendarApi | null): void {
  override = api;
}

/** Whether the calendar sync is configured (a stand-in counts, for tests). */
export function isCalendarEnabled(): boolean {
  return Boolean(override) || Boolean(getCalendarApi());
}

export function getCalendarApi(): CalendarApi | null {
  if (override) return override;
  const id = env.GOOGLE_CALENDAR_ID?.trim();
  if (!id) return null;

  const actAs = env.GOOGLE_CALENDAR_IMPERSONATE?.trim() || undefined;
  const key = `${id}|${actAs ?? ''}|${env.GOOGLE_SERVICE_ACCOUNT_JSON ?? ''}`;
  if (cached?.key === key) return cached.api;

  const creds = readCredentials(env.GOOGLE_SERVICE_ACCOUNT_JSON);
  if (!creds.ok) {
    logger.error(`Calendar sync is off: ${creds.reason}`);
    cached = { key, api: null };
    return null;
  }
  cached = { key, api: googleApi(id, creds.value, actAs) };
  return cached.api;
}

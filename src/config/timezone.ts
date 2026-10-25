import { DateTime } from 'luxon';
import { APP_TIMEZONE } from './constants';

/**
 * Shared timezone helper — spec §8 rule 1.
 *
 * EVERY business-rule time comparison (booking scheduling, cancellation windows,
 * refund thresholds, peak-hour pricing, report date filters, notification payloads)
 * must go through this module. No other file may call `new Date()` for business logic
 * or format a date ad hoc.
 *
 * Storage stays UTC (Mongo stores Date as UTC); this module is the interpretation and
 * display layer fixed to APP_TIMEZONE (America/Los_Angeles).
 */

export { APP_TIMEZONE };

export type DateInput = Date | string | number | DateTime;

/** Default display format, e.g. "2026-08-04 14:30 PDT". */
export const DISPLAY_FORMAT = "yyyy-LL-dd HH:mm ZZZZ";

/** Current moment in app time. Use this instead of `new Date()`. */
export function now(): DateTime {
  return DateTime.now().setZone(APP_TIMEZONE);
}

/** Current moment as a JS Date, for writing to Mongo. */
export function nowDate(): Date {
  return now().toJSDate();
}

/**
 * Convert any supported input into a DateTime pinned to APP_TIMEZONE.
 *
 * Offset-less ISO strings (e.g. "2026-08-10T14:00") are read as local wall time in
 * APP_TIMEZONE — that is what a customer picking "2pm" means. Strings carrying an
 * offset keep their instant and are converted into APP_TIMEZONE.
 */
export function toAppTime(value: DateInput): DateTime {
  let dt: DateTime;

  if (DateTime.isDateTime(value)) {
    dt = value;
  } else if (value instanceof Date) {
    dt = DateTime.fromJSDate(value);
  } else if (typeof value === 'number') {
    dt = DateTime.fromMillis(value);
  } else {
    dt = DateTime.fromISO(value, { zone: APP_TIMEZONE });
  }

  if (!dt.isValid) {
    throw new Error(`Invalid date input: ${String(value)} (${dt.invalidReason ?? 'unknown reason'})`);
  }

  return dt.setZone(APP_TIMEZONE);
}

/** Parse a non-ISO string using an explicit luxon format, interpreted in APP_TIMEZONE. */
export function parseInAppZone(value: string, format: string): DateTime {
  const dt = DateTime.fromFormat(value, format, { zone: APP_TIMEZONE });
  if (!dt.isValid) {
    throw new Error(`Could not parse "${value}" with format "${format}": ${dt.invalidReason}`);
  }
  return dt;
}

/** Normalise any input to a JS Date for persistence. */
export function toDate(value: DateInput): Date {
  return toAppTime(value).toJSDate();
}

/** ISO string carrying the APP_TIMEZONE offset. */
export function toISO(value: DateInput): string {
  return toAppTime(value).toISO() as string;
}

/** Human-readable rendering in APP_TIMEZONE — the only date formatter for API/notification payloads. */
export function format(value: DateInput, fmt: string = DISPLAY_FORMAT): string {
  return toAppTime(value).toFormat(fmt);
}

/** Fractional hours from `from` to `to` (negative when `to` is in the past relative to `from`). */
export function hoursBetween(from: DateInput, to: DateInput): number {
  return toAppTime(to).diff(toAppTime(from), 'hours').hours;
}

/** Fractional hours from now until `value`. Drives the cancellation/refund thresholds. */
export function hoursUntil(value: DateInput): number {
  return hoursBetween(now(), value);
}

/** Hour of day (0–23) in APP_TIMEZONE — used by peak-hour pricing. */
export function hourOfDay(value: DateInput): number {
  return toAppTime(value).hour;
}

export function startOfDay(value: DateInput): DateTime {
  return toAppTime(value).startOf('day');
}

export function endOfDay(value: DateInput): DateTime {
  return toAppTime(value).endOf('day');
}

export function isBefore(a: DateInput, b: DateInput): boolean {
  return toAppTime(a) < toAppTime(b);
}

export function isAfter(a: DateInput, b: DateInput): boolean {
  return toAppTime(a) > toAppTime(b);
}

/* -------------------------------------------------------------------------- */
/* Validation helpers                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Is this string something `toAppTime` can actually parse?
 *
 * `toAppTime` throws a bare Error on rubbish input, which the error handler could only
 * report as a 500 — so `?requestedAt=notadate` looked like a server fault instead of the
 * bad request it is, and the same input queued a report job that retried three times
 * before failing. Schemas call this so the rejection happens at the edge, as a 400.
 */
export function isParsableDate(value: string): boolean {
  return DateTime.fromISO(value, { zone: APP_TIMEZONE }).isValid;
}

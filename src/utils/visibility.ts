import type { UserRole } from './roles';

/**
 * Who is allowed to see what, in one place.
 *
 * Spec §8 states these as rules about roles, not about endpoints — but they were being
 * re-implemented per endpoint (trip.service.ts shaped a trip; reports.service.ts wrote
 * its own inline ternary for the same field). Two copies of a rule is one copy too many:
 * the third endpoint to return a fare is the one that forgets.
 *
 * Every response that carries one of these fields must go through the predicates here.
 * `tests/authorization.spec.ts` asserts them at the HTTP boundary, so a new endpoint
 * that bypasses this module fails the suite rather than leaking quietly.
 */

/** Spec §8 rule 2 — a driver never learns what the passenger paid, only their payout. */
export function canSeeTripFare(role: UserRole): boolean {
  return role !== 'driver';
}

/** Spec §8 rule 4 — a customer never gets the chauffeur's real number. */
export function canSeeDriverPhone(role: UserRole): boolean {
  return role !== 'customer';
}

export const MASKED_PHONE = 'Contact via app';

/** The trip fields a driver must never receive, named once. */
export const DRIVER_HIDDEN_TRIP_FIELDS = ['fareAmount', 'taxAmount', 'creditApplied'] as const;

/**
 * Drops the money fields unless the role may see them.
 *
 * Takes and returns a loose record deliberately: these objects are mongoose `.lean()`
 * results, which are not typed strongly enough for a conditional return type to be
 * worth the refactor. The guarantee comes from routing every call site through here
 * plus the HTTP-level tests, not from the type system.
 */
export function stripFareIfHidden<T extends Record<string, unknown>>(
  doc: T,
  role: UserRole,
): T {
  if (canSeeTripFare(role)) return doc;

  const out = { ...doc };
  for (const field of DRIVER_HIDDEN_TRIP_FIELDS) {
    delete out[field];
  }
  return out;
}

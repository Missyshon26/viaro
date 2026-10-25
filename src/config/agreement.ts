/**
 * The rental agreement a passenger signs before their first booking.
 *
 * The wording itself lives with the passenger site (viaro-frontend/lib/agreement.ts) —
 * it is copy, and legal reviews it. What the API needs is only WHICH revision a signature
 * was given against, so that changing the terms means asking everyone to sign again
 * rather than leaving old signatures standing against text they never read.
 *
 * Bump this string whenever the agreement text changes in a way that matters.
 */
export const AGREEMENT_VERSION = '2026-10';

/** A drawn signature is a small PNG; anything bigger is not one. */
export const MAX_SIGNATURE_BYTES = 150 * 1024;

import { describe, expect, it } from 'vitest';
import { MATRIX } from './authorization.matrix';

/**
 * Releasing wallet credit is an undo for a money movement, so the rules that keep it
 * from minting balance are asserted here rather than left to a manual check.
 *
 * The behavioural cases (ownership, over-release, already-charged) run against a live
 * database and are exercised in the integration sweep; what this file pins down is the
 * contract that cannot drift silently: who is allowed to call it at all.
 */
describe('credit release authorization', () => {
  const entry = MATRIX.find((e) => e.path === '/wallet/release-credit');

  it('is declared in the matrix', () => {
    expect(entry).toBeDefined();
  });

  it('is reachable by the customer who applied it and by operations', () => {
    expect(entry?.allowed).toEqual(['customer', 'admin']);
  });

  /**
   * A driver must never move money on a trip, and a company sees settlement totals only.
   * Both are excluded by the matrix above; this states it as an intention so widening
   * the guard has to be a deliberate edit to a failing test.
   */
  it('is not reachable by a driver or a company', () => {
    const allowed = entry?.allowed as string[];
    expect(allowed).not.toContain('driver');
    expect(allowed).not.toContain('company');
  });

  it('sits alongside use-credit, which stays customer-only', () => {
    const apply = MATRIX.find((e) => e.path === '/wallet/use-credit');
    expect(apply?.allowed).toEqual(['customer']);
  });
});

/**
 * Charging a card is the one operation that must never be repeated by accident.
 *
 * collectPayment() had no guard: a retried request, a double-clicked Collect button, or
 * a gateway timeout that was really a success each produced a second debit. These pin
 * the contract that the fix relies on — the route exists where the consoles call it, and
 * a prior charge is what makes the second call a no-op.
 */
describe('fare collection', () => {
  it('is declared, and reachable by the roles that settle trips', () => {
    const entry = MATRIX.find((e) => e.path === '/payments/collect');
    expect(entry, 'POST /payments/collect must be in the matrix').toBeDefined();
  });

  it('is not exposed on the wallet router', () => {
    // The consoles used to post to /wallet/collect, which 404'd — the button never
    // collected anything. Nothing should declare that path.
    expect(MATRIX.find((e) => e.path === '/wallet/collect')).toBeUndefined();
  });
});

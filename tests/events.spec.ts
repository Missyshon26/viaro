import { describe, expect, it, vi } from 'vitest';
import { isAddressedTo, publish, subscribe, type ChangeEvent } from '../src/modules/events/events.bus';

/**
 * Who hears about a change.
 *
 * This is an authorization boundary as much as authorization.spec.ts is. The stream
 * carries no domain data, but "booking 68f… changed" told to the wrong operator is still
 * a leak of which bookings exist and when they move, so the addressing rules are
 * asserted rather than assumed.
 */

const CUSTOMER = { userId: 'cust-1', role: 'customer' as const };
const OTHER_CUSTOMER = { userId: 'cust-2', role: 'customer' as const };
const DRIVER = { userId: 'drv-1', role: 'driver' as const };
const ADMIN = { userId: 'adm-1', role: 'admin' as const };
const COMPANY = { userId: 'co-1', role: 'company' as const };

const event = (over: Partial<ChangeEvent>): ChangeEvent => ({
  topic: 'booking',
  action: 'created',
  at: new Date().toISOString(),
  ...over,
});

describe('change event addressing', () => {
  it('reaches a role named in the event', () => {
    const e = event({ roles: ['admin', 'company'] });
    expect(isAddressedTo(e, ADMIN)).toBe(true);
    expect(isAddressedTo(e, COMPANY)).toBe(true);
  });

  it('does not reach a role that was not named', () => {
    const e = event({ roles: ['admin', 'company'] });
    expect(isAddressedTo(e, DRIVER)).toBe(false);
    expect(isAddressedTo(e, CUSTOMER)).toBe(false);
  });

  it('reaches a user addressed by id even when their role was not named', () => {
    const e = event({ roles: ['admin'], userIds: ['cust-1'] });
    expect(isAddressedTo(e, CUSTOMER)).toBe(true);
  });

  it('does not reach a different user of the same role', () => {
    const e = event({ roles: ['admin'], userIds: ['cust-1'] });
    expect(isAddressedTo(e, OTHER_CUSTOMER)).toBe(false);
  });

  it('reaches nobody when the event names no audience', () => {
    const e = event({});
    for (const viewer of [CUSTOMER, DRIVER, ADMIN, COMPANY]) {
      expect(isAddressedTo(e, viewer)).toBe(false);
    }
  });
});

describe('publishing', () => {
  it('delivers to a subscriber and stops after unsubscribing', () => {
    const heard: ChangeEvent[] = [];
    const stop = subscribe((e) => heard.push(e));

    publish({ topic: 'trip', action: 'started', id: 't1', roles: ['admin'] });
    expect(heard).toHaveLength(1);
    expect(heard[0]).toMatchObject({ topic: 'trip', action: 'started', id: 't1' });
    expect(heard[0]?.at).toEqual(expect.any(String));

    stop();
    publish({ topic: 'trip', action: 'completed', id: 't1', roles: ['admin'] });
    expect(heard).toHaveLength(1);
  });

  it('drops an event with no audience rather than broadcasting it', () => {
    const heard: ChangeEvent[] = [];
    const stop = subscribe((e) => heard.push(e));

    publish({ topic: 'booking', action: 'created', id: 'b1' });

    expect(heard).toHaveLength(0);
    stop();
  });

  /**
   * The write is the thing the caller asked for; telling other screens about it is not.
   * A throwing subscriber must not turn a successful booking into a failed request.
   */
  it('does not let a failing subscriber propagate to the publisher', () => {
    const stop = subscribe(() => {
      throw new Error('subscriber blew up');
    });

    expect(() => publish({ topic: 'booking', action: 'created', roles: ['admin'] })).not.toThrow();
    stop();
  });

  /**
   * EventEmitter calls listeners in order and stops at the first throw. Without
   * per-listener isolation, one wedged stream would silence every operator who
   * connected after it — a failure nobody would ever notice.
   */
  it('still delivers to the other subscribers when one throws', () => {
    const heard: string[] = [];
    const stopBad = subscribe(() => {
      throw new Error('subscriber blew up');
    });
    const stopGood = subscribe((e) => heard.push(e.action));

    publish({ topic: 'trip', action: 'started', roles: ['admin'] });

    expect(heard).toEqual(['started']);
    stopBad();
    stopGood();
  });
});

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The two Critical money bugs in this service were both races, and both were invisible to
 * a suite that only ever issues one request at a time.
 *
 * Five parallel POSTs to /trips/:id/complete each read `status === 'started'` before any
 * of them wrote, so all five passed the check and all five settled the fare — a $100 trip
 * paid out four times. The same shape appeared in /payments/collect (two charges), in
 * accept (credit spent repeatedly), and in wallet creation (a duplicate-key error that
 * silently killed one settlement).
 *
 * These are not integration tests: the suite is deliberately hermetic (see setup.ts), so
 * spinning up Mongo to interleave writes is out of scope here. What they pin instead is
 * the property that actually makes those races impossible — that each of these paths
 * commits its state change with ONE conditional database operation rather than a read
 * followed by a write. A refactor back to `findById` + mutate + `save()` reintroduces the
 * bug, and reads as a passing diff to review; it fails here.
 */

const SRC = path.resolve(__dirname, '..', 'src');
const read = (relative: string): string => fs.readFileSync(path.join(SRC, relative), 'utf8');

/** The body of a single exported function, for assertions scoped to one code path. */
function functionBody(source: string, signature: string): string {
  const start = source.indexOf(signature);
  if (start === -1) throw new Error(`Could not find '${signature}'`);

  // Walk braces from the first '{' after the signature to its match.
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error(`Unbalanced braces after '${signature}'`);
}

describe('trip completion is claimed atomically', () => {
  const body = functionBody(read('modules/trip/trip.service.ts'), 'export async function completeTrip');

  it('moves the trip out of started with a single conditional update', () => {
    expect(body).toContain('findOneAndUpdate');
    // The filter must carry the precondition, otherwise the update is unconditional.
    expect(body).toMatch(/status:\s*'started'/);
  });

  it('treats a lost race as a conflict rather than settling again', () => {
    expect(body).toMatch(/if\s*\(!trip\)/);
    expect(body).toContain('ApiError.conflict');
  });

  it('does not fall back to read-modify-write on status', () => {
    expect(body).not.toMatch(/trip\.status\s*=\s*'completed'/);
  });
});

describe('revenue settlement is claimed before any money moves', () => {
  const source = read('modules/wallet/wallet.service.ts');
  const body = functionBody(source, 'export async function applyRevenueSplit');

  it('claims the settled flag with a conditional update', () => {
    expect(body).toContain('findOneAndUpdate');
    expect(body).toMatch(/settled:\s*\{\s*\$ne:\s*true\s*\}/);
  });

  it('releases the claim if settlement then fails, so it stays re-runnable', () => {
    expect(body).toMatch(/settled:\s*false/);
  });

  /**
   * The old code set `trip.settled = true` only after crediting every wallet, which is
   * exactly the window the concurrent completions drove through.
   */
  it('never sets settled after the credits instead of before', () => {
    const settle = functionBody(source, 'async function settleClaimedTrip');
    expect(settle).not.toMatch(/trip\.settled\s*=\s*true/);
  });
});

describe('wallets are created by upsert, not find-then-create', () => {
  const source = read('modules/wallet/wallet.service.ts');

  it('getOrCreateWallet upserts', () => {
    const body = functionBody(source, 'export async function getOrCreateWallet');
    expect(body).toContain('upsert: true');
    expect(body).toContain('$setOnInsert');
    expect(body).not.toContain('Wallet.create(');
  });

  it('the contended platform wallet upserts too', () => {
    const body = functionBody(source, 'export async function getPlatformWallet');
    expect(body).toContain('upsert: true');
    expect(body).not.toContain('Wallet.create(');
  });
});

describe('a fare is charged at most once', () => {
  it('reserves the ledger row before calling the gateway', () => {
    const body = functionBody(
      read('modules/wallet/wallet.service.ts'),
      'export async function collectPayment',
    );

    const reservation = body.indexOf('Transaction.create');
    const gateway = body.indexOf('collectFromGateway');

    expect(reservation).toBeGreaterThan(-1);
    expect(gateway).toBeGreaterThan(-1);
    // Reserving after charging would leave the double-charge window wide open.
    expect(reservation).toBeLessThan(gateway);
  });

  it('turns the unique-index collision into an already-charged answer', () => {
    const body = functionBody(
      read('modules/wallet/wallet.service.ts'),
      'export async function collectPayment',
    );
    expect(body).toContain('11000');
    expect(body).toContain('alreadyCharged');
  });

  it('is backed by a unique index, which is what actually enforces it', () => {
    const model = read('models/Transaction.ts');
    expect(model).toContain('uniq_trip_payment_per_trip');
    expect(model).toContain('unique: true');
    expect(model).toMatch(/partialFilterExpression:\s*\{\s*'meta\.reason':\s*'trip_payment'\s*\}/);
  });
});

describe('accepting a booking spends its credit once', () => {
  const source = read('modules/trip/trip.service.ts');
  const body = functionBody(source, 'export async function acceptBooking');

  it('refuses a second accept on an already-accepted trip', () => {
    expect(body).toMatch(/timestamps\.accepted/);
    expect(body).toContain('already been accepted');
  });

  it('claims the acceptance atomically rather than re-stamping and saving', () => {
    expect(body).toContain('findOneAndUpdate');
    expect(body).not.toMatch(/existing\.timestamps\.accepted\s*=/);
  });

  /**
   * Second line of defence: accept is reachable from the pool, from favourite-driver
   * auto-assign and from admin dispatch, and none of those knew about the others.
   */
  it('applyRequestedCredit is itself idempotent per trip', () => {
    const credit = functionBody(
      read('modules/wallet/wallet.service.ts'),
      'export async function applyRequestedCredit',
    );
    expect(credit).toMatch(/'meta\.reason':\s*'ride_credit'/);
    expect(credit).toContain('alreadyApplied');
  });
});

describe('starting a trip is claimed atomically too', () => {
  const body = functionBody(read('modules/trip/trip.service.ts'), 'export async function startTrip');

  it('moves the trip out of accepted with a single conditional update', () => {
    expect(body).toContain('findOneAndUpdate');
    expect(body).toMatch(/status:\s*'accepted'/);
  });

  it('does not fall back to read-modify-write on status', () => {
    expect(body).not.toMatch(/trip\.status\s*=\s*'started'/);
  });
});

/**
 * Company scoping, asserted structurally.
 *
 * A company is not an admin, but several read paths treated it as one — the trip list and
 * single-trip read, the reports, live tracking, booking detail, and fare collection. Each
 * is a separate file, which is exactly how the rule got applied to some and forgotten on
 * others, so they are pinned together here.
 */
describe('a company is scoped to its own roster everywhere', () => {
  it('the trip list filters by the roster', () => {
    const source = read('modules/trip/trip.service.ts');
    // Asserted against the whole file: `functionBody` walks to the first balanced brace,
    // which for a function opening with an `if` is that branch rather than the body.
    expect(source).toMatch(/user\.role === 'company'/);
    expect(source).toContain('companyDriverIds');
  });

  it('reading one trip by id checks the roster', () => {
    const body = functionBody(
      read('modules/trip/trip.service.ts'),
      'export async function assertTripAccess',
    );
    expect(body).toMatch(/role === 'company'/);
    expect(body).toContain('companyOwnsDriver');
  });

  it('reports resolve a roster rather than an unrestricted scope', () => {
    const source = read('modules/reports/reports.service.ts');
    expect(source).toMatch(/user\.role === 'company'/);
    expect(source).toContain('companyDriverIds');
    // An empty roster must match nothing, not everything.
    expect(source).toContain('function driverFilter');
    // The old unconditional spread must be gone from every query in the file.
    expect(source).not.toMatch(/\.\.\.\(scope\.driverId \? \{ driverId: scope\.driverId \} : \{\}\)/);
  });

  it('company earnings are limited to the company wallet, not every wallet', () => {
    const body = functionBody(
      read('modules/reports/reports.service.ts'),
      'export async function earningsPayout',
    );
    expect(body).toMatch(/ownerType:\s*'company'/);
  });

  it('the live-tracking socket checks the roster', () => {
    expect(read('../src/sockets/tracking.socket.ts')).toContain('companyOwnsDriver');
  });

  it('booking detail checks the roster before exposing customer contact details', () => {
    const body = functionBody(
      read('modules/booking/booking.service.ts'),
      'export async function getBookingForUser',
    );
    expect(body).toMatch(/role === 'company'/);
    expect(body).toContain('companyOwnsDriver');
  });

  it('charging a fare checks the roster', () => {
    const body = functionBody(
      read('modules/wallet/wallet.service.ts'),
      'export async function collectPayment',
    );
    expect(body).toContain('companyOwnsDriver');
  });
});

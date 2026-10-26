import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickupDay, matchesTripFilters, emptyFilters } from '../src/lib/trips/filters.ts';

const booking = { scheduledAt: '2026-10-27T06:59:00Z', vehicleClass: 'sedan', tripType: 'airport', city: 'Seattle' };
test('pickup days respect Pacific midnight and daylight saving time', () => {
  assert.equal(pickupDay(booking.scheduledAt), '2026-10-26');
  assert.equal(pickupDay('2026-10-27T07:00:00Z'), '2026-10-27');
  assert.equal(pickupDay('2026-12-01T07:59:00Z'), '2026-11-30');
  assert.equal(pickupDay('2026-10-26T23:59:00'), '2026-10-26');
});
test('date boundaries are inclusive and combine with vehicle, city and service', () => {
  const filter = { ...emptyFilters, from: '2026-10-26', to: '2026-10-26', vehicle: 'sedan', city: 'Seattle', service: 'airport' };
  assert.equal(matchesTripFilters(booking, filter), true);
  assert.equal(matchesTripFilters(booking, { ...filter, vehicle: 'suv' }), false);
  assert.equal(matchesTripFilters(booking, { ...filter, from: '2026-10-27' }), false);
  assert.equal(matchesTripFilters(booking, { ...filter, city: 'Bellevue' }), false);
  assert.equal(matchesTripFilters(booking, { ...filter, service: 'hourly' }), false);
});
test('payment filters distinguish absent, paid and refunded card payments', () => {
  assert.equal(matchesTripFilters(booking, { ...emptyFilters, payment: 'unpaid' }), true);
  for (const status of ['paid', 'partially_refunded', 'refunded']) {
    const paid = { ...booking, payment: { status } };
    assert.equal(matchesTripFilters(paid, { ...emptyFilters, payment: status }), true);
    assert.equal(matchesTripFilters(paid, { ...emptyFilters, payment: 'unpaid' }), false);
  }
  assert.equal(matchesTripFilters(booking, { ...emptyFilters, payment: 'paid' }), false);
});

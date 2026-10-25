import { describe, expect, it } from 'vitest';
import { applyDetailChanges } from '../src/modules/booking/booking.details';
import { updateBookingSchema } from '../src/modules/booking/booking.validation';
import type { BookingDocument } from '../src/models/Booking';

const point = (address: string) => ({ lat: 47.6, lng: -122.3, address });

/** A booking stand-in with the surface the edit logic touches. */
const booking = (over: Record<string, unknown> = {}) =>
  ({
    tripType: 'point2point',
    amendments: [] as { field: string; from: string; to: string; by: string }[],
    ...over,
  }) as unknown as BookingDocument & { amendments: { field: string; from: string; to: string; by: string }[] };

const parse = (body: Record<string, unknown>) => updateBookingSchema.parse(body);

describe('updateBookingSchema — the new editable details', () => {
  it('accepts each of them on its own', () => {
    expect(() => parse({ stops: [point('Pike Place Market')] })).not.toThrow();
    expect(() => parse({ stops: [] })).not.toThrow();
    expect(() => parse({ occasion: 'Wedding' })).not.toThrow();
    expect(() => parse({ occasion: null })).not.toThrow();
    expect(() => parse({ checkedBags: 2 })).not.toThrow();
    expect(() => parse({ passengerName: 'Alex Rider', passengerPhone: '+12065550148' })).not.toThrow();
    expect(() => parse({ passengerName: null })).not.toThrow();
    expect(() => parse({ flightNumber: 'AS123' })).not.toThrow();
  });

  it('still refuses an empty edit, and nonsense', () => {
    expect(() => parse({})).toThrow();
    expect(() => parse({ occasion: 'Funeral' })).toThrow();
    expect(() => parse({ checkedBags: -1 })).toThrow();
    expect(() => parse({ stops: Array.from({ length: 6 }, (_, i) => point(`Stop number ${i}`)) })).toThrow();
    expect(() => parse({ flightNumber: 'A' })).toThrow();
  });
});

describe('editing stops', () => {
  it('adds stops and records the before and after', () => {
    const b = booking();
    const result = applyDetailChanges(b, parse({ stops: [point('Pike Place Market'), point('Space Needle')] }));
    expect(result).toEqual({ changed: true, stopCountChanged: true });
    expect(b.stops).toHaveLength(2);
    expect(b.amendments).toEqual([
      expect.objectContaining({ field: 'stops', from: '—', to: 'Pike Place Market → Space Needle', by: 'customer' }),
    ]);
  });

  it('removes them all with an empty list', () => {
    const b = booking({ stops: [point('Pike Place Market')] });
    const result = applyDetailChanges(b, parse({ stops: [] }));
    expect(result.stopCountChanged).toBe(true);
    expect(b.stops).toBeUndefined();
    expect(b.amendments[0]).toMatchObject({ from: 'Pike Place Market', to: '—' });
  });

  it('re-ordering or changing an address is a change, but does not change the price', () => {
    const b = booking({ stops: [point('Pike Place Market'), point('Space Needle')] });
    const result = applyDetailChanges(b, parse({ stops: [point('Space Needle'), point('Pike Place Market')] }));
    expect(result).toEqual({ changed: true, stopCountChanged: false });
  });

  it('records nothing when the stops are the same', () => {
    const b = booking({ stops: [point('Pike Place Market')] });
    expect(applyDetailChanges(b, parse({ stops: [point('Pike Place Market')] }))).toEqual({
      changed: false,
      stopCountChanged: false,
    });
    expect(b.amendments).toHaveLength(0);
  });

  it('refuses stops on an hourly charter, but lets them be cleared', () => {
    expect(() => applyDetailChanges(booking({ tripType: 'hourly' }), parse({ stops: [point('Pike Place Market')] }))).toThrow(
      /hourly/,
    );
    expect(() => applyDetailChanges(booking({ tripType: 'hourly' }), parse({ stops: [] }))).not.toThrow();
  });

  it('will not change the NUMBER of stops on a booking already paid by card', () => {
    const paid = booking({ payment: { amount: 155 }, stops: [point('Pike Place Market')] });
    expect(() => applyDetailChanges(paid, parse({ stops: [point('Pike Place Market'), point('Space Needle')] }))).toThrow(
      /cannot be changed online/,
    );
    expect(paid.stops).toHaveLength(1);

    try {
      applyDetailChanges(paid, parse({ stops: [] }));
    } catch (err) {
      expect((err as { statusCode: number; details: { code: string } }).statusCode).toBe(409);
      expect((err as { details: { code: string } }).details.code).toBe('STOP_COUNT_LOCKED_BY_PAYMENT');
    }
  });

  it('lets a paid booking swap a stop for another, since that costs nothing', () => {
    const paid = booking({ payment: { amount: 155 }, stops: [point('Pike Place Market')] });
    expect(applyDetailChanges(paid, parse({ stops: [point('Space Needle')] }))).toEqual({
      changed: true,
      stopCountChanged: false,
    });
  });
});

describe('editing the flight', () => {
  it('changes the number, normalised, and drops the old arrival time', () => {
    const b = booking({ tripType: 'airport', flightDetails: { flightNumber: 'AS100', scheduledArrival: new Date() } });
    const result = applyDetailChanges(b, parse({ flightNumber: ' as 123 '.trim() }));
    expect(result.changed).toBe(true);
    expect(b.flightDetails).toEqual({ flightNumber: 'AS 123' });
    expect(b.amendments[0]).toMatchObject({ field: 'flight', from: 'AS100', to: 'AS 123' });
  });

  it('is refused on a booking that is not an airport pickup', () => {
    expect(() => applyDetailChanges(booking(), parse({ flightNumber: 'AS123' }))).toThrow(/airport booking/);
  });

  it('does nothing when it is the same flight', () => {
    const b = booking({ tripType: 'airport', flightDetails: { flightNumber: 'AS123' } });
    expect(applyDetailChanges(b, parse({ flightNumber: 'as123' })).changed).toBe(false);
  });
});

describe('editing the occasion', () => {
  it('sets one, with details for Other', () => {
    const b = booking();
    applyDetailChanges(b, parse({ occasion: 'Other', occasionDetails: 'Anniversary' }));
    expect(b.occasion).toBe('Other');
    expect(b.occasionDetails).toBe('Anniversary');
    expect(b.amendments[0]).toMatchObject({ field: 'occasion', from: '—', to: 'Other (Anniversary)' });
  });

  it('drops the details when the occasion stops being Other', () => {
    const b = booking({ occasion: 'Other', occasionDetails: 'Anniversary' });
    applyDetailChanges(b, parse({ occasion: 'Wedding' }));
    expect(b.occasion).toBe('Wedding');
    expect(b.occasionDetails).toBeUndefined();
  });

  it('can be cleared', () => {
    const b = booking({ occasion: 'Wedding' });
    applyDetailChanges(b, parse({ occasion: null }));
    expect(b.occasion).toBeUndefined();
    expect(b.amendments[0]).toMatchObject({ from: 'Wedding', to: '—' });
  });

  it('refuses details for an occasion that is not Other', () => {
    expect(() => applyDetailChanges(booking({ occasion: 'Wedding' }), parse({ occasionDetails: 'Rehearsal' }))).toThrow(
      /"Other"/,
    );
  });

  it('updates the details of an existing Other', () => {
    const b = booking({ occasion: 'Other', occasionDetails: 'Anniversary' });
    applyDetailChanges(b, parse({ occasionDetails: 'Retirement party' }));
    expect(b.occasionDetails).toBe('Retirement party');
  });
});

describe('editing the luggage', () => {
  it('changes one count and keeps the other', () => {
    const b = booking({ checkedBags: 2, carryOnBags: 1 });
    applyDetailChanges(b, parse({ carryOnBags: 3 }));
    expect(b).toMatchObject({ checkedBags: 2, carryOnBags: 3 });
    expect(b.amendments[0]).toMatchObject({ field: 'luggage', from: '2 checked, 1 carry-on', to: '2 checked, 3 carry-on' });
  });

  it('records nothing when unchanged', () => {
    const b = booking({ checkedBags: 2, carryOnBags: 1 });
    expect(applyDetailChanges(b, parse({ checkedBags: 2 })).changed).toBe(false);
  });
});

describe('editing the passenger', () => {
  it('sets who is travelling', () => {
    const b = booking();
    applyDetailChanges(b, parse({ passengerName: 'Alex Rider', passengerPhone: '+12065550148' }));
    expect(b).toMatchObject({ passengerName: 'Alex Rider', passengerPhone: '+12065550148' });
    expect(b.amendments[0]).toMatchObject({ field: 'passenger', to: 'Alex Rider, +12065550148' });
  });

  it('changes the phone and keeps the name', () => {
    const b = booking({ passengerName: 'Alex Rider', passengerPhone: '+12065550148' });
    applyDetailChanges(b, parse({ passengerPhone: '+12065550999' }));
    expect(b).toMatchObject({ passengerName: 'Alex Rider', passengerPhone: '+12065550999' });
  });

  it('clears both when the name is cleared, whatever phone came with it', () => {
    const b = booking({ passengerName: 'Alex Rider', passengerPhone: '+12065550148' });
    applyDetailChanges(b, parse({ passengerName: null, passengerPhone: '+12065550999' }));
    expect(b.passengerName).toBeUndefined();
    expect(b.passengerPhone).toBeUndefined();
  });

  it('will not hold a phone number with nobody to ring', () => {
    expect(() => applyDetailChanges(booking(), parse({ passengerPhone: '+12065550148' }))).toThrow(/name/);
  });

  it('can drop just the phone', () => {
    const b = booking({ passengerName: 'Alex Rider', passengerPhone: '+12065550148' });
    applyDetailChanges(b, parse({ passengerPhone: null }));
    expect(b.passengerName).toBe('Alex Rider');
    expect(b.passengerPhone).toBeUndefined();
  });
});

describe('several edits at once', () => {
  it('applies them all and records one trail entry for each', () => {
    const b = booking({ tripType: 'airport', flightDetails: { flightNumber: 'AS100' } });
    const result = applyDetailChanges(
      b,
      parse({ stops: [point('Pike Place Market')], occasion: 'Wedding', checkedBags: 2, flightNumber: 'AS200' }),
    );
    expect(result).toEqual({ changed: true, stopCountChanged: true });
    expect(b.amendments.map((a) => a.field).sort()).toEqual(['flight', 'luggage', 'occasion', 'stops']);
  });

  it('leaves everything alone when nothing in it differs', () => {
    const b = booking({ occasion: 'Wedding', checkedBags: 1, carryOnBags: 0 });
    expect(applyDetailChanges(b, parse({ occasion: 'Wedding', checkedBags: 1 })).changed).toBe(false);
    expect(b.amendments).toHaveLength(0);
  });
});

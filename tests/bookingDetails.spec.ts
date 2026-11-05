import { describe, expect, it } from 'vitest';
import { createBookingSchema } from '../src/modules/booking/booking.validation';
import { buildServiceNotes } from '../src/config/services';

const base = {
  pickup: { lat: 47.6, lng: -122.3, address: '123 Pine St, Seattle' },
  drop: { lat: 47.45, lng: -122.3, address: 'Sea-Tac Airport' },
  vehicleClass: 'sedan',
  tripType: 'point2point' as const,
  city: 'seattle',
};

describe('booking details fields', () => {
  it('stay optional: a booking without them still validates', () => {
    expect(createBookingSchema.safeParse(base).success).toBe(true);
  });

  it('accepts occasion, luggage and a different passenger', () => {
    const r = createBookingSchema.safeParse({
      ...base,
      occasion: 'Other',
      occasionDetails: 'Anniversary dinner',
      carryOnBags: '1',
      checkedBags: 2,
      passengerName: 'Alex Rider',
      passengerPhone: '+12065550148',
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.carryOnBags).toBe(1);
  });

  it.each([
    ['unknown occasion', { occasion: 'Funeral' }],
    ['negative bags', { checkedBags: -1 }],
  ])('rejects %s', (_l, extra) => {
    expect(createBookingSchema.safeParse({ ...base, ...extra }).success).toBe(false);
  });

  it('accepts a phone without a name: each passenger field is optional on its own', () => {
    expect(createBookingSchema.safeParse({ ...base, passengerPhone: '+12065550148' }).success).toBe(true);
  });

  it('adds dispatch notes only when the details are present', () => {
    expect(buildServiceNotes({ vehicleClass: 'sedan' })).toEqual([]);
    const notes = buildServiceNotes({
      vehicleClass: 'sedan',
      occasion: 'Wedding',
      checkedBags: 2,
      carryOnBags: 1,
      passengerName: 'Alex Rider',
      passengerPhone: '+12065550148',
    });
    expect(notes).toEqual([
      'Occasion: Wedding.',
      'Luggage: 2 checked, 1 carry-on.',
      'Booked for someone else: Alex Rider, +12065550148.',
    ]);
  });
});

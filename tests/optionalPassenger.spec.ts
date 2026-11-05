import { describe, expect, it } from 'vitest';
import { createBookingSchema } from '../src/modules/booking/booking.validation';
import { buildServiceNotes } from '../src/config/services';

const base = {
  pickup: { lat: 47.6, lng: -122.3, address: 'Sea-Tac Airport' },
  drop: { lat: 47.6, lng: -122.3, address: 'Hotel Andra, Seattle' },
  vehicleClass: 'sedan',
  tripType: 'point2point',
  city: 'seattle',
  scheduledAt: new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString(),
};

describe('the passenger fields are each optional', () => {
  it('accepts a booking with neither, with a name only, with a phone only, and with both', () => {
    for (const extra of [{}, { passengerName: 'Alex Rider' }, { passengerPhone: '+12065550148' }, { passengerName: 'Alex Rider', passengerPhone: '+12065550148' }]) {
      expect(createBookingSchema.safeParse({ ...base, ...extra }).success, JSON.stringify(extra)).toBe(true);
    }
  });

  it('still checks the shape of what is given', () => {
    expect(createBookingSchema.safeParse({ ...base, passengerPhone: '123' }).success).toBe(false);
    expect(createBookingSchema.safeParse({ ...base, passengerName: 'A' }).success).toBe(false);
  });

  it('tells dispatch about a phone with no name', () => {
    const notes = buildServiceNotes({ vehicleClass: 'sedan', passengerPhone: '+12065550148' });
    expect(notes).toContain('Passenger phone: +12065550148.');
    expect(notes.some((n) => n.startsWith('Booked for someone else'))).toBe(false);
  });

  it('still names the passenger and their number when both are given', () => {
    expect(buildServiceNotes({ vehicleClass: 'sedan', passengerName: 'Alex Rider', passengerPhone: '+12065550148' })).toContain(
      'Booked for someone else: Alex Rider, +12065550148.',
    );
  });
});

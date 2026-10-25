import { describe, expect, it } from 'vitest';
import { createBookingSchema } from '../src/modules/booking/booking.validation';
import { fareEstimateQuerySchema } from '../src/modules/pricing/pricing.validation';
import { buildServiceNotes, MAX_STOPS } from '../src/config/services';

const point = (address: string) => ({ lat: 47.6, lng: -122.3, address });
const base = {
  pickup: point('123 Pine St, Seattle'),
  drop: point('Sea-Tac Airport'),
  vehicleClass: 'sedan',
  tripType: 'point2point' as const,
  city: 'seattle',
};

describe('multi-stop bookings', () => {
  it('stay optional', () => {
    expect(createBookingSchema.safeParse(base).success).toBe(true);
  });

  it('accept up to the maximum number of stops', () => {
    const stops = Array.from({ length: MAX_STOPS }, (_, i) => point(`Stop number ${i + 1}`));
    expect(createBookingSchema.safeParse({ ...base, stops }).success).toBe(true);
    expect(createBookingSchema.safeParse({ ...base, stops: [...stops, point('One too many')] }).success).toBe(false);
  });

  it('are refused on an hourly charter', () => {
    const r = createBookingSchema.safeParse({ ...base, tripType: 'hourly', hours: 3, stops: [point('Somewhere')] });
    expect(r.success).toBe(false);
  });

  it('reject a stop without a usable address', () => {
    expect(createBookingSchema.safeParse({ ...base, stops: [point('x')] }).success).toBe(false);
  });

  it('are listed, in order, in the dispatch notes', () => {
    expect(buildServiceNotes({ vehicleClass: 'sedan', stops: [point('A Street'), point('B Street')] })).toEqual([
      'Stops: 1) A Street; 2) B Street.',
    ]);
  });

  it('can be priced through the estimate query', () => {
    const q = fareEstimateQuerySchema.parse({ city: 'seattle', tripType: 'point2point', stops: '2' });
    expect(q.stops).toBe(2);
    expect(fareEstimateQuerySchema.safeParse({ city: 'seattle', tripType: 'point2point', stops: '9' }).success).toBe(false);
  });
});

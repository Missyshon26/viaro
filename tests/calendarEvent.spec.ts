import { describe, expect, it } from 'vitest';
import {
  buildCalendarEvent,
  COLOR_ASSIGNED,
  COLOR_UNASSIGNED,
  eventHash,
  eventIdFor,
  type CalendarEventInput,
} from '../src/modules/calendar/calendar.event';

const input = (over: Partial<CalendarEventInput['booking']> = {}, rest: Partial<CalendarEventInput> = {}): CalendarEventInput => ({
  booking: {
    pickup: { lat: 1, lng: 2, address: 'Hotel Andra, Seattle' },
    drop: { lat: 1, lng: 2, address: 'Sea-Tac Airport' },
    scheduledAt: new Date('2026-11-03T22:00:00Z'), // 2:00 PM Pacific
    tripType: 'point2point',
    estimatedFare: 140,
    ...over,
  } as CalendarEventInput['booking'],
  ref: 'ABL-123456',
  vehicleLabel: 'Business Sedan',
  customer: { name: 'Pat Rider', phone: '+12065550100', email: 'pat@example.com' },
  ...rest,
});

describe('the calendar event', () => {
  it('says the car, the customer and the kind of trip, and puts the pickup where a map can open it', () => {
    const e = buildCalendarEvent(input());
    expect(e.summary).toBe('Business Sedan · Pat Rider · Point to point');
    expect(e.location).toBe('Hotel Andra, Seattle');
  });

  it('is in Pacific time, an hour long for a transfer and 90 minutes for an airport run', () => {
    const e = buildCalendarEvent(input());
    expect(e.start).toEqual({ dateTime: '2026-11-03T14:00:00-08:00', timeZone: 'America/Los_Angeles' });
    expect(e.end.dateTime).toBe('2026-11-03T15:00:00-08:00');
    const air = buildCalendarEvent(input({ tripType: 'airport', flightDetails: { flightNumber: 'AS123' } }));
    expect(air.end.dateTime).toBe('2026-11-03T15:30:00-08:00');
    expect(air.description).toContain('Flight: AS123');
  });

  it('lasts as long as the hours booked for a charter', () => {
    const e = buildCalendarEvent(input({ tripType: 'hourly', hours: 4 }));
    expect(e.end.dateTime).toBe('2026-11-03T18:00:00-08:00');
    expect(e.description).toContain('Hours booked: 4');
  });

  it('is red until a chauffeur has it, then green, and says who', () => {
    const open = buildCalendarEvent(input());
    expect(open.colorId).toBe(COLOR_UNASSIGNED);
    expect(open.description).toContain('Chauffeur: NOT ASSIGNED YET');
    const taken = buildCalendarEvent(input({}, { chauffeur: { name: 'Dee Driver', phone: '+12065550111' } }));
    expect(taken.colorId).toBe(COLOR_ASSIGNED);
    expect(taken.description).toContain('Chauffeur: Dee Driver · +12065550111');
  });

  it('carries everything dispatch needs in the notes', () => {
    const e = buildCalendarEvent(
      input({
        stops: [{ lat: 0, lng: 0, address: 'Pike Place Market' }],
        passengers: 3,
        checkedBags: 1,
        carryOnBags: 2,
        occasion: 'Other',
        occasionDetails: 'Anniversary',
        meetAndGreet: true,
        carSeats: 2,
        passengerName: 'Alex Rider',
        passengerPhone: '+12065550123',
        serviceNotes: ['Cruise pickup. Meet at Pier 66.'],
        payment: { amount: 140 } as never,
      }),
    );
    for (const line of [
      'Booking ABL-123456',
      'Stop 1: Pike Place Market',
      'To: Sea-Tac Airport',
      'Customer: Pat Rider · +12065550100 · pat@example.com',
      'Passenger: Alex Rider · +12065550123',
      'Party of 3',
      'Bags: 1 checked, 2 carry-on',
      'Occasion: Other (Anniversary)',
      'Extras: Meet and greet, 2 child car seats',
      'Cruise pickup. Meet at Pier 66.',
      'Fare: $140.00 · PAID',
    ]) {
      expect(e.description).toContain(line);
    }
  });

  it('says plainly when a fare has not been paid', () => {
    expect(buildCalendarEvent(input()).description).toContain('Fare: $140.00 · not yet paid');
  });

  it('labels each leg of a journey', () => {
    const e = buildCalendarEvent(input({ journey: { index: 1, count: 3 } }));
    expect(e.summary).toContain('Leg 2/3');
    expect(e.description).toContain('leg 2 of 3');
  });

  it('links to the console when its address is known', () => {
    expect(buildCalendarEvent(input({}, { consoleUrl: 'https://admin.test/trips/1' })).description).toContain('https://admin.test/trips/1');
    expect(buildCalendarEvent(input()).description).not.toContain('console');
  });

  it('reminds a day ahead and an hour ahead', () => {
    expect(buildCalendarEvent(input()).reminders).toEqual({
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 1440 },
        { method: 'popup', minutes: 60 },
      ],
    });
  });

  it('copes with a missing customer and keeps text inside Google\'s limits', () => {
    const e = buildCalendarEvent(input({ serviceNotes: ['x'.repeat(20_000)] }, { customer: null }));
    expect(e.summary).toContain('Customer');
    expect(e.description.length).toBeLessThanOrEqual(7000);
    expect(buildCalendarEvent(input({}, { vehicleLabel: 'V'.repeat(2000) })).summary.length).toBeLessThanOrEqual(200);
  });
});

describe('the event id and fingerprint', () => {
  it('is always the same for the same booking and valid for Google (a-v and 0-9)', () => {
    const id = eventIdFor('5F9D88B8B54764421B7156C9');
    expect(id).toBe('abl5f9d88b8b54764421b7156c9');
    expect(id).toMatch(/^[a-v0-9]{5,1024}$/);
    expect(eventIdFor('5f9d88b8b54764421b7156c9')).toBe(id);
  });

  it('changes when what people see changes, and only then', () => {
    const base = buildCalendarEvent(input());
    expect(eventHash(buildCalendarEvent(input()))).toBe(eventHash(base));
    expect(eventHash(buildCalendarEvent(input({ scheduledAt: new Date('2026-11-03T23:00:00Z') })))).not.toBe(eventHash(base));
    expect(eventHash(buildCalendarEvent(input({}, { chauffeur: { name: 'Dee' } })))).not.toBe(eventHash(base));
  });
});

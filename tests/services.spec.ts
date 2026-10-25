import { describe, expect, it } from 'vitest';
import { buildServiceNotes } from '../src/config/services';

/** The dispatch notes every console and the driver app print (checklist §1, §8). */
describe('service notes', () => {
  it('flags Meet and Greet and car seats', () => {
    const notes = buildServiceNotes({ vehicleClass: 'sedan', meetAndGreet: true, carSeats: 2 });
    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatch(/Meet and Greet/);
    expect(notes[1]).toMatch(/2 requested/);
  });

  it('sends a Sprinter at Pier 91 to Islands 3–4', () => {
    const [note] = buildServiceNotes({ vehicleClass: 'minibus', cruisePort: 'pier91' });
    expect(note).toMatch(/Islands 3–4/);
  });

  it('meets a sedan at Pier 91 inside when Meet and Greet is booked', () => {
    const notes = buildServiceNotes({ vehicleClass: 'sedan', cruisePort: 'pier91', meetAndGreet: true });
    expect(notes.at(-1)).toMatch(/inside the terminal/);
  });

  it('lists car seats by the age they suit, and the customer\'s own note', () => {
    const notes = buildServiceNotes({
      vehicleClass: 'sedan',
      carSeats: 3,
      carSeatTypes: { infant: 1, toddler: 0, booster: 2 },
      description: '  Need a wheelchair ramp  ',
    });
    expect(notes[0]).toBe('Child car seats: 1 × infant seat (ages 0-1), 2 × booster seat (ages 3-6) (free).');
    expect(notes.at(-1)).toBe('Customer note: Need a wheelchair ramp');
  });

  it('falls back to the plain count when no ages were given', () => {
    expect(buildServiceNotes({ vehicleClass: 'sedan', carSeats: 1, carSeatTypes: { infant: 0, toddler: 0, booster: 0 } })[0]).toMatch(/1 requested/);
  });

  it('has nothing to say about a plain booking', () => {
    expect(buildServiceNotes({ vehicleClass: 'sedan' })).toEqual([]);
  });
});

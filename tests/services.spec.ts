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

  it('has nothing to say about a plain booking', () => {
    expect(buildServiceNotes({ vehicleClass: 'sedan' })).toEqual([]);
  });
});

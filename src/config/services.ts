/**
 * Booking extras and special services: Meet and Greet, child car seats, cruise port
 * pickups and fixed route prices (pre-deployment checklist §1, §2, §6, §8).
 *
 * Kept in code with the other fixed business facts (see constants.ts): changing a fee or
 * a meeting point is a product decision that should go through review and a deploy.
 */

/* ------------------------------ Meet and Greet ---------------------------- */

/** Added to the fare when the customer asks to be met inside (checklist §2: $25). */
export const MEET_AND_GREET_FEE = 25;

/* -------------------------------- car seats -------------------------------- */

/** Child car seats are free; this caps how many one booking can ask for. */
export const MAX_CAR_SEATS = 3;

/* ------------------------------- cruise ports ------------------------------ */

export const CRUISE_PORTS = {
  pier66: {
    label: 'Pier 66 — Bell Street Cruise Terminal',
    address: 'Bell Street Cruise Terminal, Pier 66, 2225 Alaskan Way, Seattle, WA 98121',
  },
  pier91: {
    label: 'Pier 91 — Smith Cove Cruise Terminal',
    address: 'Smith Cove Cruise Terminal, Pier 91, 2001 W Garfield St, Seattle, WA 98119',
  },
} as const;

export type CruisePort = keyof typeof CRUISE_PORTS;
export const CRUISE_PORT_KEYS = Object.keys(CRUISE_PORTS) as CruisePort[];

/** Vehicle classes that use the coach and van lanes rather than the car pickup area. */
const LARGE_VEHICLES = new Set(['minibus']);

/**
 * Where the chauffeur meets a cruise passenger.
 *
 * ⚠ The Pier 91 large-vehicle rule (Islands 3–4) is from the checklist (§8). The rest is
 * general wording — have operations confirm the exact meeting points for each terminal.
 */
export function cruiseMeetingPoint(port: CruisePort, vehicleClass: string, meetAndGreet: boolean): string {
  const terminal = CRUISE_PORTS[port].label;
  if (port === 'pier91' && LARGE_VEHICLES.has(vehicleClass)) {
    return `${terminal}: your Sprinter van waits at Islands 3–4 in the ground transportation area.`;
  }
  return meetAndGreet
    ? `${terminal}: your chauffeur will meet you inside the terminal after disembarkation, holding a sign with your name.`
    : `${terminal}: your chauffeur will wait in the ground transportation area and text you on arrival.`;
}

/* ------------------------------- route prices ------------------------------ */

/**
 * Fixed prices for specific journeys, which replace the class's flat rate when both ends
 * match (checklist §2). A class the route does not list keeps its normal price.
 *
 * Seattle / Bellevue ↔ Sea-Tac is not here: it is $140 Sedan / $172 MPV, which is
 * already the flat rate. Vancouver BC is still to be priced.
 */
export interface RouteFare {
  key: string;
  label: string;
  /** True when this pickup/drop-off pair is the route, in either direction. */
  matches: (a: string, b: string) => boolean;
  prices: Record<string, number>;
}

/** Sea-Tac airport, however the address autocomplete or the customer spelled it. */
const isSeaTac = (address: string) =>
  /sea[\s-]?tac|seattle[\s-]+tacoma\s+international|\bSEA\b.*airport|17801\s+international\s+blvd/i.test(address);

/**
 * The city of Tacoma — not the airport. "Seattle-Tacoma International" contains the word
 * Tacoma, so the airport's own name is removed before looking for it.
 */
const isTacoma = (address: string) =>
  /\btacoma\b/i.test(address.replace(/seattle[\s-]+tacoma/gi, '').replace(/sea[\s-]?tac/gi, ''));

export const ROUTE_FARES: RouteFare[] = [
  {
    key: 'tacoma-seatac',
    label: 'Tacoma ↔ Sea-Tac',
    matches: (a, b) => (isTacoma(a) && isSeaTac(b)) || (isTacoma(b) && isSeaTac(a)),
    prices: { sedan: 159, mpv: 199 },
  },
];

/** The route price for this journey and class, if there is one. */
export function routeFareFor(
  pickup: string | undefined,
  drop: string | undefined,
  vehicleClass: string | undefined,
): { label: string; price: number } | null {
  if (!pickup || !drop || !vehicleClass) return null;
  for (const route of ROUTE_FARES) {
    const price = route.prices[vehicleClass];
    if (price !== undefined && route.matches(pickup, drop)) return { label: route.label, price };
  }
  return null;
}

/* ----------------------------- dispatch notes ----------------------------- */

export interface ServiceRequest {
  vehicleClass: string;
  meetAndGreet?: boolean;
  carSeats?: number;
  cruisePort?: CruisePort | null;
  cruiseShip?: string | null;
}

/**
 * The plain-language notes a chauffeur and dispatcher need for this booking.
 *
 * Stored on the booking (recomputed when it changes) so every console, the driver app
 * and every email print the same lines without each re-deriving the rules.
 */
export function buildServiceNotes(b: ServiceRequest): string[] {
  const notes: string[] = [];
  if (b.meetAndGreet) notes.push('Meet and Greet: meet the passenger inside with a name sign.');
  if (b.carSeats) {
    notes.push(`Child car seat${b.carSeats > 1 ? 's' : ''}: ${b.carSeats} requested (free).`);
  }
  if (b.cruisePort) {
    notes.push(
      `Cruise pickup${b.cruiseShip ? ` (${b.cruiseShip})` : ''}. ` +
        cruiseMeetingPoint(b.cruisePort, b.vehicleClass, Boolean(b.meetAndGreet)),
    );
  }
  return notes;
}

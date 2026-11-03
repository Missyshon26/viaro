/**
 * The "Add a trip" screen's pure logic: what the form must hold before it can be quoted or
 * booked, and how it becomes the request the API takes. No React and no fetching, so it can
 * be tested on its own.
 *
 * Like the passenger site there is no geocoder: an address is the text the operator typed,
 * placed at the middle of the chosen city. Dispatch and the chauffeur read the text.
 */

export type Service = "point2point" | "airport" | "hourly";

export const SERVICE_LABEL: Record<Service, string> = {
  point2point: "Point to point",
  airport: "Airport transfer",
  hourly: "Hourly charter",
};

/** Mirrors viaro-backend config/services.ts TRIP_OCCASIONS and MAX_STOPS. */
export const OCCASIONS = [
  "Airport Transfer",
  "Wedding",
  "Quinceañera/Birthday",
  "Concert/Stadium Event",
  "Homecoming/Prom",
  "Other",
] as const;
export const MAX_STOPS = 5;
/** Tip choices, as a percentage of the trip price. Mirrors the API's GRATUITY_OPTIONS. */
export const GRATUITY_OPTIONS = [0, 10, 15, 20] as const;
export const MAX_CAR_SEATS = 4;

/** Where an address is placed. Keys are the pricing rules' city names, lowercased. */
const CENTRES: Record<string, { lat: number; lng: number }> = {
  seattle: { lat: 47.608, lng: -122.332 },
  bellevue: { lat: 47.6101, lng: -122.2015 },
  tacoma: { lat: 47.2529, lng: -122.4443 },
  kirkland: { lat: 47.6769, lng: -122.206 },
  everett: { lat: 47.979, lng: -122.2021 },
  "los angeles": { lat: 34.0522, lng: -118.2437 },
};
export const centreOf = (city: string) => CENTRES[city.trim().toLowerCase()] ?? CENTRES.seattle;

export interface TripForm {
  clientId: string;
  service: Service;
  city: string;
  vehicleClass: string;
  pickup: string;
  drop: string;
  stops: string[];
  /** A <input type="datetime-local"> value: yyyy-mm-ddThh:mm, Pacific wall time. */
  when: string;
  hours: string;
  passengers: string;
  flightNumber: string;
  occasion: string;
  occasionDetails: string;
  checkedBags: string;
  carryOnBags: string;
  meetAndGreet: boolean;
  carSeats: string;
  /** The tip, as a percentage of the trip price ("0" = none). */
  gratuity: string;
  passengerName: string;
  passengerPhone: string;
}

export const emptyTripForm = (): TripForm => ({
  clientId: "",
  service: "point2point",
  city: "seattle",
  vehicleClass: "",
  pickup: "",
  drop: "",
  stops: [],
  when: "",
  hours: "2",
  passengers: "1",
  flightNumber: "",
  occasion: "",
  occasionDetails: "",
  checkedBags: "",
  carryOnBags: "",
  meetAndGreet: false,
  carSeats: "",
  gratuity: "0",
  passengerName: "",
  passengerPhone: "",
});

const text = (value: string) => value.trim();
const count = (value: string) => (text(value) === "" ? undefined : Math.max(0, Math.floor(Number(value))));

/** What is still needed before the trip can be priced or booked, in plain words; null = ready. */
export function missingFrom(form: TripForm): string | null {
  if (!form.clientId) return "Choose the client this trip is for.";
  if (!text(form.pickup)) return "Enter the pickup address.";
  if (!text(form.drop)) return form.service === "hourly" ? "Enter where the charter ends." : "Enter the drop-off address.";
  if (!form.when) return "Choose the pickup date and time.";
  if (!form.vehicleClass) return "Choose a vehicle.";
  if (form.service === "airport" && !/^[A-Za-z0-9]{2,8}$/.test(text(form.flightNumber).replace(/[\s-]+/g, ""))) {
    return "Enter the flight number for an airport transfer.";
  }
  if (form.service === "hourly" && !(Number(form.hours) >= 1)) return "Enter how many hours (at least 1).";
  if (form.stops.some((stop) => !text(stop))) return "Fill in every stop, or remove the empty one.";
  if (text(form.passengerPhone) && !text(form.passengerName)) return "Enter the passenger's name too.";
  return null;
}

/** `datetime-local` has no seconds; the API reads an offset-less time as Pacific wall time. */
export const pickupTime = (when: string) => (/T\d{2}:\d{2}$/.test(when) ? `${when}:00` : when);

/** A discount typed in by the operator: a percentage or a flat dollar amount. */
export interface DiscountForm {
  type: "percent" | "flat";
  /** What was typed; empty or 0 = no discount. */
  value: string;
}
export const emptyDiscount = (): DiscountForm => ({ type: "percent", value: "" });

/** The discount as the API takes it, or nothing when none was entered. */
export function discountPayload(d?: DiscountForm) {
  const value = Number(d?.value);
  return d && Number.isFinite(value) && value > 0 ? { discount: { type: d.type, value } } : {};
}

/** Why the discount cannot be used, in plain words; null = fine or none. */
export function discountProblem(d: DiscountForm): string | null {
  if (d.value.trim() === "") return null;
  const value = Number(d.value);
  if (!Number.isFinite(value) || value < 0) return "Enter a discount of zero or more.";
  if (d.type === "percent" && value > 100) return "A percentage discount cannot be more than 100.";
  return null;
}

/** The body for POST /admin/bookings (and /admin/bookings/quote). */
export function tripPayload(form: TripForm, discount?: DiscountForm) {
  const centre = centreOf(form.city);
  const at = (address: string) => ({ lat: centre.lat, lng: centre.lng, address: text(address) });
  const hourly = form.service === "hourly";
  const passengerName = text(form.passengerName);

  const checkedBags = count(form.checkedBags);
  const carryOnBags = count(form.carryOnBags);
  const carSeats = count(form.carSeats);
  const occasion = text(form.occasion);

  return {
    customerId: form.clientId,
    ...discountPayload(discount),
    trip: {
      pickup: at(form.pickup),
      drop: at(form.drop),
      vehicleClass: form.vehicleClass,
      tripType: form.service,
      city: form.city,
      scheduledAt: pickupTime(form.when),
      ...(count(form.passengers) ? { passengers: count(form.passengers) } : {}),
      ...(hourly ? { hours: Number(form.hours) } : {}),
      ...(form.service === "airport"
        ? { flightDetails: { flightNumber: text(form.flightNumber).replace(/[\s-]+/g, "").toUpperCase() } }
        : {}),
      // Stops belong to transfers; an hourly charter goes wherever the hours take it.
      ...(!hourly && form.stops.length ? { stops: form.stops.map(at) } : {}),
      ...(form.meetAndGreet ? { meetAndGreet: true } : {}),
      ...(carSeats ? { carSeats } : {}),
      ...(Number(form.gratuity) > 0 ? { gratuityPct: Number(form.gratuity) } : {}),
      ...(occasion ? { occasion } : {}),
      ...(occasion === "Other" && text(form.occasionDetails) ? { occasionDetails: text(form.occasionDetails) } : {}),
      ...(checkedBags !== undefined ? { checkedBags } : {}),
      ...(carryOnBags !== undefined ? { carryOnBags } : {}),
      ...(passengerName ? { passengerName } : {}),
      ...(passengerName && text(form.passengerPhone) ? { passengerPhone: text(form.passengerPhone) } : {}),
    },
  };
}

/** The classes that can be booked for this kind of trip (a class may be transfers-only, etc.). */
export function classesFor<T extends { usage?: "all" | "hourly" | "transfer"; active?: boolean }>(
  classes: T[],
  service: Service,
): T[] {
  return classes.filter((c) => {
    if (c.active === false) return false;
    const usage = c.usage ?? "all";
    return usage === "all" || (service === "hourly" ? usage === "hourly" : usage === "transfer");
  });
}

/* --------------------------- multi-leg journeys ---------------------------- */

/** Mirrors the API: a journey is two to five legs, each at least this long after the last. */
export const MAX_LEGS = 5;
export const MIN_MINUTES_BETWEEN_LEGS = 30;

/** The way back: the same trip reversed, for the operator to give a time. */
export function returnLeg(leg: TripForm): TripForm {
  return {
    ...leg,
    // A flight and a meet-and-greet belong to the outbound arrival, not the way back.
    service: leg.service === "hourly" ? "hourly" : "point2point",
    pickup: leg.drop,
    drop: leg.pickup,
    stops: [...leg.stops].reverse(),
    when: "",
    flightNumber: "",
    meetAndGreet: false,
  };
}

/** A fresh next leg: it starts where the last one ended, with the same city, car and party. */
export function nextLeg(previous: TripForm): TripForm {
  return {
    ...emptyTripForm(),
    clientId: previous.clientId,
    city: previous.city,
    vehicleClass: previous.vehicleClass,
    passengers: previous.passengers,
    gratuity: previous.gratuity,
    pickup: previous.drop,
  };
}

/** What is still needed before the journey can be priced or booked; null = ready. */
export function missingForJourney(clientId: string, legs: TripForm[]): string | null {
  for (const [index, leg] of legs.entries()) {
    const problem = missingFrom({ ...leg, clientId });
    if (problem) return legs.length > 1 ? `Leg ${index + 1}: ${problem}` : problem;
  }
  if (legs.length > 1) {
    for (let i = 1; i < legs.length; i += 1) {
      const gap = (new Date(legs[i].when).getTime() - new Date(legs[i - 1].when).getTime()) / 60_000;
      if (!(gap >= MIN_MINUTES_BETWEEN_LEGS)) {
        return `Leg ${i + 1} must start at least ${MIN_MINUTES_BETWEEN_LEGS} minutes after leg ${i}.`;
      }
    }
  }
  return null;
}

/** The body for POST /admin/bookings/journey (and its /quote). */
export function journeyPayload(clientId: string, legs: TripForm[], discount?: DiscountForm) {
  return { customerId: clientId, ...discountPayload(discount), legs: legs.map((leg) => tripPayload({ ...leg, clientId }).trip) };
}

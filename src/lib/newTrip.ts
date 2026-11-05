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
export const AIRPORT_OCCASION = "Airport Transfer";

/**
 * The occasions that make sense for a kind of trip. A one-way or round trip is an airport
 * transfer; the celebrations and events (and "Other") belong to an hourly charter. Takes a
 * trip type or a service, since only "hourly" differs.
 */
export function occasionsFor(service: string): readonly string[] {
  return service === "hourly" ? OCCASIONS.filter((o) => o !== AIRPORT_OCCASION) : [AIRPORT_OCCASION];
}

/** The occasion if it suits this kind of trip, otherwise "" (so a stale choice never travels). */
export function occasionFor(service: string, occasion: string): string {
  return occasionsFor(service).includes(occasion) ? occasion : "";
}

export const MAX_STOPS = 5;
/** Tip choices, as a percentage of the trip price. Mirrors the API's GRATUITY_OPTIONS. */
export const GRATUITY_OPTIONS = [0, 10, 15, 20] as const;
/** Child seats are free, at most this many per trip. Mirrors the API's MAX_CAR_SEATS. */
export const MAX_CAR_SEATS = 3;

/** The choices for the child-seat dropdown: none, then 1 to the most the API takes. "" means none. */
export const CAR_SEAT_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "", label: "None" },
  ...Array.from({ length: MAX_CAR_SEATS }, (_, i) => ({ value: String(i + 1), label: `${i + 1} seat${i === 0 ? "" : "s"}` })),
];

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
  /** Anything dispatch or the chauffeur should know (the booking's `description`, max 500). */
  notes: string;
}

/** The API's limit on a booking's free-text note. */
export const NOTES_MAX = 500;

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
  notes: "",
});

const text = (value: string) => value.trim();
const count = (value: string) => (text(value) === "" ? undefined : Math.max(0, Math.floor(Number(value))));

/* ------------------------- a client who has no account yet ------------------------- */

/** The details of someone who is not a client yet, typed right on the "Add a trip" form. */
export interface NewClientForm {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

export const emptyNewClient = (): NewClientForm => ({ firstName: "", lastName: "", email: "", phone: "" });

/** Whether anything has been typed, so an untouched form is not treated as a client. */
export const newClientStarted = (c: NewClientForm) => Boolean(c.firstName.trim() || c.lastName.trim() || c.email.trim() || c.phone.trim());

/** What is still needed before this person can be made a client, in plain words; null = ready. */
export function newClientProblem(c: NewClientForm): string | null {
  if (`${c.firstName} ${c.lastName}`.trim().length < 2) return "Enter the new client's full name.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email.trim())) return "Enter the new client's email address.";
  if (c.phone.trim().length < 6) return "Enter the new client's phone number.";
  return null;
}

/** The new client as the API takes it. */
export function newClientPayload(c: NewClientForm) {
  return { firstName: c.firstName.trim(), lastName: c.lastName.trim(), email: c.email.trim().toLowerCase(), phone: c.phone.trim() };
}

/**
 * What was typed in the client search, put in the right box when the operator decides to add
 * that person instead: an address with an @ is the email, mostly digits is the phone, anything
 * else is the name.
 */
export function prefillFromSearch(term: string): Partial<NewClientForm> {
  const text = term.trim();
  if (!text) return {};
  if (text.includes("@")) return { email: text };
  if (/^[+\d\s().-]{6,}$/.test(text)) return { phone: text };
  const space = text.replace(/\s+/g, " ").indexOf(" ");
  const squeezed = text.replace(/\s+/g, " ");
  return space === -1 ? { firstName: squeezed } : { firstName: squeezed.slice(0, space), lastName: squeezed.slice(space + 1) };
}

/** What the API says about the client of a booking, when the booking made their account. */
export interface BookedClient {
  name: string;
  email: string;
  created: boolean;
  /** False when the "set your password" email could not be sent. */
  inviteSent: boolean;
}

/**
 * What to tell the operator about the account a booking created, or null when it made none.
 * A failed invitation is a warning: the client has an account but no way in yet, and the operator
 * is the only one who can fix that.
 */
export type AccountNotice = { tone: "ok" | "warn"; message: string };

export function accountNotice(client?: BookedClient | null): AccountNotice | null {
  if (!client?.created) return null;
  return client.inviteSent
    ? { tone: "ok", message: `${client.name}'s account was created, and they were emailed to set a password.` }
    : {
        tone: "warn",
        message: `${client.name}'s account was created, but the email to set a password could not be sent to ${client.email}. Ask them to use "Forgot password" on the booking site, or check the address.`,
      };
}

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
export function tripPayload(form: TripForm, discount?: DiscountForm, newClient?: NewClientForm) {
  const centre = centreOf(form.city);
  const at = (address: string) => ({ lat: centre.lat, lng: centre.lng, address: text(address) });
  const hourly = form.service === "hourly";
  const passengerName = text(form.passengerName);

  const checkedBags = count(form.checkedBags);
  const carryOnBags = count(form.carryOnBags);
  const carSeats = count(form.carSeats);
  // Only an occasion that suits the kind of trip is sent: switching to hourly drops a stale one.
  const occasion = occasionFor(form.service, text(form.occasion));

  return {
    // An existing client, or a new one whose account is made when the trip is booked: never both.
    ...(newClient ? { newClient: newClientPayload(newClient) } : { customerId: form.clientId }),
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
      ...(text(form.notes) ? { description: text(form.notes).slice(0, NOTES_MAX) } : {}),
      ...(passengerName ? { passengerName } : {}),
      // Each is optional on its own: a number to ring needs no name.
      ...(text(form.passengerPhone) ? { passengerPhone: text(form.passengerPhone) } : {}),
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
export function missingForJourney(clientId: string, legs: TripForm[], newClient?: NewClientForm): string | null {
  // A new client stands in for the choice of an existing one; they are checked first.
  if (newClient) {
    const problem = newClientProblem(newClient);
    if (problem) return problem;
  }
  for (const [index, leg] of legs.entries()) {
    const problem = missingFrom({ ...leg, clientId: newClient ? "new" : clientId });
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
export function journeyPayload(clientId: string, legs: TripForm[], discount?: DiscountForm, newClient?: NewClientForm) {
  return {
    ...(newClient ? { newClient: newClientPayload(newClient) } : { customerId: clientId }),
    ...discountPayload(discount),
    legs: legs.map((leg) => tripPayload({ ...leg, clientId }).trip),
  };
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { classesFor, emptyNewClient, emptyTripForm, missingFrom, newClientPayload, newClientProblem, newClientStarted, occasionFor, occasionsFor, pickupTime, prefillFromSearch, tripPayload } from "../src/lib/newTrip.ts";

const ready = (over = {}) => ({
  ...emptyTripForm(),
  service: "point2point",
  clientId: "5f9d88b8b54764421b7156c9",
  pickup: "Hotel Andra, Seattle",
  drop: "Sea-Tac Airport",
  when: "2026-11-02T14:30",
  vehicleClass: "sedan",
  ...over,
});

test("a new trip starts as an airport transfer", () => {
  assert.equal(emptyTripForm().service, "airport");
  assert.match(missingFrom({ ...emptyTripForm(), clientId: "x", pickup: "a", drop: "b", when: "2026-11-02T14:30", vehicleClass: "sedan" }), /flight/i);
});

test("an empty form says what is missing, in order", () => {
  assert.match(missingFrom(emptyTripForm()), /client/i);
  assert.match(missingFrom({ ...emptyTripForm(), clientId: "x" }), /pickup/i);
  assert.equal(missingFrom(ready()), null);
});

test("airport needs a flight, hourly needs hours, stops must be filled", () => {
  assert.match(missingFrom(ready({ service: "airport" })), /flight/i);
  assert.equal(missingFrom(ready({ service: "airport", flightNumber: "as 123" })), null);
  assert.match(missingFrom(ready({ service: "hourly", hours: "0" })), /hours/i);
  assert.match(missingFrom(ready({ stops: ["Pike Place", "  "] })), /stop/i);
  // the passenger name and phone are each optional: a phone alone is fine
  assert.equal(missingFrom(ready({ passengerPhone: "2065550100" })), null);
});

test("the pickup time gains seconds and nothing else", () => {
  assert.equal(pickupTime("2026-11-02T14:30"), "2026-11-02T14:30:00");
  assert.equal(pickupTime("2026-11-02T14:30:00"), "2026-11-02T14:30:00");
});

test("a simple transfer becomes the API body, placed at the city centre", () => {
  const body = tripPayload(ready({ city: "bellevue", passengers: "3" }));
  assert.equal(body.customerId, "5f9d88b8b54764421b7156c9");
  assert.deepEqual(body.trip.pickup, { lat: 47.6101, lng: -122.2015, address: "Hotel Andra, Seattle" });
  assert.equal(body.trip.tripType, "point2point");
  assert.equal(body.trip.scheduledAt, "2026-11-02T14:30:00");
  assert.equal(body.trip.passengers, 3);
  assert.equal("stops" in body.trip, false);
  assert.equal("flightDetails" in body.trip, false);
});

test("airport carries a cleaned flight number; hourly carries hours and drops stops", () => {
  const air = tripPayload(ready({ service: "airport", flightNumber: " as-1042 " }));
  assert.deepEqual(air.trip.flightDetails, { flightNumber: "AS1042" });

  const hourly = tripPayload(ready({ service: "hourly", hours: "4", stops: ["Pike Place Market"] }));
  assert.equal(hourly.trip.hours, 4);
  assert.equal("stops" in hourly.trip, false);
});

test("extras are sent only when set; zero bags are a real answer", () => {
  const bare = tripPayload(ready());
  for (const key of ["meetAndGreet", "carSeats", "occasion", "checkedBags", "carryOnBags", "passengerName"]) {
    assert.equal(key in bare.trip, false, key);
  }
  const full = tripPayload(
    ready({
      stops: ["Pike Place Market"],
      meetAndGreet: true,
      carSeats: "2",
      occasion: "Airport Transfer",
      checkedBags: "0",
      carryOnBags: "2",
      passengerName: "Jo Park",
      passengerPhone: "2065550100",
    }),
  );
  assert.equal(full.trip.stops.length, 1);
  assert.equal(full.trip.meetAndGreet, true);
  assert.equal(full.trip.carSeats, 2);
  assert.equal(full.trip.occasion, "Airport Transfer");
  assert.equal(full.trip.checkedBags, 0);
  assert.equal(full.trip.carryOnBags, 2);
  assert.equal(full.trip.passengerPhone, "2065550100");
});

test("a passenger phone without a name is sent: each is optional on its own", () => {
  const trip = tripPayload(ready({ passengerPhone: "2065550100" })).trip;
  assert.equal(trip.passengerPhone, "2065550100");
  assert.equal("passengerName" in trip, false);
});

test("a form with every field of Additional requirements left blank is ready to book", () => {
  assert.equal(missingFrom(ready()), null);
  const trip = tripPayload(ready()).trip;
  for (const key of ["occasion", "checkedBags", "carryOnBags", "carSeats", "meetAndGreet", "passengerName", "passengerPhone", "description"]) {
    assert.equal(key in trip, false, key);
  }
});

test("vehicles are offered only for the kind of trip they serve", () => {
  const all = [
    { value: "a", usage: "all" },
    { value: "b", usage: "hourly" },
    { value: "c", usage: "transfer" },
    { value: "d", usage: "all", active: false },
  ];
  assert.deepEqual(classesFor(all, "point2point").map((c) => c.value), ["a", "c"]);
  assert.deepEqual(classesFor(all, "airport").map((c) => c.value), ["a", "c"]);
  assert.deepEqual(classesFor(all, "hourly").map((c) => c.value), ["a", "b"]);
});

import { journeyPayload, missingForJourney, nextLeg, returnLeg } from "../src/lib/newTrip.ts";

test("the way back reverses the trip and waits for a time", () => {
  const out = ready({ service: "airport", flightNumber: "AS1042", stops: ["Pike Place", "Space Needle"], meetAndGreet: true });
  const back = returnLeg(out);
  assert.equal(back.pickup, out.drop);
  assert.equal(back.drop, out.pickup);
  assert.deepEqual(back.stops, ["Space Needle", "Pike Place"]);
  assert.equal(back.service, "point2point");
  assert.equal(back.when, "");
  assert.equal(back.flightNumber, "");
  assert.equal(back.meetAndGreet, false);
  assert.equal(out.stops.length, 2); // the original is untouched
});

test("a next leg starts where the last one ended", () => {
  const next = nextLeg(ready({ city: "bellevue", passengers: "4" }));
  assert.equal(next.pickup, "Sea-Tac Airport");
  assert.equal(next.drop, "");
  assert.equal(next.city, "bellevue");
  assert.equal(next.vehicleClass, "sedan");
  assert.equal(next.passengers, "4");
});

test("a journey names the leg that is incomplete, and checks the gaps", () => {
  const a = ready({ when: "2026-11-02T10:00" });
  const b = returnLeg(a);
  assert.match(missingForJourney("c1", [a, b]), /^Leg 2: .*date and time/i);
  assert.match(missingForJourney("c1", [a, { ...b, when: "2026-11-02T10:20" }]), /at least 30 minutes/);
  assert.match(missingForJourney("c1", [a, { ...b, when: "2026-11-02T09:00" }]), /Leg 2 must start/);
  assert.equal(missingForJourney("c1", [a, { ...b, when: "2026-11-02T18:00" }]), null);
  assert.equal(missingForJourney("c1", [a]), null);
});

test("the journey body holds each leg's trip under one client", () => {
  const a = ready({ when: "2026-11-02T10:00" });
  const b = { ...returnLeg(a), when: "2026-11-02T18:00" };
  const body = journeyPayload("c1", [a, b]);
  assert.equal(body.customerId, "c1");
  assert.equal(body.legs.length, 2);
  assert.equal(body.legs[1].pickup.address, "Sea-Tac Airport");
  assert.equal(body.legs[1].scheduledAt, "2026-11-02T18:00:00");
});

test("a tip is sent only when chosen, and carried to the way back and the next leg", () => {
  assert.equal("gratuityPct" in tripPayload(ready()).trip, false);
  assert.equal(tripPayload(ready({ gratuity: "15" })).trip.gratuityPct, 15);
  assert.equal(returnLeg(ready({ gratuity: "20" })).gratuity, "20");
  assert.equal(nextLeg(ready({ gratuity: "10" })).gratuity, "10");
  assert.equal(emptyTripForm().gratuity, "0");
});

test("a note is sent as the booking's description, trimmed", () => {
  const body = tripPayload(ready({ notes: "  Wheelchair user. Gate code 4411.  " }));
  assert.equal(body.trip.description, "Wheelchair user. Gate code 4411.");
});

test("no note, or a blank one, sends no description", () => {
  assert.equal("description" in tripPayload(ready()).trip, false);
  assert.equal("description" in tripPayload(ready({ notes: "   " })).trip, false);
});

test("a note longer than the API allows is cut to 500 characters", () => {
  assert.equal(tripPayload(ready({ notes: "x".repeat(900) })).trip.description.length, 500);
});

test("each leg of a journey carries its own note", async () => {
  const { journeyPayload } = await import("../src/lib/newTrip.ts");
  const body = journeyPayload("5f9d88b8b54764421b7156c9", [ready({ notes: "Outbound note" }), ready({ notes: "" })]);
  assert.equal(body.legs[0].description, "Outbound note");
  assert.equal("description" in body.legs[1], false);
});

test("one-way, round-trip and airport trips offer only Airport Transfer", () => {
  for (const service of ["point2point", "airport"]) assert.deepEqual(occasionsFor(service), ["Airport Transfer"], service);
});

test("an hourly charter offers every other occasion, and not Airport Transfer", () => {
  assert.deepEqual(occasionsFor("hourly"), ["Wedding", "Quinceañera/Birthday", "Concert/Stadium Event", "Homecoming/Prom", "Other"]);
});

test("an occasion that does not suit the trip is dropped, one that does is kept", () => {
  assert.equal(occasionFor("hourly", "Wedding"), "Wedding");
  assert.equal(occasionFor("hourly", "Airport Transfer"), "");
  assert.equal(occasionFor("point2point", "Airport Transfer"), "Airport Transfer");
  assert.equal(occasionFor("airport", "Wedding"), "");
});

test("the payload carries only an occasion that suits the service", () => {
  assert.equal(tripPayload(ready({ occasion: "Airport Transfer" })).trip.occasion, "Airport Transfer");
  // switched to hourly after choosing Airport Transfer: not sent
  assert.equal("occasion" in tripPayload(ready({ service: "hourly", hours: "3", occasion: "Airport Transfer" })).trip, false);
  assert.equal(tripPayload(ready({ service: "hourly", hours: "3", occasion: "Wedding" })).trip.occasion, "Wedding");
});

test("details are sent only for Other, and only on an hourly charter", () => {
  const hourly = tripPayload(ready({ service: "hourly", hours: "3", occasion: "Other", occasionDetails: "Gala" })).trip;
  assert.equal(hourly.occasionDetails, "Gala");
  assert.equal("occasionDetails" in tripPayload(ready({ occasion: "Other", occasionDetails: "Gala" })).trip, false);
});

test("the child-seat dropdown offers none, then 1 to the API's limit of 3", async () => {
  const { CAR_SEAT_OPTIONS, MAX_CAR_SEATS } = await import("../src/lib/newTrip.ts");
  assert.equal(MAX_CAR_SEATS, 3);
  assert.deepEqual(CAR_SEAT_OPTIONS.map((o) => o.value), ["", "1", "2", "3"]);
  assert.deepEqual(CAR_SEAT_OPTIONS.map((o) => o.label), ["None", "1 seat", "2 seats", "3 seats"]);
});

test("choosing None sends no seats, and a number sends that many", () => {
  assert.equal("carSeats" in tripPayload(ready({ carSeats: "" })).trip, false);
  assert.equal(tripPayload(ready({ carSeats: "2" })).trip.carSeats, 2);
});

/* ------------------------- a client with no account yet ------------------------- */

const person = { firstName: "Camila", lastName: "Saywali", email: " Camila@Saywali.com ", phone: " +1 206 555 0123 " };

test("a new client needs a full name, a real email and a phone", () => {
  assert.equal(newClientProblem(person), null);
  assert.match(newClientProblem({ ...person, firstName: "", lastName: "" }), /name/i);
  assert.match(newClientProblem({ ...person, email: "camila" }), /email/i);
  assert.match(newClientProblem({ ...person, email: "a@b" }), /email/i);
  assert.match(newClientProblem({ ...person, phone: "12" }), /phone/i);
  assert.equal(newClientProblem({ ...person, lastName: "" }), null, "one name is enough");
});

test("an untouched new-client form does not count as a client", () => {
  assert.equal(newClientStarted(emptyNewClient()), false);
  assert.equal(newClientStarted({ ...emptyNewClient(), phone: " 5" }), true);
});

test("the new client is sent trimmed, with the email in lower case", () => {
  assert.deepEqual(newClientPayload(person), { firstName: "Camila", lastName: "Saywali", email: "camila@saywali.com", phone: "+1 206 555 0123" });
});

test("a trip for a new client sends the new client and no customerId", () => {
  const body = tripPayload(ready({ clientId: "" }), undefined, person);
  assert.equal(body.newClient.email, "camila@saywali.com");
  assert.equal("customerId" in body, false);
  const existing = tripPayload(ready());
  assert.equal(existing.customerId, "5f9d88b8b54764421b7156c9");
  assert.equal("newClient" in existing, false);
});

test("a journey for a new client sends the new client and no customerId", () => {
  const legs = [ready({ clientId: "" }), ready({ clientId: "", when: "2026-11-03T14:30" })];
  const body = journeyPayload("", legs, undefined, person);
  assert.equal(body.newClient.firstName, "Camila");
  assert.equal("customerId" in body, false);
  assert.equal(body.legs.length, 2);
});

test("a trip is ready when a new client is filled in, even with no existing client chosen", () => {
  const leg = ready({ clientId: "" });
  assert.match(missingForJourney("", [leg]), /client/i);
  assert.equal(missingForJourney("", [leg], person), null);
  assert.match(missingForJourney("", [leg], { ...person, email: "" }), /email/i, "the new client is checked first");
});

test("what was typed in the search is put in the right box", () => {
  assert.deepEqual(prefillFromSearch("camila@saywali.com"), { email: "camila@saywali.com" });
  assert.deepEqual(prefillFromSearch("+1 (206) 555-0123"), { phone: "+1 (206) 555-0123" });
  assert.deepEqual(prefillFromSearch("Camila Saywali"), { firstName: "Camila", lastName: "Saywali" });
  assert.deepEqual(prefillFromSearch("  Camila  de la  Cruz "), { firstName: "Camila", lastName: "de la Cruz" });
  assert.deepEqual(prefillFromSearch("Camila"), { firstName: "Camila" });
  assert.deepEqual(prefillFromSearch("  "), {});
});

test("the operator is told when a booking made the client's account, and warned if the invitation failed", async () => {
  const { accountNotice } = await import("../src/lib/newTrip.ts");
  const client = { name: "Camila Saywali", email: "camila@saywali.com", created: true, inviteSent: true };
  assert.deepEqual(accountNotice(client), { tone: "ok", message: "Camila Saywali's account was created, and they were emailed to set a password." });

  const failed = accountNotice({ ...client, inviteSent: false });
  assert.equal(failed.tone, "warn");
  assert.match(failed.message, /could not be sent to camila@saywali\.com/);
  assert.match(failed.message, /Forgot password/);
});

test("a booking for an existing client says nothing about accounts", async () => {
  const { accountNotice } = await import("../src/lib/newTrip.ts");
  assert.equal(accountNotice(undefined), null);
  assert.equal(accountNotice(null), null);
  assert.equal(accountNotice({ name: "A", email: "a@b.co", created: false, inviteSent: false }), null);
});

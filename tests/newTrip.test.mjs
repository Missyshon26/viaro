import { test } from "node:test";
import assert from "node:assert/strict";
import { classesFor, emptyTripForm, missingFrom, pickupTime, tripPayload } from "../src/lib/newTrip.ts";

const ready = (over = {}) => ({
  ...emptyTripForm(),
  clientId: "5f9d88b8b54764421b7156c9",
  pickup: "Hotel Andra, Seattle",
  drop: "Sea-Tac Airport",
  when: "2026-11-02T14:30",
  vehicleClass: "sedan",
  ...over,
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
  assert.match(missingFrom(ready({ passengerPhone: "2065550100" })), /name/i);
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
      occasion: "Other",
      occasionDetails: "Anniversary",
      checkedBags: "0",
      carryOnBags: "2",
      passengerName: "Jo Park",
      passengerPhone: "2065550100",
    }),
  );
  assert.equal(full.trip.stops.length, 1);
  assert.equal(full.trip.meetAndGreet, true);
  assert.equal(full.trip.carSeats, 2);
  assert.equal(full.trip.occasionDetails, "Anniversary");
  assert.equal(full.trip.checkedBags, 0);
  assert.equal(full.trip.carryOnBags, 2);
  assert.equal(full.trip.passengerPhone, "2065550100");
});

test("a passenger phone without a name is not sent", () => {
  assert.equal("passengerPhone" in tripPayload(ready({ passengerPhone: "2065550100" })).trip, false);
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

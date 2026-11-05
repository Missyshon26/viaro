import { test } from "node:test";
import assert from "node:assert/strict";
import { passengerChanges } from "../src/lib/trips/passenger.ts";

const both = { name: "Alex Rider", phone: "+12065550148" };

test("nothing changed sends nothing", () => {
  assert.deepEqual(passengerChanges(both, { ...both }), {});
  assert.deepEqual(passengerChanges({ name: "", phone: "" }, { name: "  ", phone: " " }), {});
});

test("a phone on its own can be added, with no name", () => {
  assert.deepEqual(passengerChanges({ name: "", phone: "" }, { name: "", phone: "+12065550148" }), { passengerPhone: "+12065550148" });
});

test("a name on its own can be added, with no phone", () => {
  assert.deepEqual(passengerChanges({ name: "", phone: "" }, { name: "Alex Rider", phone: "" }), { passengerName: "Alex Rider" });
});

test("changing the phone keeps the name out of the request", () => {
  assert.deepEqual(passengerChanges(both, { name: "Alex Rider", phone: "+12065550999" }), { passengerPhone: "+12065550999" });
});

test("clearing just the phone clears just the phone", () => {
  assert.deepEqual(passengerChanges(both, { name: "Alex Rider", phone: "" }), { passengerPhone: null });
});

test("clearing both sends only the name as null: the API clears the phone with it", () => {
  assert.deepEqual(passengerChanges(both, { name: "", phone: "" }), { passengerName: null });
});

test("clearing the name but keeping the phone sends both, so the phone survives", () => {
  assert.deepEqual(passengerChanges(both, { name: "", phone: both.phone }), { passengerName: null, passengerPhone: both.phone });
});

test("clearing a phone that never had a name clears it", () => {
  assert.deepEqual(passengerChanges({ name: "", phone: "+12065550148" }, { name: "", phone: "" }), { passengerPhone: null });
});

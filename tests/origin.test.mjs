import test from "node:test";
import assert from "node:assert/strict";
import { bookedBy, paymentSummary } from "../src/lib/trips/origin.ts";

const NOW = Date.parse("2026-11-01T12:00:00Z");
const future = "2026-11-05T12:00:00Z";
const past = "2026-10-20T12:00:00Z";

test("says who created the booking", () => {
  assert.equal(bookedBy({}).label, "Web");
  assert.equal(bookedBy({ source: "customer" }).label, "Web");
  assert.equal(bookedBy({ source: "admin" }).label, "Admin");
  assert.equal(bookedBy({ legacy: { bookingSource: "Admin" } }).label, "Admin (old system)");
  assert.equal(bookedBy({ legacy: { bookingSource: "Web" } }).label, "Web (old system)");
  assert.equal(bookedBy({ legacy: {} }).imported, true);
});

test("a card payment is green, a refund amber, a failure red", () => {
  const base = { status: "assigned", scheduledAt: future };
  assert.equal(paymentSummary({ ...base, payment: { amount: 100, status: "paid" } }, NOW).tone, "success");
  assert.equal(paymentSummary({ ...base, payment: { amount: 100, status: "refunded" } }, NOW).tone, "warn");
  assert.equal(paymentSummary({ ...base, payment: { amount: 100, status: "failed" } }, NOW).tone, "danger");
});

test("an old-system payment is read from its old status", () => {
  const base = { status: "assigned", scheduledAt: past };
  assert.equal(paymentSummary({ ...base, legacy: { paymentStatus: "Paid" } }, NOW).tone, "success");
  assert.equal(paymentSummary({ ...base, legacy: { paymentStatus: "Refunded" } }, NOW).tone, "warn");
  assert.equal(paymentSummary({ ...base, legacy: { paymentStatus: "Failed" } }, NOW).tone, "danger");
});

test("no payment: red once the pickup has passed, amber before, grey if cancelled", () => {
  assert.equal(paymentSummary({ status: "assigned", scheduledAt: past }, NOW).tone, "danger");
  assert.equal(paymentSummary({ status: "pending", scheduledAt: future }, NOW).tone, "warn");
  assert.equal(paymentSummary({ status: "cancelled", scheduledAt: past }, NOW).tone, "neutral");
});

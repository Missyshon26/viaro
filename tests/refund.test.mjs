import { test } from "node:test";
import assert from "node:assert/strict";
import { newRequestId, parseRefundAmount, refundable } from "../src/lib/refund.ts";

test("what is left to refund is exact to the cent", () => {
  assert.equal(refundable({ amount: 100, refundedAmount: 0 }), 100);
  assert.equal(refundable({ amount: 100, refundedAmount: 30 }), 70);
  assert.equal(refundable({ amount: 0.3, refundedAmount: 0.1 }), 0.2);
  assert.equal(refundable({ amount: 50, refundedAmount: 50 }), 0);
  assert.equal(refundable({ amount: 50, refundedAmount: 60 }), 0);
});

test("an empty box is not an error, just not ready", () => {
  assert.deepEqual(parseRefundAmount("", 100), { amount: null, error: null });
  assert.deepEqual(parseRefundAmount("   ", 100), { amount: null, error: null });
});

test("dollars and cents are read, with a $ sign or commas", () => {
  assert.equal(parseRefundAmount("25", 100).amount, 25);
  assert.equal(parseRefundAmount("25.5", 100).amount, 25.5);
  assert.equal(parseRefundAmount("$25.50", 100).amount, 25.5);
  assert.equal(parseRefundAmount("1,000", 2000).amount, 1000);
  assert.equal(parseRefundAmount("100", 100).amount, 100);
});

test("zero, negatives, letters and fractions of a cent are refused with a reason", () => {
  for (const bad of ["0", "0.00", "-5", "abc", "12.345", "1e3", "5.", ".5"]) {
    const r = parseRefundAmount(bad, 100);
    assert.equal(r.amount, null, bad);
    assert.ok(r.error, bad);
  }
});

test("more than is left is refused, naming the most that can be refunded", () => {
  const r = parseRefundAmount("100.01", 100);
  assert.equal(r.amount, null);
  assert.match(r.error, /\$100\.00/);
  assert.equal(parseRefundAmount("70.01", 70).amount, null);
  assert.equal(parseRefundAmount("70", 70).amount, 70);
});

test("each dialog gets its own request id", () => {
  const a = newRequestId();
  assert.match(a, /^[A-Za-z0-9_-]{8,64}$/);
  assert.notEqual(a, newRequestId());
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { balanceOf, paidTotal, refundableTotal } from "../src/lib/balance.ts";

const paid = (amount, refundedAmount = 0) => ({ amount, refundedAmount });

test("an unpaid booking has no balance of this kind", () => {
  assert.equal(balanceOf({ estimatedFare: 200 }), 0);
});

test("an upgrade leaves the difference owed, and paying it settles the booking", () => {
  assert.equal(balanceOf({ estimatedFare: 160, payment: paid(100) }), 60);
  assert.equal(balanceOf({ estimatedFare: 160, payment: paid(100), extraPayments: [paid(60)] }), 0);
});

test("a downgrade shows the overpayment as a negative balance until it is refunded", () => {
  assert.equal(balanceOf({ estimatedFare: 70, payment: paid(100) }), -30);
  assert.equal(balanceOf({ estimatedFare: 70, payment: paid(100, 30) }), 0);
});

test("cents add up exactly", () => {
  assert.equal(balanceOf({ estimatedFare: 0.3, payment: paid(0.1), extraPayments: [paid(0.2)] }), 0);
  assert.equal(paidTotal({ payment: paid(0.1), extraPayments: [paid(0.2)] }), 0.3);
});

test("what can be refunded spans every payment and ignores what is already refunded", () => {
  assert.equal(refundableTotal({ payment: paid(100, 40), extraPayments: [paid(60), paid(20, 20)] }), 120);
});

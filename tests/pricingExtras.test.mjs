import { test } from "node:test";
import assert from "node:assert/strict";
import { ordinal, parseExtras } from "../src/lib/pricingExtras.ts";

const good = { fuelSurchargePct: "8", taxPct: "9", welcomeDiscount: "20", loyaltyDiscount: "15", loyaltyEveryNth: "4" };

test("good values become the payload", () => {
  const r = parseExtras(good);
  assert.equal(r.ok, true);
  assert.deepEqual(r.payload, { fuelSurchargePct: 8, taxPct: 9, welcomeDiscount: 20, loyaltyDiscount: 15, loyaltyEveryNth: 4 });
});

test("a $ sign, a % sign, commas and cents are understood", () => {
  const r = parseExtras({ fuelSurchargePct: "8", taxPct: "8.5%", welcomeDiscount: "$20.50", loyaltyDiscount: "1,000", loyaltyEveryNth: "4" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.payload, { fuelSurchargePct: 8, taxPct: 8.5, welcomeDiscount: 20.5, loyaltyDiscount: 1000, loyaltyEveryNth: 4 });
});

test("zero means none, and is allowed", () => {
  const r = parseExtras({ ...good, taxPct: "0", welcomeDiscount: "0", loyaltyDiscount: "0" });
  assert.equal(r.ok, true);
  assert.equal(r.payload.taxPct, 0);
});

test("a blank box is an error, never a zero", () => {
  for (const key of ["fuelSurchargePct", "taxPct", "welcomeDiscount", "loyaltyDiscount", "loyaltyEveryNth"]) {
    const r = parseExtras({ ...good, [key]: "  " });
    assert.equal(r.ok, false, key);
    assert.ok(r.errors[key], key);
  }
});

test("nonsense and out-of-range values are refused, each against its own box", () => {
  const r = parseExtras({ fuelSurchargePct: "31", taxPct: "31", welcomeDiscount: "-5", loyaltyDiscount: "abc", loyaltyEveryNth: "1" });
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(r.errors).sort(), ["fuelSurchargePct", "loyaltyDiscount", "loyaltyEveryNth", "taxPct", "welcomeDiscount"]);
  assert.equal(parseExtras({ ...good, welcomeDiscount: "1001" }).ok, false);
  assert.equal(parseExtras({ ...good, loyaltyEveryNth: "51" }).ok, false);
  assert.equal(parseExtras({ ...good, loyaltyEveryNth: "2.5" }).ok, false);
  assert.equal(parseExtras({ ...good, welcomeDiscount: "5.555" }).ok, false);
});

test("every-Nth reads as an ordinal", () => {
  assert.deepEqual([2, 3, 4, 11, 12, 13, 21, 22, 50].map(ordinal), ["2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "50th"]);
});

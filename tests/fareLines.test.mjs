import { test } from "node:test";
import assert from "node:assert/strict";
import { fareLines } from "../src/lib/fareLines.ts";

test("an old booking, or one with nothing added, shows no split", () => {
  assert.deepEqual(fareLines(undefined, 140), []);
  assert.deepEqual(fareLines({ classFare: 140 }, 140), []);
  assert.deepEqual(fareLines({ subtotal: 140, gratuity: 0, discount: 0, tax: 0 }, 140), []);
  assert.deepEqual(fareLines({ subtotal: 140, tax: 5 }, undefined), []);
});

test("tip, discount and tax follow the trip price, then the total", () => {
  const lines = fareLines(
    { subtotal: 140, gratuityPct: 10, gratuity: 14, discountKind: "welcome", discount: 20, taxPct: 10, tax: 13.4 },
    147.4,
  );
  assert.deepEqual(lines.map((l) => l.label), ["Trip price", "Tip (10%)", "Welcome discount", "Tax (10%)", "Total"]);
  assert.deepEqual(lines.map((l) => l.amount), [140, 14, -20, 13.4, 147.4]);
  assert.equal(lines.at(-1).total, true);
  // The lines add up to the total.
  const sum = lines.slice(0, -1).reduce((s, l) => s + l.amount, 0);
  assert.equal(Math.round(sum * 100) / 100, 147.4);
});

test("only the lines that applied are listed", () => {
  const lines = fareLines({ subtotal: 140, discountKind: "loyalty", discount: 15 }, 125);
  assert.deepEqual(lines.map((l) => l.label), ["Trip price", "Loyalty discount", "Total"]);
});

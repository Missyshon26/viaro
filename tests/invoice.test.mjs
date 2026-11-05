import { test } from "node:test";
import assert from "node:assert/strict";
import { invoiceNumber } from "../src/lib/invoice.ts";

const id = "6720a1b2c3d4e5f6a7f8e430";

test("uses the running trip number printed on the invoice", () => {
  assert.equal(invoiceNumber({ _id: id, tripNo: "13777" }), "13777");
});

test("falls back to the old site's trip number for imported bookings", () => {
  assert.equal(invoiceNumber({ _id: id, legacy: { tripNo: "13776" } }), "13776");
});

test("prefers tripNo over the legacy number", () => {
  assert.equal(invoiceNumber({ _id: id, tripNo: "13777", legacy: { tripNo: "13776" } }), "13777");
});

test("without either, uses the INV- form the backend prints", () => {
  assert.equal(invoiceNumber({ _id: id }), "INV-F8E430");
  assert.equal(invoiceNumber({ _id: id, tripNo: "", legacy: { tripNo: null } }), "INV-F8E430");
});

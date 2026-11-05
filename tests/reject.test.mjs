import { test } from "node:test";
import assert from "node:assert/strict";
import { canReject } from "../src/lib/trips/reject.ts";

test("a request can be rejected until a chauffeur takes it", () => {
  assert.equal(canReject({ status: "pending" }), true);
  assert.equal(canReject({ status: "dispatched" }), true);
});

test("once assigned, in progress, completed or cancelled it cannot", () => {
  for (const status of ["assigned", "in_progress", "completed", "cancelled"]) assert.equal(canReject({ status }), false, status);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { stageOf, isOverdue } from "../src/lib/trips/stage.ts";

test("a completed journey is counted once even when its booking remains assigned", () => {
  const rows = [
    { status: "assigned", trip: { status: "completed" } },
    { status: "assigned", trip: { status: "started" } },
    { status: "dispatched" },
    { status: "cancelled" },
  ];
  assert.deepEqual(rows.map(stageOf), ["completed", "in_progress", "awaiting", "cancelled"]);
  assert.equal(rows.filter((row) => ["assigned", "in_progress"].includes(stageOf(row))).length, 1);
});

test("assigned bookings without a populated trip are not awaiting dispatch", () => {
  assert.equal(stageOf({ status: "assigned" }), "assigned");
});

test("pickup earlier today is overdue, future or finished journeys are not", () => {
  const now = Date.parse("2026-10-22T12:00:00Z");
  assert.equal(isOverdue({ status: "assigned", scheduledAt: "2026-10-22T11:30:00Z" }, now), true);
  assert.equal(isOverdue({ status: "assigned", scheduledAt: "2026-10-22T13:00:00Z" }, now), false);
  assert.equal(isOverdue({ status: "assigned", scheduledAt: "2026-10-22T11:30:00Z", trip: { status: "completed" } }, now), false);
  assert.equal(isOverdue({ status: "pending", scheduledAt: "invalid" }, now), false);
});

test("completed and cancelled trips are finished; the others are not", async () => {
  const { isFinishedStage } = await import("../src/lib/trips/stage.ts");
  assert.equal(isFinishedStage("completed"), true);
  assert.equal(isFinishedStage("cancelled"), true);
  for (const stage of ["awaiting", "assigned", "in_progress"]) assert.equal(isFinishedStage(stage), false, stage);
});

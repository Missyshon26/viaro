export type TripStage = "awaiting" | "pool" | "assigned" | "in_progress" | "completed" | "cancelled";

export interface JourneyState {
  status: string;
  scheduledAt?: string;
  trip?: { status: string };
}

// A booking remains assigned after completion. Prefer the trip lifecycle so a
// completed journey cannot also inflate active-trip counts.
export function stageOf(row: JourneyState): TripStage {
  if (row.trip?.status === "completed") return "completed";
  if (row.trip?.status === "cancelled" || row.status === "cancelled") return "cancelled";
  if (row.trip?.status === "started") return "in_progress";
  if (row.trip || row.status === "assigned") return "assigned";
  if (row.status === "dispatched") return "pool";
  return "awaiting";
}

export function isOverdue(row: JourneyState, now = Date.now()): boolean {
  const stage = stageOf(row);
  if (stage === "completed" || stage === "cancelled" || !row.scheduledAt) return false;
  return new Date(row.scheduledAt).getTime() < now;
}

import type { Booking } from "@/lib/api/types";

/**
 * Changes the customer made after booking.
 *
 * This exists because the current value alone is not enough to work from: a chauffeur
 * given "Fairmont Olympic Hotel" cannot tell whether that was always the pickup or
 * replaced another address an hour ago, and an operator fielding "why is my driver at
 * the wrong place?" needs the before as much as the after.
 *
 * Rendered only when there is something to show — an unchanged booking gets no panel
 * rather than an empty one.
 */
const FIELD_LABEL: Record<string, string> = {
  pickup: "Pickup",
  drop: "Drop-off",
  vehicleClass: "Vehicle",
  scheduledAt: "Pickup time",
  stops: "Stops",
  flight: "Flight",
  occasion: "Occasion",
  luggage: "Luggage",
  passenger: "Passenger",
  passengers: "Passengers",
  notes: "Notes",
};

export function Amendments({ booking }: { booking: Booking }) {
  const amendments = booking.amendments ?? [];
  if (amendments.length === 0) return null;

  return (
    <div className="rounded-field border border-chart-warn/40 bg-chart-warn/5 p-4">
      <p className="text-note font-bold uppercase tracking-wider text-chart-warn">
        Changed after booking · {amendments.length}
      </p>

      <ul className="mt-3 space-y-3">
        {[...amendments].reverse().map((change, index) => (
          <li key={`${change.field}-${change.at}-${index}`}>
            <p className="text-note font-medium text-fg">
              {FIELD_LABEL[change.field] ?? change.field}
            </p>
            <p className="mt-0.5 text-note text-fg-body">
              <span className="text-fg-muted line-through">{change.from}</span>
              <span aria-hidden className="mx-1.5 text-fg-faint">
                →
              </span>
              <span className="font-bold text-fg">{change.to}</span>
            </p>
            <p className="mt-0.5 text-label text-fg-muted">
              by the {change.by} ·{" "}
              {new Date(change.at).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

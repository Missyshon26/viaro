"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Badge, Card, Kicker, WarnBox } from "@/components/ui/Surfaces";
import { Amendments } from "@/components/ops/Amendments";
import { TripChat } from "@/components/ops/TripChat";
import { Button, buttonClass } from "@/components/ui/Button";
import {
  getTrip,
  startTrip,
  completeTrip,
  cancelTrip,
  getFlight,
  type FlightDetails,
} from "@/lib/api/driver";
import { ApiError } from "@/lib/api/client";
import type { Trip } from "@/lib/api/types";

/** Figma desktop "16 · Trip detail", palette B (frame 57:5310, 1280×786). */

const SERVICE_LABEL: Record<string, string> = {
  point2point: "Point to point",
  airport: "Airport",
  hourly: "Hourly",
};

const reference = (id: string) => `VRO-${id.slice(-6).toUpperCase()}`;

export function TripDetail({ id }: { id: string }) {
  const [trip, setTrip] = useState<Trip | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Keyed by `id`, so this is the effect where a stale response actually shows the wrong
   * record: navigating from one trip to another let a slower first request resolve after
   * the second and render the previous trip under the new URL.
   */
  const load = useCallback(async (isCurrent: () => boolean = () => true) => {
    try {
      const result = await getTrip(id);
      if (!isCurrent()) return;
      setTrip(result);
      setError(null);
    } catch (err) {
      if (!isCurrent()) return;
      setError(err instanceof ApiError ? err.message : "Could not load this trip");
    }
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    void load(() => !cancelled);
    return () => {
      cancelled = true;
    };
  }, [load]);

  const booking = trip?.booking;

  return (
    <div className="mx-auto max-w-[1050px]">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[1.5rem] font-bold tracking-tight text-fg">
          {trip ? reference(trip.bookingId) : "Trip"}
        </h1>
        {trip ? <TripStatusPill status={trip.status} /> : null}
        <Link href="/schedule" className={`${buttonClass("secondary")} ml-auto`}>
          Schedule
        </Link>
      </div>

      {error ? <p className="mt-4 text-note font-bold text-danger">{error}</p> : null}

      {/*
        Above the journey card on purpose: a chauffeur reading the pickup address needs
        to know first if it moved, not after they have memorised the old one.
      */}
      {booking?.amendments && booking.amendments.length > 0 ? (
        <div className="mt-4">
          <Amendments booking={booking} />
        </div>
      ) : null}

      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:items-start">
        <div className="space-y-4">
          <Card className="p-5">
            <Kicker>Journey</Kicker>
            {booking ? (
              <dl className="mt-4 space-y-4 text-meta">
                <div>
                  <dt className="text-fg-muted">Pickup</dt>
                  <dd className="mt-1 font-bold text-fg">{booking.pickup.address}</dd>
                </div>
                <div>
                  <dt className="text-fg-muted">Drop-off</dt>
                  <dd className="mt-1 font-bold text-fg">{booking.drop.address}</dd>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <dt className="text-fg-muted">When</dt>
                    <dd className="mt-1 text-fg">
                      {trip?.scheduledAtLocal ??
                        new Date(booking.scheduledAt).toLocaleString("en-US", {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-fg-muted">Service</dt>
                    <dd className="mt-1 text-fg">
                      {SERVICE_LABEL[booking.tripType] ?? booking.tripType} ·{" "}
                      {booking.vehicleClass}
                    </dd>
                  </div>
                </div>
                {booking.flightDetails?.flightNumber ? (
                  <div>
                    <dt className="text-fg-muted">Flight</dt>
                    <dd className="mt-1 font-bold text-fg">
                      {booking.flightDetails.flightNumber}
                    </dd>
                  </div>
                ) : null}
              </dl>
            ) : (
              <p className="mt-4 text-note text-fg-muted">Loading…</p>
            )}
          </Card>

          {trip?.customer ? (
            <Card className="p-5">
              <Kicker>Passenger</Kicker>
              <p className="mt-3 text-card font-bold text-fg">{trip.customer.name}</p>
              <p className="mt-1 text-note text-fg-muted">{trip.customer.phone}</p>
            </Card>
          ) : null}

          {trip ? (
            <TripChat
              tripId={trip._id}
              passengerName={trip.customer?.name ?? null}
              closed={trip.status === "completed" || trip.status === "cancelled"}
            />
          ) : null}

          {booking?.flightDetails?.flightNumber ? (
            <FlightCard flightNumber={booking.flightDetails.flightNumber} />
          ) : null}

          {/* Spec section 8 rule 2 — the fare is never sent to a chauffeur. */}
          <WarnBox title="You are paid a payout, not the fare">
            What the passenger paid is not shown to chauffeurs. Your payout for this trip
            appears in Earnings once it completes.
          </WarnBox>
        </div>

        <div className="space-y-4">
          <Card className="p-5">
            <Kicker>Move this trip on</Kicker>
            <div className="mt-4">
              {trip ? <Lifecycle trip={trip} onDone={load} /> : null}
            </div>
          </Card>

          <Card className="p-5">
            <Kicker>Timestamps</Kicker>
            <dl className="mt-4 space-y-2 text-note">
              {(
                [
                  ["Assigned", trip?.timestamps.assigned],
                  ["Accepted", trip?.timestamps.accepted],
                  ["Started", trip?.timestamps.started],
                  ["Completed", trip?.timestamps.completed],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4">
                  <dt className="text-fg-muted">{label}</dt>
                  <dd className="text-fg">
                    {value
                      ? new Date(value).toLocaleTimeString("en-US", {
                          hour: "numeric",
                          minute: "2-digit",
                        })
                      : "—"}
                  </dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}

/** One colour per lifecycle state, so the header reads at a glance. */
function TripStatusPill({ status }: { status: string }) {
  const tone =
    status === "completed"
      ? "border-success/40 bg-success/10 text-success"
      : status === "cancelled"
        ? "border-border bg-surface text-fg-muted"
        : status === "started"
          ? "border-accent/40 bg-accent-soft text-accent-strong"
          : "border-border bg-surface text-fg-body";

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-label font-bold capitalize ${tone}`}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
      {status}
    </span>
  );
}

/**
 * accepted -> started -> completed. Each transition is its own endpoint, and the API
 * rejects one taken out of order, so only the next legal step is offered.
 */
function Lifecycle({ trip, onDone }: { trip: Trip; onDone: () => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<unknown>) =>
    start(async () => {
      try {
        await fn();
        setError(null);
        onDone();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "That did not work");
      }
    });

  /**
   * A finished trip and an abandoned one are not the same news, and one muted line said
   * both. Completing is the point of the job — the fare settles and the chauffeur is
   * paid — so it reads as an achievement; a cancellation is a neutral fact.
   */
  if (trip.status === "completed") {
    return (
      <div className="rounded-field border border-success/40 bg-success/10 p-4">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-success/20 text-success"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4.5 w-4.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m5 12.5 4.5 4.5L19 7.5" />
            </svg>
          </span>
          <div className="min-w-0">
            <p className="text-body font-bold text-success">Trip completed</p>
            {trip.timestamps.completed ? (
              <p className="mt-0.5 text-note text-fg-muted">
                Finished{" "}
                {new Date(trip.timestamps.completed).toLocaleString("en-US", {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </p>
            ) : null}
          </div>
        </div>

        <p className="mt-3 text-note leading-relaxed text-fg-body">
          The fare has settled and your payout is on its way to your wallet.
        </p>
        <Link
          href="/earnings"
          className="mt-3 inline-flex h-9 items-center rounded-field bg-success px-4 text-meta font-bold text-white"
        >
          See it in Earnings
        </Link>
      </div>
    );
  }

  if (trip.status === "cancelled") {
    return (
      <div className="rounded-field border border-border bg-surface p-4">
        <p className="text-body font-bold text-fg">Trip cancelled</p>
        {trip.cancellation?.reason ? (
          <p className="mt-1 text-note leading-relaxed text-fg-body">
            {trip.cancellation.reason}
          </p>
        ) : null}
        <p className="mt-2 text-note text-fg-muted">
          Nothing further to do here — it stays on your record for reference.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error ? <p className="text-label text-danger">{error}</p> : null}

      {trip.status === "accepted" ? (
        <Button variant="accent" disabled={pending} onClick={() => run(() => startTrip(trip._id))}>
          {pending ? "Working…" : "Start the trip"}
        </Button>
      ) : null}

      {trip.status === "started" ? (
        <Button
          variant="accent"
          disabled={pending}
          onClick={() => run(() => completeTrip(trip._id))}
        >
          {pending ? "Working…" : "Complete the trip"}
        </Button>
      ) : null}

      <Button
        variant="secondary"
        disabled={pending}
        onClick={() => run(() => cancelTrip(trip._id))}
      >
        Cancel this trip
      </Button>
      <p className="text-note leading-relaxed text-fg-muted">
        Cancelling late can attract a penalty, which delays your ride alerts.
      </p>
    </div>
  );
}

/**
 * Live arrival for an airport pickup. `GET /flight/:flightNumber` is driver/admin only,
 * which is exactly why this board lives here and not in the passenger app.
 */
function FlightCard({ flightNumber }: { flightNumber: string }) {
  const [flight, setFlight] = useState<FlightDetails | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getFlight(flightNumber)
      .then((data) => {
        if (!cancelled) setFlight(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Could not read the flight");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [flightNumber]);

  const time = (value?: string | null) =>
    value
      ? new Date(value).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
      : "—";

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center gap-3">
        <Kicker>Flight {flightNumber}</Kicker>
        {flight ? (
          <span className="ml-auto">
            <Badge>{flight.status}</Badge>
          </span>
        ) : null}
      </div>

      {error ? <p className="mt-3 text-note text-danger">{error}</p> : null}

      {flight ? (
        <>
          <dl className="mt-4 space-y-2 text-meta">
            <div className="flex justify-between gap-4">
              <dt className="text-fg-muted">Scheduled arrival</dt>
              <dd className="font-bold text-fg">{time(flight.scheduledArrival)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-fg-muted">Actual arrival</dt>
              <dd className="font-bold text-fg">{time(flight.actualArrival)}</dd>
            </div>
            {flight.arrivalAirport ? (
              <div className="flex justify-between gap-4">
                <dt className="text-fg-muted">Airport</dt>
                <dd className="text-fg">{flight.arrivalAirport}</dd>
              </div>
            ) : null}
          </dl>

          {flight.placeholder ? (
            <p className="mt-4 text-note leading-relaxed text-fg-muted">
              Generated data — no flight provider is configured on the backend, so treat
              these times as a placeholder.
            </p>
          ) : (
            <p className="mt-4 text-note text-fg-muted">Source: {flight.provider}</p>
          )}
        </>
      ) : !error ? (
        <p className="mt-3 text-note text-fg-muted">Reading the arrival board…</p>
      ) : null}
    </Card>
  );
}

"use client";

import { use, useCallback, useEffect, useState, type ReactNode } from "react";
import { formatPhone } from "@/lib/format";
import Link from "next/link";
import { ConsolePage, formatDateTime, money } from "@/components/ui/DataTable";
import {
  Avatar,
  NotAvailable,
  StatusBadge,
  Skeleton,
  reference,
} from "@/components/ui/Dashboard";
import {
  IconCalendar,
  IconCar,
  IconCheck,
  IconClock,
  IconMoney,
  IconPenalty,
  IconPin,
  IconPlane,
  IconRoute,
  IconStar,
  IconUsers,
} from "@/components/ui/Icons";
import { errorText } from "@/lib/api/client";
import { getBooking } from "@/lib/api/booking";
import { getFlight, type FlightDetails } from "@/lib/api/admin";
import { Amendments } from "@/components/ops/Amendments";
import { ReleaseCredit } from "@/components/ops/ReleaseCredit";
import { getTrip, listMyTrips } from "@/lib/api/driver";
import { TripStatusControl } from "@/components/ops/TripStatusControl";
import { findVehicleClass, vehicleLabel, TRIP_TYPE_LABEL } from "@/lib/vehicles";
import type { Booking, BookingCancellation, Trip } from "@/lib/api/types";
import { useLiveChanges } from "@/lib/live/useLiveChanges";

type FullBooking = Booking & {
  customerId: string | { _id: string; name: string; email?: string; phone?: string };
  scheduledAtLocal?: string;
};

/**
 * One booking, and the trip it became.
 *
 * The two are separate records: a booking is what the customer asked for, a trip is what
 * a chauffeur is doing about it. A booking only grows a trip once dispatch assigns
 * someone, so the trip half of this page is legitimately absent much of the time and
 * says so rather than rendering empty fields.
 *
 * Finding the trip takes a search, not a lookup: GET /trips/:id resolves a TRIP id, and
 * nothing maps a booking to its trip. So the page pages the admin's trip list and
 * matches on bookingId, then re-fetches that trip by id for the shaped payload — which
 * is the only one carrying the driver and customer contact blocks.
 */
/** How each actor is described in the console, rather than showing the raw enum. */
const CANCELLER_ROLE: Record<string, string> = {
  customer: "passenger",
  driver: "chauffeur",
  admin: "operations",
};

export default function BookingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const [booking, setBooking] = useState<FullBooking | null>(null);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [tripSearched, setTripSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * `isCurrent` guards every setState against a stale response.
   *
   * These fetches had no cancellation check, so navigating quickly from one trip to
   * another could let the FIRST request resolve after the second — rendering the previous
   * trip's record under the new URL, and leaving it there until something else triggered
   * a reload. AssignDriver.tsx in this same codebase already guards the identical shape.
   */
  const load = useCallback(async (isCurrent: () => boolean = () => true) => {
    try {
      const result = await getBooking(id);
      if (!isCurrent()) return;
      setBooking(result as FullBooking);
    } catch (err) {
      if (!isCurrent()) return;
      setError(errorText(err, "Could not load this booking"));
      return;
    }

    // Best effort: the booking is the page, the trip is extra context.
    try {
      const page = await listMyTrips({ limit: 100 });
      const match = (page.items ?? []).find((t) => String(t.bookingId) === id);
      const resolved = match ? await getTrip(match._id) : null;
      if (!isCurrent()) return;
      setTrip(resolved);
    } catch {
      /* Leave the trip panel in its "none yet" state. */
    } finally {
      if (isCurrent()) setTripSearched(true);
    }
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    void load(() => !cancelled);
    return () => {
      cancelled = true;
    };
  }, [load]);

  // A chauffeur accepting, or another operator changing the status, while this page is open.
  useLiveChanges(["booking", "trip", "dispatch"], () => void load());

  if (error) {
    return (
      <ConsolePage title="Booking" description="">
        <div className="rounded-card border border-danger/30 bg-danger/5 px-5 py-4">
          <p className="text-note font-bold text-danger">{error}</p>
          <Link
            href="/trips"
            className="mt-3 inline-block text-note font-bold text-accent hover:underline"
          >
            ← Back to trips
          </Link>
        </div>
      </ConsolePage>
    );
  }

  if (!booking) {
    return (
      <ConsolePage title="Booking" description="Loading…">
        <div className="grid gap-4 lg:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-48 rounded-card" />
          ))}
        </div>
      </ConsolePage>
    );
  }

  /**
   * Prefer the booking's record; fall back to the trip's for anything cancelled before
   * this trail existed, so older rows still name a role even without an author.
   */
  const cancellation: BookingCancellation | undefined =
    booking.cancellation ??
    (trip?.cancellation && booking.status === "cancelled"
      ? {
          reason: trip.cancellation.reason,
          by: trip.cancellation.cancelledBy ?? "customer",
          byUserId: trip.cancellation.cancelledByUserId,
          byName: trip.cancellation.cancelledByName,
          at: trip.timestamps.completed ?? booking.updatedAt ?? booking.createdAt,
        }
      : undefined);

  const vehicle = findVehicleClass(booking.vehicleClass);
  const customer =
    booking.customerId && typeof booking.customerId === "object" ? booking.customerId : null;
  const overCapacity =
    booking.passengers !== undefined &&
    vehicle !== undefined &&
    booking.passengers > vehicle.seats;

  return (
    <>
      {/*
        Sits above the page heading rather than in the action slot: going back is a
        navigation affordance, not an action on this record, and it belongs where the
        eye starts rather than opposite the title competing with the status.
      */}
      <div className="mx-auto mb-4 max-w-[1400px]">
        <Link
          href="/trips"
          className="inline-flex h-9 items-center gap-2 rounded-field border border-border bg-surface-raised px-3.5 text-meta font-bold text-fg-body shadow-[var(--shadow-card)] transition-colors hover:border-accent hover:text-fg"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Back to trips
        </Link>
      </div>

    <ConsolePage
      title={reference(booking._id)}
      description={`${TRIP_TYPE_LABEL[booking.tripType] ?? booking.tripType} · ${
        booking.scheduledAtLocal ?? formatDateTime(booking.scheduledAt)
      }`}
      action={<StatusBadge status={booking.status} />}
    >
      {/* ------------------------------ headline strip ------------------------- */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label="Estimated fare" value={money(booking.estimatedFare)} icon={<IconMoney size={16} />} />
        <Tile
          label="Vehicle"
          value={vehicleLabel(booking.vehicleClass)}
          hint={vehicle ? `${vehicle.seats} seats · ${vehicle.bags} bags` : "Unknown class"}
          icon={<IconCar size={16} />}
        />
        <Tile
          label="Passengers"
          value={booking.passengers !== undefined ? String(booking.passengers) : "—"}
          hint={booking.passengers === undefined ? "Not recorded" : undefined}
          icon={<IconUsers size={16} />}
          tone={overCapacity ? "danger" : "default"}
        />
        <Tile
          label="Trip"
          value={trip ? reference(trip._id) : tripSearched ? "Not created" : "…"}
          hint={trip ? trip.status : "No chauffeur assigned yet"}
          icon={<IconRoute size={16} />}
        />
      </div>

      {booking.amendments && booking.amendments.length > 0 ? (
        <div className="mt-4">
          <Amendments booking={booking} />
        </div>
      ) : null}

      {overCapacity ? (
        <p className="mt-4 rounded-field border border-danger/30 bg-danger/5 px-4 py-3 text-note font-bold text-danger">
          {booking.passengers} passengers booked into a {vehicle!.seats}-seat{" "}
          {vehicle!.label}. The party does not fit the class that was booked.
        </p>
      ) : null}

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        {/* --------------------------------- left -------------------------------- */}
        <div className="space-y-5">
          <Section icon={<IconRoute size={14} />} title="Journey">
            <ol className="relative space-y-5 pl-6">
              <span aria-hidden className="absolute bottom-2 left-[5px] top-2 w-px bg-border" />
              <Leg
                label="Pickup"
                address={booking.pickup.address}
                lat={booking.pickup.lat}
                lng={booking.pickup.lng}
                tone="accent"
              />
              <Leg
                label={booking.tripType === "hourly" ? "First stop" : "Drop-off"}
                address={booking.drop.address}
                lat={booking.drop.lat}
                lng={booking.drop.lng}
                tone="muted"
              />
            </ol>
            <p className="mt-4 text-note leading-relaxed text-fg-muted">
              Coordinates are the city centre unless a geocoder is configured — the
              addresses are what the passenger typed.
            </p>
          </Section>

          <Section icon={<IconClock size={14} />} title="Timing">
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <Field
                label="Pickup"
                value={booking.scheduledAtLocal ?? formatDateTime(booking.scheduledAt)}
                strong
              />
              <Field label="City" value={booking.city ?? "—"} capitalize />
              <Field label="Booked" value={formatDateTime(booking.createdAt)} />
              <Field label="Last updated" value={formatDateTime(booking.updatedAt)} />
            </dl>
            <p className="mt-3 text-note text-fg-muted">
              All times are America/Los_Angeles, the platform standard.
            </p>
          </Section>

          {booking.flightDetails ? (
            <Section icon={<IconPlane size={14} />} title="Flight">
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                <Field
                  label="Flight number"
                  value={booking.flightDetails.flightNumber}
                  mono
                  strong
                />
                <Field
                  label="Booked arrival"
                  value={
                    booking.flightDetails.scheduledArrival
                      ? formatDateTime(booking.flightDetails.scheduledArrival)
                      : "Not supplied"
                  }
                  muted={!booking.flightDetails.scheduledArrival}
                />
              </dl>
              <FlightBoard flightNumber={booking.flightDetails.flightNumber} />
            </Section>
          ) : null}

          <Section icon={<IconCalendar size={14} />} title="Identifiers">
            <dl className="grid gap-x-6 gap-y-3">
              <Field label="Booking id" value={booking._id} mono />
              <Field
                label="Customer id"
                value={customer?._id ?? String(booking.customerId)}
                mono
              />
              {trip ? <Field label="Trip id" value={trip._id} mono /> : null}
            </dl>
          </Section>
        </div>

        {/* -------------------------------- right -------------------------------- */}
        <div className="space-y-5">
          <Section icon={<IconUsers size={14} />} title="Customer">
            <div className="flex items-center gap-3">
              <Avatar name={customer?.name} size={40} />
              <div className="min-w-0">
                <p className="truncate text-action font-bold text-fg">
                  {customer?.name ?? "—"}
                </p>
                {customer?.email ? (
                  <p className="truncate text-note text-fg-muted">{customer.email}</p>
                ) : null}
              </div>
            </div>
            <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <Field label="Phone" value={formatPhone(customer?.phone) || "—"} />
              <Field
                label="Favourite chauffeur"
                value={booking.favoriteDriverId ? "Requested" : "None"}
                muted={!booking.favoriteDriverId}
              />
            </dl>
          </Section>

          <Section icon={<IconCar size={14} />} title="Chauffeur and trip">
            {!tripSearched ? (
              <Skeleton className="h-24" />
            ) : !trip ? (
              <NotAvailable
                title="No trip yet"
                reason="A trip is created when dispatch assigns a chauffeur or one claims the booking from the pool. Until then there is nothing to show here beyond the booking itself."
              />
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <Avatar name={trip.driver?.name ?? "Chauffeur"} size={40} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-action font-bold text-fg">
                      {trip.driver?.name ?? "Chauffeur"}
                    </p>
                    <p className="truncate text-note text-fg-muted">
                      {vehicleLabel(trip.driver?.vehicleClass)}
                      {trip.driver?.phone ? ` · ${formatPhone(trip.driver.phone)}` : ""}
                    </p>
                  </div>
                  {trip.driver?.rating ? (
                    <span className="flex shrink-0 items-center gap-1 text-meta font-bold text-fg">
                      <IconStar size={13} className="text-chart-warn" />
                      {trip.driver.rating.toFixed(1)}
                    </span>
                  ) : null}
                </div>

                <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
                  <Field label="Trip status" value={trip.status} capitalize strong />
                  <Field
                    label="Settled fare"
                    value={trip.fareAmount !== undefined ? money(trip.fareAmount) : "—"}
                  />
                  <div>
                    <Field
                      label="Credit applied"
                      value={trip.creditApplied ? money(trip.creditApplied) : "None"}
                      muted={!trip.creditApplied}
                    />
                    {/* Applying credit was one-way until now: a passenger who changed
                        their mind had no route back and neither did operations. */}
                    {trip.creditApplied ? (
                      <ReleaseCredit
                        tripId={trip._id}
                        applied={trip.creditApplied}
                        onReleased={() => void load()}
                      />
                    ) : null}
                  </div>
                  <Field
                    label="Penalty"
                    value={trip.penaltyApplied ? "Applied" : "None"}
                    muted={!trip.penaltyApplied}
                  />
                </dl>

                <div className="mt-5 border-t border-border-subtle pt-4">
                  <p className="text-note font-medium uppercase tracking-wider text-fg-muted">
                    Move this trip
                  </p>
                  <div className="mt-3">
                    <TripStatusControl
                      tripId={trip._id}
                      currentStatus={trip.status}
                      onChanged={load}
                    />
                  </div>
                </div>
              </>
            )}
          </Section>

          {trip ? (
            <Section icon={<IconCheck size={14} />} title="Trip timeline">
              <ol className="space-y-3">
                {(
                  [
                    ["requested", "Requested"],
                    ["assigned", "Assigned"],
                    ["accepted", "Accepted"],
                    ["started", "Started"],
                    ["completed", "Completed"],
                  ] as const
                ).map(([key, label]) => {
                  const at = trip.timestamps?.[key];
                  return (
                    <li key={key} className="flex items-center gap-3">
                      <span
                        aria-hidden
                        className={`h-2 w-2 shrink-0 rounded-full ${
                          at ? "bg-chart-good" : "bg-border"
                        }`}
                      />
                      <span
                        className={`text-body ${
                          at ? "font-medium text-fg" : "text-fg-muted"
                        }`}
                      >
                        {label}
                      </span>
                      <span className="ml-auto text-note text-fg-muted">
                        {at ? formatDateTime(at) : "—"}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </Section>
          ) : null}

          {/*
            Driven by booking.cancellation, not trip.cancellation. A booking cancelled
            before anyone accepted it has no Trip document at all, so keying this panel
            off the trip meant the most common cancellation of all showed nothing here.
            The refund figures still come from the trip, because that is the only place
            they exist.
          */}
          {cancellation ? (
            <Section icon={<IconPenalty size={14} />} title="Cancellation">
              <div className="mb-4 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3">
                <p className="text-sm text-foreground">
                  Cancelled by{" "}
                  <span className="font-semibold">
                    {cancellation.byName ?? cancellation.byUserId ?? "unknown user"}
                  </span>{" "}
                  <span className="text-muted-foreground">
                    ({CANCELLER_ROLE[cancellation.by] ?? cancellation.by})
                  </span>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatDateTime(cancellation.at)}
                </p>
              </div>

              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                <Field
                  label="Reason given"
                  value={cancellation.reason ?? "No reason given"}
                  muted={!cancellation.reason}
                />
                <Field
                  label="Refund"
                  value={
                    trip?.cancellation?.refundPct !== undefined
                      ? `${trip.cancellation.refundPct}%`
                      : "—"
                  }
                />
                <Field
                  label="Refunded"
                  value={
                    trip?.cancellation?.refundedAt
                      ? formatDateTime(trip.cancellation.refundedAt)
                      : "Not refunded"
                  }
                  muted={!trip?.cancellation?.refundedAt}
                />
              </dl>
            </Section>
          ) : null}
        </div>
      </div>
    </ConsolePage>
    </>
  );
}

/* --------------------------------- fragments ------------------------------- */

function Tile({
  label,
  value,
  hint,
  icon,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  icon: ReactNode;
  tone?: "default" | "danger";
}) {
  return (
    <div
      className={`rounded-card border bg-surface-raised p-4 shadow-[var(--shadow-card)] ${
        tone === "danger" ? "border-danger/40" : "border-border"
      }`}
    >
      <p className="flex items-center gap-2 text-note font-bold uppercase tracking-wider text-fg-body">
        <span aria-hidden className={tone === "danger" ? "text-danger" : "text-accent"}>
          {icon}
        </span>
        {label}
      </p>
      <p
        className={`mt-2.5 truncate text-[1.375rem] font-bold tracking-tight ${
          tone === "danger" ? "text-danger" : "text-fg"
        }`}
        title={value}
      >
        {value}
      </p>
      {hint ? <p className="mt-1.5 truncate text-note text-fg-muted">{hint}</p> : null}
    </div>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h3 className="flex items-center gap-2 text-small font-bold uppercase tracking-wider text-fg-body">
        <span aria-hidden className="text-accent">
          {icon}
        </span>
        {title}
      </h3>
      <div className="mt-3 rounded-card border border-border bg-surface-raised p-5 shadow-[var(--shadow-card)]">
        {children}
      </div>
    </section>
  );
}

function Field({
  label,
  value,
  mono,
  strong,
  muted,
  capitalize,
}: {
  label: string;
  value: string;
  mono?: boolean;
  strong?: boolean;
  muted?: boolean;
  capitalize?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-note font-medium uppercase tracking-wider text-fg-muted">{label}</dt>
      <dd
        className={`mt-1 truncate ${mono ? "font-mono text-[0.8125rem]" : "text-body"} ${
          strong ? "font-bold text-fg" : muted ? "text-fg-muted" : "text-fg"
        } ${capitalize ? "capitalize" : ""}`}
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}

function Leg({
  label,
  address,
  lat,
  lng,
  tone,
}: {
  label: string;
  address: string;
  lat: number;
  lng: number;
  tone: "accent" | "muted";
}) {
  return (
    <li className="relative">
      <span
        aria-hidden
        className={`absolute -left-6 top-1 h-2.5 w-2.5 rounded-full ring-4 ring-surface-raised ${
          tone === "accent" ? "bg-accent" : "bg-fg-faint"
        }`}
      />
      <p className="text-note font-medium uppercase tracking-wider text-fg-muted">{label}</p>
      <p className="mt-1 flex items-start gap-1.5 text-lead font-medium text-fg">
        <IconPin size={15} className="mt-1 shrink-0 text-accent" />
        <span className="min-w-0">{address}</span>
      </p>
      <p className="mt-1 font-mono text-small text-fg-muted">
        {lat.toFixed(4)}, {lng.toFixed(4)}
      </p>
    </li>
  );
}

/**
 * Live arrival, read from the flight provider rather than from the booking.
 *
 * The booking stores what the passenger typed at the time; this is what the flight is
 * actually doing, which is the number that decides whether a chauffeur is early or
 * stranded. Failure is silent by design — the booked details above are still useful and
 * a provider outage should not blank the section.
 */
function FlightBoard({ flightNumber }: { flightNumber: string }) {
  const [flight, setFlight] = useState<FlightDetails | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getFlight(flightNumber)
      .then((data) => {
        if (!cancelled) setFlight(data);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [flightNumber]);

  if (failed) {
    return (
      <p className="mt-4 border-t border-border-subtle pt-4 text-note text-fg-muted">
        Live status is unavailable for this flight right now.
      </p>
    );
  }

  if (!flight) return <Skeleton className="mt-4 h-16" />;

  return (
    <div className="mt-4 border-t border-border-subtle pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-note font-medium uppercase tracking-wider text-fg-muted">
          Live status
        </p>
        <StatusBadge
          tone={flight.status === "landed" ? "good" : flight.status === "delayed" ? "warn" : "info"}
        >
          {flight.status}
        </StatusBadge>
      </div>

      <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <Field
          label="Scheduled"
          value={flight.scheduledArrival ? formatDateTime(flight.scheduledArrival) : "—"}
        />
        <Field
          label="Actual"
          value={flight.actualArrival ? formatDateTime(flight.actualArrival) : "Not landed"}
          muted={!flight.actualArrival}
        />
        {flight.arrivalAirport ? (
          <Field label="Arrives at" value={flight.arrivalAirport} />
        ) : null}
      </dl>

      {flight.placeholder ? (
        <p className="mt-3 rounded-field border border-chart-warn/30 bg-chart-warn/5 px-3.5 py-2.5 text-note leading-relaxed text-chart-warn">
          No flight provider is configured, so these times are generated rather than
          tracked. Set the provider credentials to make this real.
        </p>
      ) : null}
    </div>
  );
}

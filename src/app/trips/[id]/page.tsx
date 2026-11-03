"use client";

import { use, useCallback, useEffect, useState, type ReactNode } from "react";
import { stageOf, isOverdue } from "@/lib/trips/stage";
import { AssignDriver } from "@/components/ops/AssignDriver";
import { fetchAllPages } from "@/lib/api/admin";
import { formatPhone } from "@/lib/format";
import Link from "next/link";
import { ConsolePage, formatDate, formatDateTime, money } from "@/components/ui/DataTable";
import {
  Avatar,
  StatusBadge,
  Skeleton,
  reference,
} from "@/components/ui/Dashboard";
import {
  IconCalendar,
  IconCar,
  IconCheck,
  IconClock,
  IconIdCard,
  IconMoney,
  IconPenalty,
  IconPin,
  IconPlane,
  IconRoute,
  IconStar,
  IconUsers,
} from "@/components/ui/Icons";
import { downloadFile, errorText } from "@/lib/api/client";
import { getBooking } from "@/lib/api/booking";
import { getFlight, type FlightDetails } from "@/lib/api/admin";
import { Button } from "@/components/ui/Button";
import { Amendments } from "@/components/ops/Amendments";
import { ReleaseCredit } from "@/components/ops/ReleaseCredit";
import { PaymentLink } from "@/components/ops/PaymentLink";
import { EditTripButton } from "@/components/ops/EditTrip";
import { bookedBy, paymentSummary } from "@/lib/trips/origin";
import { RejectRequest } from "@/components/ops/RejectRequest";
import { NoShowButton } from "@/components/ops/NoShowButton";
import { CalendarEntry } from "@/components/ops/CalendarEntry";
import { emailInvoice } from "@/lib/api/admin";
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
  driver: "driver",
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
  const [tripError, setTripError] = useState<string | null>(null);
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
      setError(null);
    } catch (err) {
      if (!isCurrent()) return;
      setError(errorText(err, "Could not load this booking"));
      return;
    }

    // Best effort: the booking is the page, the trip is extra context.
    try {
      const page = await fetchAllPages((page, limit) => listMyTrips({ page, limit }));
      const match = (page.items ?? []).find((t) => String(t.bookingId) === id);
      const resolved = match ? await getTrip(match._id) : null;
      if (!isCurrent()) return;
      setTrip(resolved);
      setTripError(null);
    } catch {
      if (isCurrent()) setTripError("Driver and trip details could not be loaded.");
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

  const stage = stageOf({ ...booking, trip: trip ?? undefined });
  const stageLabel = { awaiting: "Awaiting a driver", assigned: "Driver assigned", in_progress: "In progress", completed: "Completed", cancelled: "Cancelled" }[stage];
  const vehicle = findVehicleClass(booking.vehicleClass);
  const customer =
    booking.customerId && typeof booking.customerId === "object" ? booking.customerId : null;
  const payment = paymentSummary(booking);
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
      description={`${booking.packageName ? `Package: ${booking.packageName}` : (TRIP_TYPE_LABEL[booking.tripType] ?? booking.tripType)} · ${
        booking.scheduledAtLocal ?? formatDateTime(booking.scheduledAt)
      }`}
      action={
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <div className="flex flex-wrap items-center gap-2">
            {stage !== "cancelled" && stage !== "completed" ? <EditTripButton booking={booking} onChanged={() => void load()} /> : null}
            <DocumentDownloads bookingId={booking._id} />
            <StatusBadge tone={stage === "completed" ? "good" : stage === "cancelled" ? "bad" : "info"}>{stageLabel}</StatusBadge>
          </div>
        </div>
      }
    >
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4 rounded-card border border-border bg-surface px-5 py-4">
        <div><p className="text-label font-bold uppercase tracking-wider text-accent">Trip overview</p><p className="mt-1 text-note text-fg-body">{stage === "awaiting" ? "Assign a driver to prepare this trip for pickup." : stage === "completed" ? "Trip complete. Review payment and trip records below." : stage === "cancelled" ? "This trip has been cancelled. Review the cancellation details below." : "Monitor the pickup and keep the trip status up to date."}</p></div>
        {isOverdue({ ...booking, trip: trip ?? undefined }) && <StatusBadge tone="bad">Pickup overdue</StatusBadge>}
        {stage === "awaiting" && tripSearched && !tripError && <AssignDriver bookingId={booking._id} reference={reference(booking._id)} onAssigned={() => void load()} />}
      </div>
      {/* ------------------------------ headline strip ------------------------- */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label={trip?.fareAmount !== undefined ? "Trip fare" : "Estimated fare"} value={money(trip?.fareAmount ?? booking.estimatedFare)} icon={<IconMoney size={16} />} />
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
          label="Payment"
          value={payment.label}
          hint={payment.hint}
          icon={<IconRoute size={16} />}
          tone={payment.tone}
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

      {/* A cancellation is a status of the whole trip, so it is announced once, above the details. */}
      {cancellation ? (
        <div className="mt-4 rounded-card border border-chart-warn/40 bg-chart-warn/5 px-5 py-4">
          <div className="flex items-center gap-2 text-action font-bold text-fg">
            <IconPenalty size={14} className="text-chart-warn" />
            Cancelled by {cancellation.byName ?? cancellation.byUserId ?? "unknown user"}
            <span className="font-normal text-fg-muted">({CANCELLER_ROLE[cancellation.by] ?? cancellation.by})</span>
            <span className="ml-auto text-note font-normal text-fg-muted">{formatDateTime(cancellation.at)}</span>
          </div>
          <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-3">
            <Field label="Reason given" value={cancellation.reason ?? "No reason given"} muted={!cancellation.reason} />
            <Field label="Refund" value={trip?.cancellation?.refundPct !== undefined ? `${trip.cancellation.refundPct}%` : "—"} />
            <Field
              label="Refunded"
              value={trip?.cancellation?.refundedAt ? formatDateTime(trip.cancellation.refundedAt) : "Not refunded"}
              muted={!trip?.cancellation?.refundedAt}
            />
          </dl>
        </div>
      ) : null}

      {/*
        Two fixed columns. Every card has one home and never moves: the journey and the people
        on the left, the chauffeur, money and customer on the right. A card only appears when the
        kind of trip needs it (a flight for an airport pickup, legs for a multi-city journey),
        and always below the ones that are always there.
      */}
      <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        {/* ------------------------------ main column ------------------------------ */}
        <div className="grid min-w-0 gap-4">
          <Section icon={<IconRoute size={14} />} title="Journey">
            <div className="grid gap-6 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
              <div>
                <ol className="relative space-y-5 pl-6">
                  <span aria-hidden className="absolute bottom-2 left-[5px] top-2 w-px bg-border" />
                  <Leg label="Pickup" address={booking.pickup.address} lat={booking.pickup.lat} lng={booking.pickup.lng} tone="accent" />
                  {booking.stops?.map((stop, index) => (
                    <Leg key={index} label={`Stop ${index + 1}`} address={stop.address} lat={stop.lat} lng={stop.lng} tone="muted" />
                  ))}
                  <Leg
                    label={booking.tripType === "hourly" ? "First stop" : "Drop-off"}
                    address={booking.drop.address}
                    lat={booking.drop.lat}
                    lng={booking.drop.lng}
                    tone="muted"
                  />
                </ol>
                <a
                  href={`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(booking.pickup.address)}&destination=${encodeURIComponent(booking.drop.address)}${booking.stops?.length ? `&waypoints=${encodeURIComponent(booking.stops.map((stop) => stop.address).join("|"))}` : ""}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-field border border-border px-3 text-note font-bold text-accent hover:bg-surface"
                >
                  Open route in maps ↗
                </a>
              </div>
              <dl className="grid content-start grid-cols-2 gap-x-5 gap-y-4 md:border-l md:border-border-subtle md:pl-6">
                <div className="col-span-2">
                  <Field label="Pickup" value={booking.scheduledAtLocal ?? formatDateTime(booking.scheduledAt)} strong />
                </div>
                <Field label="Service" value={booking.packageName ? `Package: ${booking.packageName}` : (TRIP_TYPE_LABEL[booking.tripType] ?? booking.tripType)} />
                <Field label="City" value={booking.city ?? "—"} capitalize />
                <Field label="Created by" value={bookedBy(booking).label} />
                <Field label="Booked" value={formatDateTime(booking.createdAt)} />
                <Field label="Last updated" value={formatDateTime(booking.updatedAt)} />
              </dl>
            </div>
            <p className="mt-4 text-note text-fg-muted">Times shown in Pacific time.</p>
          </Section>

          {booking.tripType === "airport" || booking.flightDetails ? (
            <Section icon={<IconPlane size={14} />} title="Flight">
              <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                <Field
                  label="Flight number"
                  value={booking.flightDetails?.flightNumber ?? "Not supplied"}
                  mono={Boolean(booking.flightDetails)}
                  strong={Boolean(booking.flightDetails)}
                  muted={!booking.flightDetails}
                />
                <Field
                  label="Booked arrival"
                  value={
                    booking.flightDetails?.scheduledArrival
                      ? formatDateTime(booking.flightDetails.scheduledArrival)
                      : "Not supplied"
                  }
                  muted={!booking.flightDetails?.scheduledArrival}
                />
              </dl>
              {booking.flightDetails ? (
                <FlightBoard
                  flightNumber={booking.flightDetails.flightNumber}
                  date={booking.scheduledAtLocal?.slice(0, 10) ?? booking.scheduledAt.slice(0, 10)}
                />
              ) : null}
            </Section>
          ) : null}

          {booking.journeyLegs && booking.journeyLegs.length > 1 ? (
            <Section icon={<IconRoute size={14} />} title="Trip legs">
              <p className="text-note text-fg-muted">
                Leg {(booking.journey?.index ?? 0) + 1} of {booking.journeyLegs.length}, paid together.
              </p>
              <ol className="mt-3 grid gap-3 sm:grid-cols-2">
                {booking.journeyLegs.map((leg, i) => (
                  <li key={leg._id} className="rounded-field border border-border px-3.5 py-2.5 text-note">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-bold text-fg">
                          Leg {i + 1}
                          {leg.status === "cancelled" ? " · cancelled" : ""}
                        </p>
                        <p className="break-words text-fg-body">
                          {leg.pickup.address} to {leg.drop.address}
                        </p>
                        <p className="text-fg-muted">{formatDateTime(leg.scheduledAt)}</p>
                      </div>
                      {leg._id === booking._id ? (
                        <span className="shrink-0 text-fg-muted">This leg</span>
                      ) : (
                        <Link href={`/trips/${leg._id}`} className="shrink-0 font-bold text-accent hover:underline">
                          View
                        </Link>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </Section>
          ) : null}

          <Section icon={<IconUsers size={14} />} title="Passenger & service">
            {/* Nine fixed slots in three rows, so a value is always where the eye expects it. */}
            <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-3">
              <Field label="Travelling passenger" value={booking.passengerName ?? customer?.name ?? "Not recorded"} strong />
              <Field label="Passenger phone" value={formatPhone(booking.passengerPhone ?? customer?.phone) || "Not recorded"} />
              <Field label="Passengers" value={booking.passengers === undefined ? "Not recorded" : String(booking.passengers)} />
              <Field label="Checked bags" value={booking.checkedBags === undefined ? "Not recorded" : String(booking.checkedBags)} />
              <Field label="Carry-on bags" value={booking.carryOnBags === undefined ? "Not recorded" : String(booking.carryOnBags)} />
              <Field label="Child seats" value={booking.carSeats === undefined ? "Not recorded" : String(booking.carSeats)} />
              <Field label="Meet & greet" value={booking.meetAndGreet === undefined ? "Not recorded" : booking.meetAndGreet ? "Requested" : "Not requested"} />
              <Field label="Occasion" value={[booking.occasion, booking.occasionDetails].filter(Boolean).join(" · ") || "—"} muted={!booking.occasion} />
              <Field
                label="Charter / cruise"
                value={
                  booking.hours !== undefined
                    ? `${booking.hours} hours`
                    : booking.cruiseShip
                      ? `${booking.cruiseShip} · ${booking.cruisePort ?? "Port not recorded"}`
                      : "—"
                }
                muted={booking.hours === undefined && !booking.cruiseShip}
              />
            </dl>
            {booking.serviceNotes?.length ? (
              <div className="mt-5 border-t border-border-subtle pt-4">
                <p className="text-label font-medium text-fg-muted">Service notes</p>
                <ul className="mt-2 space-y-2 text-meta text-fg">
                  {booking.serviceNotes.map((note) => (
                    <li key={note} className="rounded-field border border-border bg-surface px-3 py-2">
                      {note}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Section>
        </div>

        {/* ------------------------------ side column ------------------------------ */}
        <div className="grid min-w-0 gap-4">
          <Section icon={<IconIdCard size={14} />} title="Driver and trip">
            {tripError ? (
              <div role="alert"><p className="text-note text-danger">{tripError}</p><button type="button" onClick={() => void load()} className="mt-2 min-h-11 text-note font-bold text-accent">Retry loading trip</button></div>
            ) : !tripSearched ? (
              <Skeleton className="h-24" />
            ) : !trip ? (
              <p className="text-note text-fg-muted">No driver assigned yet. Assign a driver from the trip overview above.</p>
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <Avatar name={trip.driver?.name ?? "Driver"} size={40} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-action font-bold text-fg">{trip.driver?.name ?? "Driver"}</p>
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
                  <Field label="Settled fare" value={trip.fareAmount !== undefined ? money(trip.fareAmount) : "—"} />
                  <div>
                    <Field label="Credit applied" value={trip.creditApplied ? money(trip.creditApplied) : "None"} muted={!trip.creditApplied} />
                    {/* Applying credit was one-way until now: a passenger who changed
                        their mind had no route back and neither did operations. */}
                    {trip.creditApplied ? (
                      <ReleaseCredit tripId={trip._id} applied={trip.creditApplied} onReleased={() => void load()} />
                    ) : null}
                  </div>
                  <Field label="Penalty" value={trip.penaltyApplied ? "Applied" : "None"} muted={!trip.penaltyApplied} />
                  <Field
                    label="Feedback survey"
                    value={
                      trip.status !== "completed"
                        ? "—"
                        : trip.feedbackRequestedAt
                          ? `Requested ${formatDateTime(trip.feedbackRequestedAt)}`
                          : "Not sent"
                    }
                    muted={!trip.feedbackRequestedAt}
                  />
                </dl>

                <div className="mt-5 border-t border-border-subtle pt-4">
                  <p className="text-label font-medium text-fg-muted">Move this trip</p>
                  <div className="mt-3">
                    <TripStatusControl
                      tripId={trip._id}
                      currentStatus={trip.status}
                      onChanged={load}
                      reached={{ confirmed: Boolean(trip.timestamps?.confirmed), enroute: Boolean(trip.timestamps?.enroute), arrived: Boolean(trip.timestamps?.arrived) }}
                    />
                  </div>
                  <div className="mt-3">
                    <NoShowButton
                      tripId={trip._id}
                      tripStatus={trip.status}
                      noShow={trip.noShow}
                      clientName={booking.customerId && typeof booking.customerId === "object" ? booking.customerId.name : undefined}
                      onChanged={load}
                    />
                  </div>
                </div>

                <div className="mt-5 border-t border-border-subtle pt-4">
                  <p className="text-label font-medium text-fg-muted">Timeline</p>
                  <ol className="mt-3 grid gap-2">
                    {(
                      [
                        ["requested", "Requested"],
                        ["assigned", "Assigned"],
                        ["accepted", "Accepted"],
                        ["confirmed", "Confirmed"],
                        ["enroute", "On the way"],
                        ["arrived", "Arrived"],
                        ["started", "Started"],
                        ["completed", trip.status === "cancelled" ? "Cancelled" : "Completed"],
                      ] as const
                    ).map(([key, label]) => {
                      const at = trip.timestamps?.[key];
                      return (
                        <li key={key} className="flex items-center gap-3">
                          <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${at ? "bg-chart-good" : "bg-border"}`} />
                          <span className={`text-body ${at ? "font-medium text-fg" : "text-fg-muted"}`}>{label}</span>
                          <span className="ml-auto text-note text-fg-muted">{at ? formatDateTime(at) : "—"}</span>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              </>
            )}
          </Section>

          <Section icon={<IconMoney size={14} />} title="Payment">
            <PaymentLink
              booking={booking}
              clientName={booking.customerId && typeof booking.customerId === "object" ? booking.customerId.name : undefined}
              clientEmail={booking.customerId && typeof booking.customerId === "object" ? booking.customerId.email : undefined}
              onChanged={() => void load()}
            />
          </Section>

          <Section icon={<IconUsers size={14} />} title="Customer">
            <div className="flex items-center gap-3">
              <Avatar name={customer?.name} size={40} />
              <div className="min-w-0">
                <p className="truncate text-action font-bold text-fg">
                  {customer?.name ?? "—"}
                  {booking.isGuest ? (
                    <span className="ml-2 align-middle"><StatusBadge tone="info">Guest</StatusBadge></span>
                  ) : null}
                  {booking.source === "admin" ? (
                    <span className="ml-2 align-middle"><StatusBadge tone="neutral">Booked by operator</StatusBadge></span>
                  ) : null}
                </p>
                <p className="truncate text-note text-fg-muted">{customer?.email ?? "No email"}</p>
              </div>
            </div>
            <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <Field label="Phone" value={formatPhone(customer?.phone) || "—"} />
              <Field label="Favourite driver" value={booking.favoriteDriverId ? "Requested" : "None"} muted={!booking.favoriteDriverId} />
              <Field label="Agreement signed" value={booking.agreementSignedAt ? formatDate(booking.agreementSignedAt) : "Not signed"} muted={!booking.agreementSignedAt} />
            </dl>
          </Section>

          {booking.status === "pending" || booking.status === "dispatched" || booking.cancellation?.rejected ? (
            <Section icon={<IconPenalty size={14} />} title="Request">
              <RejectRequest
                booking={booking}
                clientName={booking.customerId && typeof booking.customerId === "object" ? booking.customerId.name : undefined}
                onChanged={() => void load()}
              />
            </Section>
          ) : null}

          <CalendarEntry
            booking={booking}
            onChanged={() => void load()}
            renderSection={(content) => <Section icon={<IconCalendar size={14} />} title="Calendar">{content}</Section>}
          />
        </div>
      </div>

      {/* Record ids, last and always in the same place: they are for support, not for the daily work. */}
      <section className="mt-4 rounded-card border border-border bg-surface-raised px-4 py-3 shadow-[var(--shadow-card)]">
        <dl className="grid gap-x-6 gap-y-3 md:grid-cols-3">
          <Field label="Booking id" value={booking._id} mono />
          <Field label="Customer id" value={customer?._id ?? String(booking.customerId)} mono />
          <Field label="Trip id" value={trip?._id ?? "—"} mono muted={!trip} />
        </dl>
      </section>
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
  tone?: "default" | "danger" | "success" | "warn" | "neutral";
}) {
  // Paid reads green, failed or owed reads red, refunded and not-yet-paid read amber.
  const ink = { danger: "text-danger", success: "text-success", warn: "text-chart-warn", default: "", neutral: "" }[tone];
  const edge = { danger: "border-danger/40", success: "border-success/40", warn: "border-chart-warn/40", default: "border-border", neutral: "border-border" }[tone];
  const wash = { danger: "bg-danger/5", success: "bg-success/5", warn: "bg-chart-warn/5", default: "", neutral: "" }[tone];
  return (
    <div
      className={`rounded-card border bg-surface-raised p-4 shadow-[var(--shadow-card)] ${edge} ${wash}`}
    >
      <p className="flex items-center gap-2 text-note font-bold uppercase tracking-wider text-fg-body">
        <span aria-hidden className={ink || "text-accent"}>
          {icon}
        </span>
        {label}
      </p>
      <p
        className={`mt-2.5 truncate text-[1.375rem] font-bold tracking-tight ${ink || "text-fg"}`}
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
    <section className="overflow-hidden rounded-card border border-border bg-surface-raised shadow-[var(--shadow-card)]">
      <h3 className="flex items-center gap-2 border-b border-border-subtle bg-surface/60 px-4 py-3 text-action font-bold text-fg">
        <span aria-hidden className="text-accent">
          {icon}
        </span>
        {title}
      </h3>
      <div className="p-4">
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
      <dt className="text-label font-medium text-fg-muted">{label}</dt>
      <dd
        className={`mt-1 break-words ${mono ? "font-mono text-[0.8125rem]" : "text-body"} ${
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
function FlightBoard({ flightNumber, date }: { flightNumber: string; date?: string }) {
  const [flight, setFlight] = useState<FlightDetails | null>(null);
  const [failed, setFailed] = useState(false);
  const [checking, setChecking] = useState(false);

  // Looked up only when someone asks: each lookup uses the flight provider's quota, and the
  // booked details above are what the page needs until then.
  function check() {
    setChecking(true);
    setFailed(false);
    getFlight(flightNumber, date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined)
      .then((data) => setFlight(data))
      .catch(() => setFailed(true))
      .finally(() => setChecking(false));
  }

  if (!flight) {
    return (
      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border-subtle pt-4">
        <Button type="button" variant="secondary" onClick={check} loading={checking}>
          Check flight details
        </Button>
        {failed ? (
          <p className="text-note text-fg-muted">Live status is unavailable for this flight right now.</p>
        ) : null}
      </div>
    );
  }

  // Generated stand-in times are never shown as the flight's own.
  if (flight.placeholder || flight.verified === false) {
    const why =
      flight.unavailableReason === "not-configured"
        ? "No flight provider is set up, so there is no live data."
        : flight.unavailableReason === "not-found"
          ? "The flight provider has no record of this flight for that day yet. Live tracking usually appears close to the travel date."
          : "The flight provider could not be reached for this flight.";
    return (
      <div className="mt-4 border-t border-border-subtle pt-4">
        <p className="rounded-field border border-chart-warn/30 bg-chart-warn/5 px-3.5 py-2.5 text-note leading-relaxed text-chart-warn">
          {why}
        </p>
        <Button type="button" variant="secondary" className="mt-3" onClick={check} loading={checking}>
          Check again
        </Button>
      </div>
    );
  }

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
        <Button type="button" variant="secondary" className="ml-auto" onClick={check} loading={checking}>
          Refresh
        </Button>
      </div>

      <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <Field
          label="Scheduled"
          value={flight.scheduledArrival ? formatDateTime(flight.scheduledArrival) : "—"}
        />
        {flight.estimatedArrival ? (
          <Field
            label="Forecast"
            value={`${formatDateTime(flight.estimatedArrival)}${
              flight.delayMinutes && Math.abs(flight.delayMinutes) >= 10
                ? ` · ${flight.delayMinutes > 0 ? `${flight.delayMinutes} min late` : `${-flight.delayMinutes} min early`}`
                : ""
            }`}
          />
        ) : null}
        <Field
          label="Actual"
          value={flight.actualArrival ? formatDateTime(flight.actualArrival) : "Not landed"}
          muted={!flight.actualArrival}
        />
        {flight.arrivalAirport ? (
          <Field label="Arrives at" value={flight.arrivalAirport} />
        ) : null}
      </dl>

    </div>
  );
}

/**
 * The invoice, and the receipt once the ride is paid. Operations send these on request,
 * so they are one click from the trip. The API decides what exists: asking for a receipt
 * on an unpaid ride answers with a plain explanation, shown here as it is.
 */
function DocumentDownloads({ bookingId }: { bookingId: string }) {
  const [busy, setBusy] = useState<"invoice" | "receipt" | "email" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [emailed, setEmailed] = useState<string | null>(null);

  const email = async () => {
    setBusy("email");
    setError(null);
    setEmailed(null);
    try {
      const result = await emailInvoice(bookingId);
      setEmailed(`Invoice emailed to ${result.sentTo}${result.paymentLinkIncluded ? ", with a payment link" : ""}.`);
    } catch (err) {
      setError(errorText(err, "Could not email the invoice"));
    } finally {
      setBusy(null);
    }
  };

  const get = async (kind: "invoice" | "receipt") => {
    setBusy(kind);
    setError(null);
    try {
      await downloadFile(`/bookings/${bookingId}/documents/${kind}`, `abl-${kind}-${reference(bookingId)}.pdf`);
    } catch (err) {
      setError(errorText(err, `Could not download the ${kind}`));
    } finally {
      setBusy(null);
    }
  };

  const buttonCls =
    "inline-flex h-10 items-center rounded-field border border-border bg-surface-raised px-3.5 text-note font-bold text-fg transition-colors hover:border-accent disabled:opacity-60";
  return (
    <>
      {(["invoice", "receipt"] as const).map((kind) => (
        <button key={kind} type="button" disabled={busy !== null} onClick={() => get(kind)} className={buttonCls}>
          {busy === kind ? "Preparing…" : kind === "invoice" ? "Download invoice" : "Download receipt"}
        </button>
      ))}
      <button type="button" disabled={busy !== null} onClick={() => void email()} className={buttonCls}>
        {busy === "email" ? "Sending…" : "Email invoice"}
      </button>
      {/* The result of the last action, as a pinned notice so it does not push the header around. */}
      {emailed || error ? (
        <p
          role="status"
          className={`basis-full text-note ${error ? "text-danger" : "font-bold text-fg"}`}
        >
          {error ?? emailed}
        </p>
      ) : null}
    </>
  );
}

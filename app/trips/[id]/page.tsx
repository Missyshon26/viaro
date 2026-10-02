import type { Metadata } from "next";
import { formatPhone } from "@/lib/utils";
import Link from "next/link";
import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { PageShell, Panel, SectionTitle, money } from "@/components/app/shell";
import { CancelTripButton } from "@/components/app/trip-actions";
import {
  RateTripForm,
  ChangeVehicleForm,
  ChangeRouteForm,
  UseCreditForm,
  RequestFavoriteButton,
} from "@/components/app/trip-forms";
import { ContactToCancel } from "@/components/app/contact-to-cancel";
import { getCurrentUser } from "@/lib/auth/current-user";
import { apiOptional, ApiError } from "@/lib/api/client";
import { getBooking } from "@/lib/api/bookings";
import type { Booking, Driver, Receipt, Trip, Wallet } from "@/lib/api/types";
import { VEHICLE_CLASSES } from "@/lib/constants";
import { LiveRefresh } from "@/components/app/live-refresh";
import { RideStatusBadge } from "@/components/app/status-badge";
import { AddFavoriteButton } from "@/components/app/favorite-forms";
import { rideStatus } from "@/lib/ride-status";
import {
  CancelRequestedCreditForm,
  ReleaseCreditForm,
} from "@/components/app/trip-forms";

export const metadata: Metadata = { title: "Trip | Viaro", robots: { index: false, follow: false } };

/**
 * One journey, from the passenger's side.
 *
 * Rebuilt around grouping rather than boxing. The previous version gave every fact its
 * own bordered panel — vehicle, journey, chauffeur, change vehicle, change route, rate,
 * receipt, credit, favourite, cancel — which produced two columns of unequal stacks and
 * no hierarchy at all: "Rate your chauffeur" carried the same visual weight as the route.
 *
 * There are three groups now. What the trip IS (one hero card: the car, the route, the
 * facts), what you can DO about it (one panel, not four), and what it COSTS (a rail that
 * sticks, so the shorter column never ends in dead space).
 */
const reference = (id: string) => `VRO-${id.slice(-6).toUpperCase()}`;

const SERVICE_LABEL: Record<string, string> = {
  point2point: "Point to point",
  airport: "Airport transfer",
  hourly: "Hourly charter",
};


/** Changes close this many hours before pickup — mirrors CHANGE_CUTOFF_HOURS server-side. */
const CHANGE_CUTOFF_HOURS = 3;

export default async function TripDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string; updated?: string }>;
}) {
  const { id } = await params;
  const { created, updated } = await searchParams;
  const user = await getCurrentUser();
  // Not "render nothing": a session that expired between middleware and here
  // would otherwise show a header and footer with a blank page between them.
  if (!user) redirect("/login?next=/trips");

  let booking: Booking | null = null;
  let trip: Trip | null = null;

  try {
    booking = await getBooking(id);
  } catch (err) {
    if (!(err instanceof ApiError) || !(err.isNotFound || err.isForbidden)) throw err;
  }

  if (!booking) {
    trip = await apiOptional<Trip>(`/trips/${id}`);
    booking = trip?.booking ?? null;
  }

  if (!booking && !trip) notFound();

  // A trip only exists once a chauffeur accepts, so this is expected to be null early.
  const receipt = booking
    ? await apiOptional<Receipt>(`/users/me/rides/${booking._id}/receipt`)
    : null;

  const tripId = trip?._id ?? receipt?.tripId ?? undefined;
  if (!trip && tripId) trip = await apiOptional<Trip>(`/trips/${tripId}`);

  const [wallet, favorites] = await Promise.all([
    receipt && receipt.amountDue > 0 ? apiOptional<Wallet>("/wallet/me") : null,
    booking?.status === "pending" || trip?.status === "completed"
      ? apiOptional<Driver[]>("/users/me/favorites")
      : null,
  ]);

  const status = trip?.status ?? booking?.status ?? "";
  const displayStatus = rideStatus({
    bookingStatus: booking?.status,
    tripStatus: trip?.status,
    refundPct: trip?.cancellation?.refundPct ?? receipt?.refund?.refundPct,
  });
  const cancellable = booking && booking.status !== "cancelled" && status !== "completed";
  const inFlight = trip?.status === "accepted" || trip?.status === "started";
  const completed = trip?.status === "completed";

  const vehicle = VEHICLE_CLASSES.find((v) => v.value === booking?.vehicleClass);
  const amendments = booking?.amendments ?? [];

  /*
   * `Date.now()` is safe here: this is a Server Component (no "use client"), so it is
   * evaluated once on the server while rendering and never re-run on the client — there
   * is no second value to mismatch against. The rule cannot tell server from client
   * components, and the cutoff itself mirrors the backend's CHANGE_CUTOFF_HOURS rule.
   */
  // eslint-disable-next-line react-hooks/purity
  const renderedAt = Date.now();
  const hoursUntilPickup = booking
    ? (new Date(booking.scheduledAt).getTime() - renderedAt) / 3_600_000
    : 0;
  const changeable =
    Boolean(booking) &&
    booking?.status !== "cancelled" &&
    !completed &&
    hoursUntilPickup >= CHANGE_CUTOFF_HOURS;
  return (
    <PageShell
      title={booking ? reference(booking._id) : "Trip"}
      description={
        created === "1"
          ? "Booking confirmed. We are finding your chauffeur now."
          : updated === "1"
            ? "Your booking was updated."
            : undefined
      }
      action={
        <div className="flex flex-wrap items-center gap-3">
          <RideStatusBadge status={displayStatus} className="h-8" />
          {trip ? (
            <Button asChild variant="outline">
              <Link href={`/trips/${id}/track`}>Track live</Link>
            </Button>
          ) : null}
          <Button asChild variant="outline">
            <Link href="/trips">All trips</Link>
          </Button>
        </div>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] lg:items-start">
        {/* ------------------------------ what it is ----------------------------- */}
        <div className="space-y-6">
          <Panel className="overflow-hidden p-0">
            {vehicle?.photos[0] ? (
              <div className="relative aspect-[21/9] bg-secondary">
                <Image
                  src={vehicle.photos[0].src}
                  alt={vehicle.photos[0].alt}
                  fill
                  sizes="(min-width: 1024px) 60vw, 100vw"
                  className="object-cover"
                  priority
                />
                {/* The label sits on the photo so the car and its name are one object. */}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-5">
                  <p className="text-lg font-medium text-white">{vehicle.label}</p>
                  <p className="mt-0.5 text-sm text-white/70">
                    {vehicle.detail} · seats {vehicle.seats}
                  </p>
                </div>
              </div>
            ) : null}

            {booking ? (
              <div className="p-6">
                {/* Two points on a rail read faster than "A → B" on one line. */}
                <ol className="relative space-y-5 pl-6">
                  <span
                    aria-hidden
                    className="absolute bottom-2 left-[5px] top-2 w-px bg-border"
                  />
                  <Leg label="Pickup" address={booking.pickup.address} accent />
                  <Leg
                    label={booking.tripType === "hourly" ? "First stop" : "Drop-off"}
                    address={booking.drop.address}
                  />
                </ol>

                <dl className="mt-6 grid gap-x-6 gap-y-4 border-t border-border pt-6 text-sm sm:grid-cols-3">
                  <Detail label="Pickup date" value={longDate(booking.scheduledAt)} />
                  <Detail
                    label="Pickup time"
                    value={new Date(booking.scheduledAt).toLocaleTimeString("en-US", {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                    hint="PT"
                  />
                  <Detail
                    label="Service"
                    value={SERVICE_LABEL[booking.tripType] ?? booking.tripType}
                  />
                  <Detail
                    label="Passengers"
                    value={
                      booking.passengers !== undefined
                        ? String(booking.passengers)
                        : "Not recorded"
                    }
                  />
                  <Detail label="Vehicle" value={vehicle?.label ?? booking.vehicleClass} />
                  {booking.city ? (
                    <Detail
                      label="City"
                      value={booking.city.replace(/\b\w/g, (c) => c.toUpperCase())}
                    />
                  ) : null}
                  {booking.flightDetails?.flightNumber ? (
                    <Detail label="Flight" value={booking.flightDetails.flightNumber} />
                  ) : null}
                  <Detail label="Reference" value={reference(booking._id)} />
                </dl>
              </div>
            ) : null}
          </Panel>

          {amendments.length > 0 ? (
            <Panel>
              <SectionTitle>Changes you made</SectionTitle>
              <ul className="mt-4 space-y-2.5 text-sm">
                {[...amendments].reverse().map((change, index) => (
                  <li key={`${change.field}-${index}`} className="flex flex-wrap gap-x-2">
                    <span className="text-muted-foreground">
                      {FIELD_LABEL[change.field] ?? change.field}
                    </span>
                    <span className="text-muted-foreground/60 line-through">
                      {change.from}
                    </span>
                    <span aria-hidden className="text-muted-foreground">
                      →
                    </span>
                    <span className="text-foreground">{change.to}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-muted-foreground">
                Your chauffeur and our team see these too.
              </p>
            </Panel>
          ) : null}

          {/*
            Always rendered, never omitted.
            
            Previously this panel only existed once a chauffeur had accepted, so a booking
            still waiting in the pool showed nothing at all about its driver — a passenger
            could not tell whether one was coming, had been assigned, or had fallen
            through. "Nobody yet" is an answer and it needs saying.
          */}
          {!trip?.driver && booking && booking.status !== "cancelled" ? (
            <Panel>
              <SectionTitle>Your chauffeur</SectionTitle>
              <div className="mt-5 flex flex-wrap items-center gap-4">
                <span
                  aria-hidden
                  className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground"
                >
                  <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="8" r="3.5" />
                    <path d="M5 20a7 7 0 0 1 14 0" />
                  </svg>
                </span>
                <div className="min-w-0 flex-1">
                  {/* The fact first, the process second. Someone checking this page wants
                      to know whether they have a chauffeur, not what the system is up to. */}
                  <p className="text-lg font-medium text-foreground">
                    No chauffeur assigned yet
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    {booking.status === "pending"
                      ? "We are about to offer this to chauffeurs near your pickup."
                      : "It has gone out to chauffeurs near your pickup — the first to accept takes it. Their name and vehicle appear here as soon as one does."}
                  </p>
                </div>
              </div>
            </Panel>
          ) : null}

          {trip?.driver ? (
            <Panel>
              <SectionTitle>Your chauffeur</SectionTitle>

              <div className="mt-5 flex flex-wrap items-center gap-4">
                <span
                  aria-hidden
                  className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand/15 text-lg font-medium text-brand"
                >
                  {initials(trip.driver.name)}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="text-lg font-medium text-foreground">
                    {trip.driver.name ?? "Assigned"}
                  </p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {/* The class the chauffeur drives, named — the raw key ("suv") meant
                        nothing here. */}
                    {vehicleLabel(trip.driver.vehicleClass)}
                    {/*
                      A rating of 0 is not a bad chauffeur, it is an unrated one — the
                      payload carries no ratingCount to tell them apart, so anything at
                      zero is shown as new rather than as one star short of terrible.
                    */}
                    {typeof trip.driver.rating === "number" && trip.driver.rating > 0
                      ? ` · ${trip.driver.rating.toFixed(1)} ★`
                      : " · New chauffeur"}
                  </p>
                </div>

                {completed ? (
                  <AddFavoriteButton
                    driverId={trip.driver.driverId}
                    name={trip.driver.name}
                    already={(favorites ?? []).some((f) => f._id === trip?.driver?.driverId)}
                  />
                ) : (
                  <Button asChild className="w-full sm:w-auto">
                    <Link href={`/trips/${id}/chat`}>Message</Link>
                  </Button>
                )}
              </div>

              {/* Customers get a masked number by design (spec §8 rule 4), so say why
                  rather than printing "Contact via app" as if it were a number. */}
              <p className="mt-4 border-t border-border pt-4 text-sm leading-relaxed text-muted-foreground">
                {trip.driver.phone && trip.driver.phone !== "Contact via app" ? (
                  <>
                    Call them on{" "}
                    <a
                      href={`tel:${trip.driver.phone.replace(/[^\d+]/g, "")}`}
                      className="text-foreground hover:text-brand"
                    >
                      {formatPhone(trip.driver.phone)}
                    </a>
                    .
                  </>
                ) : (
                  <>
                    Chauffeurs&rsquo; direct numbers stay private. Message them here and
                    it reaches them straight away.
                  </>
                )}
              </p>
            </Panel>
          ) : null}

          {/* --------------------- one panel of actions, not four ---------------- */}
          {changeable && booking ? (
            <Panel>
              <SectionTitle>Change this booking</SectionTitle>
              <p className="mt-2 text-sm text-muted-foreground">
                Route, time and vehicle can move until {CHANGE_CUTOFF_HOURS} hours before
                pickup.
              </p>

              <div className="mt-5 space-y-6">
                {inFlight && trip ? (
                  <>
                    <Labelled title="Vehicle" note="Switching class re-prices the trip.">
                      <ChangeVehicleForm tripId={trip._id} current={booking.vehicleClass} />
                    </Labelled>
                    <Labelled title="Route">
                      <ChangeRouteForm
                        tripId={trip._id}
                        pickup={booking.pickup.address}
                        drop={booking.drop.address}
                        city={booking.city}
                      />
                    </Labelled>
                  </>
                ) : (
                  <Button asChild variant="outline">
                    <Link href={`/trips/${booking._id}/edit`}>
                      Change route, time or vehicle
                    </Link>
                  </Button>
                )}
              </div>
            </Panel>
          ) : null}

          {completed && trip && !trip.rated ? (
            <Panel>
              <SectionTitle>Rate your chauffeur</SectionTitle>
              <p className="mt-2 text-sm text-muted-foreground">
                Ratings are what keep the service honest.
              </p>
              <div className="mt-5">
                <RateTripForm tripId={trip._id} />
              </div>
            </Panel>
          ) : null}
        </div>

        {/* ------------------------------ what it costs -------------------------- */}
        <div className="space-y-6 lg:sticky lg:top-24">
          {receipt ? (
            <Panel>
              <SectionTitle>Receipt</SectionTitle>
              <dl className="mt-5 space-y-3 text-sm">
                <Line label="Fare" value={money(receipt.fare)} />
                {/* Chosen at booking, not yet spent — there is no Trip to spend it on
                    until a chauffeur is assigned. */}
                {receipt.creditApplied === 0 &&
                booking &&
                (booking.walletCreditRequested ?? 0) > 0 &&
                booking.status !== "cancelled" ? (
                  <div className="border-t border-border pt-3">
                    <CancelRequestedCreditForm
                      bookingId={booking._id}
                      requested={booking.walletCreditRequested ?? 0}
                    />
                  </div>
                ) : null}

                {receipt.creditApplied > 0 ? (
                  <>
                    <Line
                      label="Wallet credit"
                      value={`−${money(receipt.creditApplied)}`}
                      accent
                    />
                    {/* Applying credit used to be one-way — the only route back was a
                        support call. It stays available until the fare is charged. */}
                    <ReleaseCreditForm
                      tripId={tripId ?? id}
                      applied={receipt.creditApplied}
                    />
                  </>
                ) : null}
                <div className="flex items-baseline justify-between gap-4 border-t border-border pt-3">
                  <dt className="font-medium text-foreground">Amount due</dt>
                  <dd className="font-sans text-2xl font-bold text-foreground">
                    {money(receipt.amountDue)}
                  </dd>
                </div>
              </dl>
              {receipt.refund ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  Refunded {receipt.refund.refundPct}% to your wallet.
                </p>
              ) : null}
            </Panel>
          ) : null}

          {wallet && wallet.balance > 0 && receipt && receipt.tripId ? (
            <Panel>
              <SectionTitle>Use wallet credit</SectionTitle>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {money(wallet.balance)} available. Spending it on a ride costs nothing.
              </p>
              <div className="mt-5">
                <UseCreditForm
                  tripId={receipt.tripId}
                  balance={wallet.balance}
                  due={receipt.amountDue}
                />
              </div>
            </Panel>
          ) : null}

          {booking?.status === "pending" && favorites && favorites.length > 0 && booking ? (
            <Panel>
              <SectionTitle>Request a favourite</SectionTitle>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                If they are free, dispatch offers them this trip first.
              </p>
              <ul className="mt-5 space-y-3">
                {favorites.map((driver) => (
                  <li key={driver._id}>
                    <RequestFavoriteButton
                      bookingId={booking._id}
                      driverId={driver._id}
                      name={
                        typeof driver.userId === "object" ? driver.userId.name : "chauffeur"
                      }
                    />
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          {/*
            Rendered whenever the passenger owns a live booking, cancellable or not.
            It used to disappear the moment a trip completed, which reads as the option
            having been taken away rather than having been used up — the same complaint
            the chauffeur panel drew. A finished journey now says so.
          */}
          {user.role === "customer" && booking && !cancellable ? (
            <Panel>
              <SectionTitle>Cancel</SectionTitle>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                {booking.status === "cancelled"
                  ? "This booking is already cancelled."
                  : "This journey is complete, so there is nothing left to cancel."}
              </p>
              {booking.status !== "cancelled" ? (
                <div className="mt-4 border-t border-border pt-4">
                  <ContactToCancel reason="cancel" variant="inline" />
                </div>
              ) : null}
            </Panel>
          ) : null}

          {user.role === "customer" && cancellable && booking ? (
            <Panel>
              <SectionTitle>Cancel</SectionTitle>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Free outside the {booking.tripType === "hourly" ? "72" : "24"} h window. If
                a fare has already been charged, 90% of it comes back as wallet credit —
                otherwise there is nothing to refund. Inside the window the fare is
                retained.
              </p>
              {/* One action, then the way out as a sentence. The contact route used to be
                  two more full-width buttons under this one, which made a panel with a
                  single real decision look like it had three. */}
              <div className="mt-5">
                <CancelTripButton
                  bookingId={booking._id}
                  status={booking.status}
                  tripType={booking.tripType}
                  tripId={tripId}
                />
                <div className="mt-4 border-t border-border pt-4">
                  <ContactToCancel reason="cancel" variant="inline" />
                </div>
              </div>
            </Panel>
          ) : null}
        </div>
      </div>
      {/* A chauffeur accepting, or a change made by our team, appears here without a
          reload. Renders nothing — it only re-runs this page's server render. */}
      <LiveRefresh topics={["booking", "trip", "dispatch"]} />
    </PageShell>
  );
}

/* --------------------------------- fragments ------------------------------- */

const FIELD_LABEL: Record<string, string> = {
  pickup: "Pickup",
  drop: "Drop-off",
  vehicleClass: "Vehicle",
  scheduledAt: "Pickup time",
};

/** Two letters for the chauffeur avatar. */
function initials(name?: string | null) {
  return (
    (name ?? "")
      .split(" ")
      .map((part) => part[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}

/** The chauffeur's class as a name, falling back to the raw key for retired classes. */
function vehicleLabel(value?: string | null) {
  if (!value) return "Chauffeur";
  return VEHICLE_CLASSES.find((v) => v.value === value)?.label ?? value;
}

function longDate(iso: string) {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString("en-US", {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function Detail({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="mt-1 truncate text-foreground" title={value}>
        {value}
        {hint ? <span className="ml-1 text-muted-foreground">{hint}</span> : null}
      </dd>
    </div>
  );
}

function Leg({
  label,
  address,
  accent,
}: {
  label: string;
  address: string;
  accent?: boolean;
}) {
  return (
    <li className="relative">
      <span
        aria-hidden
        className={`absolute -left-6 top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-card ${
          accent ? "bg-brand" : "bg-muted-foreground/50"
        }`}
      />
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-base text-foreground">{address}</p>
    </li>
  );
}

function Line({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={accent ? "text-brand" : "text-foreground"}>{value}</dd>
    </div>
  );
}

/** A sub-heading inside the single actions panel, replacing what used to be its own card. */
function Labelled({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {note ? <p className="mt-0.5 text-xs text-muted-foreground">{note}</p> : null}
      <div className="mt-3">{children}</div>
    </div>
  );
}

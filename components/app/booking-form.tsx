"use client";

import { useActionState, useState, useTransition } from "react";
import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel, ErrorNote, SectionTitle, money } from "@/components/app/shell";
import {
  quoteAction,
  confirmBookingAction,
  quoteVehiclesAction,
  type QuoteState,
} from "@/lib/actions/booking";
import { TAX_RATE, type VehicleClassOption } from "@/lib/constants";
import { money as fmtMoney } from "@/components/app/shell";
import { VehicleGallery } from "@/components/app/vehicle-gallery";
import { RoutePreview } from "@/components/app/route-preview";
import { AddressAutocomplete } from "@/components/app/address-autocomplete";
import type { FormState } from "@/lib/actions/auth";
import type { TripType } from "@/lib/api/types";

/**
 * Step-by-step booking.
 *
 * The steps follow the BOOKING and TRIP CHANGES clusters of the use-case diagram:
 * describe the journey, pick the vehicle class, then review a quoted price before
 * committing.
 *
 * Requesting a favourite chauffeur is deliberately NOT here. It remains a real feature —
 * POST /bookings/:id/favorite-driver, reachable from Favourites once a booking exists —
 * it is just no longer a step everyone has to walk past to book a car.
 *
 * Only the last step talks to the API, and it does so twice: GET /pricing/fare-estimate
 * on arrival, then POST /bookings on confirm, resubmitting exactly the inputs that were
 * priced — so the total the passenger agreed to is the one that gets created.
 */

interface BookingFormProps {
  /** Shown on review only. Credit is applied to a trip, so it cannot reduce this quote. */
  walletBalance: number | null;
  /** Fetched from the API by the page — operations owns this list, not this build. */
  vehicles: VehicleClassOption[];
}

/* ------------------------------- vocabulary -------------------------------- */

type JourneyShape = "oneway" | "roundtrip" | "package" | "multicity";

const TABS: { key: JourneyShape; label: string }[] = [
  { key: "oneway", label: "One Way" },
  { key: "roundtrip", label: "Round Trip" },
  { key: "package", label: "Package" },
  { key: "multicity", label: "Multi-City" },
];

/**
 * ⚠ TWO VALUES THE FORM NO LONGER ASKS FOR, both of which the API still requires.
 *
 * Service type and city were dropped from the form, so every booking made here is a
 * point-to-point journey priced by Seattle's rule. That has consequences worth knowing:
 *
 *   - Airport transfers and hourly charters are not bookable from this form. Both are
 *     still fully implemented server-side (flight tracking, the 72 h hourly cancellation
 *     window); nothing reaches them.
 *   - A journey anywhere else is quoted at Seattle's base fare, and without a geocoder
 *     both ends resolve to Seattle's centre.
 *
 * Change either constant, or pass them in as props, to restore the behaviour — every
 * downstream branch already handles all three trip types.
 */
const TRIP_TYPE: TripType = "point2point";
const DEFAULT_CITY = "Seattle";



/** Free-cancellation window, in hours, per the cancellation rules. */
const FREE_CANCEL_HOURS: Record<TripType, number> = {
  point2point: 24,
  airport: 24,
  hourly: 72,
};

const STEPS = ["Journey", "Vehicle", "Review"] as const;

/* ---------------------------- design system bits --------------------------- */

const fieldCls =
  "w-full bg-black/60 border border-white/20 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-primary transition-colors";
const labelCls = "block text-[10px] uppercase tracking-widest text-white/40 mb-1.5";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** "Saturday, 12 September 2026" — a review screen should not show yyyy-mm-dd. */
function longDate(value: string) {
  if (!value) return "—";
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-US", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function tomorrow() {
  const d = new Date(Date.now() + 86_400_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function BookingForm({ walletBalance, vehicles }: BookingFormProps) {
  const [step, setStep] = useState(0);

  // Every answer lives here so stepping back never loses what was typed.
  const [shape, setShape] = useState<JourneyShape>("oneway");
  const [pickup, setPickup] = useState("");
  const [drop, setDrop] = useState("");
  const [date, setDate] = useState(tomorrow());
  const [time, setTime] = useState("06:30");
  const [returnDate, setReturnDate] = useState("");
  const [returnTime, setReturnTime] = useState("");
  const [passengers, setPassengers] = useState(1);
  const [vehicleClass, setVehicleClass] = useState("sedan");

  /** Fare per class for this journey, quoted by the API when the step is entered. */
  const [prices, setPrices] = useState<Record<string, number> | null>(null);
  /** Which class's photos the lightbox is showing, if any. */
  const [gallery, setGallery] = useState<string | null>(null);
  const galleryVehicle = vehicles.find((v) => v.value === gallery) ?? null;
  const chosenVehicle = vehicles.find((v) => v.value === vehicleClass) ?? null;

  // Capacity comes from the fetched catalogue, so a class added in the console filters
  // by its real seat count rather than by anything hard-coded here.
  const seatsOf = (value: string) =>
    vehicles.find((v) => v.value === value)?.seats ?? 0;
  const largestClass = Math.max(...vehicles.map((v) => v.seats), 1);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const [quote, quoteFormAction, quoting] = useActionState<QuoteState | undefined, FormData>(
    quoteAction,
    undefined,
  );
  const [confirmState, confirmFormAction, confirming] = useActionState<
    FormState | undefined,
    FormData
  >(confirmBookingAction, undefined);

  const tripType = TRIP_TYPE;
  const city = DEFAULT_CITY;
  const isRoundTrip = shape === "roundtrip";
  const bookable = shape === "oneway" || shape === "roundtrip";

  const fare = quote?.fare;
  const input = quote?.input;
  // A round trip is two bookings at the same fare, so the quote doubles.
  const legs = isRoundTrip ? 2 : 1;
  const tax = fare ? round2(fare.fare * legs * TAX_RATE) : 0;
  const total = fare ? round2(fare.fare * legs + tax) : 0;

  /*
   * Wallet credit chosen here is a request, not a payment.
   *
   * It cannot be spent yet: credit is applied against a Trip, and no Trip exists until a
   * chauffeur takes the job. The choice rides along on the booking and is honoured the
   * moment one is assigned — so a ride that is never claimed, or is cancelled first,
   * never touches the balance and needs no refund to unwind.
   */
  const available = walletBalance ?? 0;
  const [useCredit, setUseCredit] = useState(false);
  // Never offer more than the ride is worth, or more than is actually there.
  const creditCeiling = fare ? round2(Math.min(available, total)) : 0;

  /*
   * Held as the typed string, not a number, so the field can be empty mid-edit. Parsing
   * on every keystroke would fight the cursor and snap "3" to 3.00 before someone has
   * finished typing "30".
   */
  const [creditInput, setCreditInput] = useState("");
  const typed = Number.parseFloat(creditInput);
  const chosen = Number.isFinite(typed) && typed > 0 ? round2(typed) : creditCeiling;
  const overCeiling = chosen > creditCeiling;

  const creditApplied = useCredit && !overCeiling ? chosen : 0;
  const payable = round2(total - creditApplied);

  function currentFormData() {
    const fd = new FormData();
    fd.set("city", city);
    fd.set("tripType", tripType);
    fd.set("vehicleClass", vehicleClass);
    fd.set("pickup", pickup.trim());
    fd.set("drop", drop.trim());
    fd.set("date", date);
    fd.set("time", time);
    return fd;
  }

  /** Mirrors the server's checks so a step never advances into a rejection. */
  function validate(leaving: number): boolean {
    const next: Record<string, string> = {};
    if (leaving === 0) {
      if (pickup.trim().length < 3) next.pickup = "Enter a pickup location (3 characters or more)";
      if (drop.trim().length < 3) next.drop = "Enter a drop-off location (3 characters or more)";
      if (!date) next.date = "Pick a pickup date";
      if (!time) next.time = "Pick a pickup time";
      if (isRoundTrip) {
        if (!returnDate) next.returnDate = "Pick a return date";
        if (!returnTime) next.returnTime = "Pick a return time";
        if (returnDate && `${returnDate}T${returnTime}` <= `${date}T${time}`) {
          next.returnDate = "The return must be after the outbound journey";
        }
      }
      if (passengers > largestClass) {
        next.passengers = "For parties this size, please contact us for a quote";
      }
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function goTo(target: number) {
    // Validate the step being left, not the one being entered.
    if (target > step && !validate(step)) return;
    // Moving on from the journey, drop a vehicle that cannot seat the party.
    if (target > 0 && seatsOf(vehicleClass) < passengers) {
      const fits = vehicles.find((v) => v.seats >= passengers);
      if (fits) setVehicleClass(fits.value);
    }
    // Entering the vehicle step, ask the API what each class costs for this journey.
    if (target === 1) {
      setPrices(null);
      startTransition(async () => {
        setPrices(
          await quoteVehiclesAction({
            city,
            tripType,
            scheduledAt: `${date}T${time}:00`,
          }),
        );
      });
    }
    // The price is only fetched on the way into review, so going back and changing an
    // answer always re-quotes rather than showing a stale total.
    if (target === STEPS.length - 1) {
      const fd = currentFormData();
      startTransition(() => quoteFormAction(fd));
    }
    setStep(target);
  }


  const showRoute = step > 0 && pickup.trim().length >= 3 && drop.trim().length >= 3;

  return (
    <div className="space-y-6">
      {showRoute ? (
        <RoutePreview
          pickup={pickup.trim()}
          drop={drop.trim()}
          date={date}
          time={time}
          isPeak={fare?.isPeak}
        />
      ) : null}

      {/*
        One viewer for the whole wizard rather than one per step: both the vehicle cards
        and the review summary open it, and it portals to the body anyway.
      */}
      {galleryVehicle ? (
        <VehicleGallery
          open
          photos={galleryVehicle.photos}
          title={galleryVehicle.label}
          onClose={() => setGallery(null)}
        />
      ) : null}

      <Stepper step={step} onSelect={(i) => (i < step ? setStep(i) : goTo(i))} />

      {/* ----------------------------- 1 · Journey ---------------------------- */}
      {step === 0 ? (
        <div className="w-full min-w-0 rounded-2xl border border-white/15 bg-white/5 p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] backdrop-blur-xl sm:p-8">
          <h3 className="mb-1 font-serif text-xl font-bold sm:text-2xl">Book Your Ride</h3>
          <p className="mb-4 text-xs uppercase tracking-widest text-white/50">
            Instant quote · No commitment
          </p>

          <div className="mb-5 grid grid-cols-4 gap-1 rounded-xl bg-white/5 p-1">
            {TABS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setShape(key)}
                aria-pressed={shape === key}
                className={`rounded-lg py-2 text-[9px] font-bold uppercase tracking-wider transition-all duration-200 sm:text-xs ${
                  shape === key ? "bg-primary text-white" : "text-white/50 hover:text-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {!bookable ? (
            <QuoteByRequest shape={shape} />
          ) : (
            <>
              {/*
                Continue refuses to advance when a field is wrong. Without this summary
                the only signal was a caption under the offending input, which is easy to
                miss below the fold — the button then looks broken rather than blocked.
              */}
              {Object.keys(errors).length > 0 ? (
                <div
                  role="alert"
                  className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3"
                >
                  <p className="text-sm font-medium text-red-300">
                    {Object.keys(errors).length === 1
                      ? "One detail needs fixing before we can price this:"
                      : `${Object.keys(errors).length} details need fixing before we can price this:`}
                  </p>
                  <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-xs text-red-300/85">
                    {Object.values(errors).map((message) => (
                      <li key={message}>{message}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="flex flex-col gap-4">
                <div>
                  <label className={labelCls} htmlFor="pickup">
                    Pickup Location
                  </label>
                  <AddressAutocomplete
                    id="pickup"
                    value={pickup}
                    onChange={setPickup}
                    placeholder="Address, airport, hotel..."
                    className={fieldCls}
                  />
                  <FieldNote error={errors.pickup} />
                </div>

                <div>
                  <label className={labelCls} htmlFor="drop">
                    Drop-off Location
                  </label>
                  <AddressAutocomplete
                    id="drop"
                    value={drop}
                    onChange={setDrop}
                    placeholder="Destination..."
                    className={fieldCls}
                  />
                  <FieldNote error={errors.drop} />
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className={labelCls} htmlFor="date">
                      Pickup Date
                    </label>
                    <input
                      id="date"
                      type="date"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      className={fieldCls}
                    />
                    <FieldNote error={errors.date} />
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="time">
                      Pickup Time
                    </label>
                    <input
                      id="time"
                      type="time"
                      value={time}
                      onChange={(e) => setTime(e.target.value)}
                      className={fieldCls}
                    />
                    <FieldNote error={errors.time} hint="Pacific time." />
                  </div>
                </div>

                {isRoundTrip ? (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className={labelCls} htmlFor="returnDate">
                        Return Date
                      </label>
                      <input
                        id="returnDate"
                        type="date"
                        value={returnDate}
                        onChange={(e) => setReturnDate(e.target.value)}
                        className={fieldCls}
                      />
                      <FieldNote error={errors.returnDate} />
                    </div>
                    <div>
                      <label className={labelCls} htmlFor="returnTime">
                        Return Time
                      </label>
                      <input
                        id="returnTime"
                        type="time"
                        value={returnTime}
                        onChange={(e) => setReturnTime(e.target.value)}
                        className={fieldCls}
                      />
                      <FieldNote error={errors.returnTime} />
                    </div>
                  </div>
                ) : null}

                <div>
                  <label className={labelCls} htmlFor="passengers">
                    Passengers
                  </label>
                  <select
                    id="passengers"
                    value={passengers}
                    onChange={(e) => setPassengers(Number(e.target.value))}
                    className={fieldCls}
                  >
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map((n) => (
                      <option key={n} value={n}>
                        {n} {n === 1 ? "passenger" : "passengers"}
                      </option>
                    ))}
                  </select>
                  <FieldNote
                    error={errors.passengers}
                    hint="Sets which vehicle classes you can pick next."
                  />
                </div>
              </div>

              <StepNav onNext={() => goTo(1)} />
            </>
          )}
        </div>
      ) : null}

      {/* ----------------------------- 2 · Vehicle ---------------------------- */}
      {step === 1 ? (
        <Panel>
          <SectionTitle>Which vehicle?</SectionTitle>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {vehicles.map((vehicle) => {
              const fits = vehicle.seats >= passengers;
              const selected = vehicleClass === vehicle.value;
              const price = prices?.[vehicle.value];
              const cover = vehicle.photos[0];
              return (
                <div
                  key={vehicle.value}
                  className={`group overflow-hidden rounded-xl border transition-all ${
                    !fits
                      ? "border-border opacity-45"
                      : selected
                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                        : "border-border hover:border-primary/50"
                  }`}
                >
                  {/*
                    The photo is its own button rather than part of the select target:
                    a passenger looking at the car should be able to enlarge it without
                    committing to booking it.
                  */}
                  <div className="relative aspect-[16/10] overflow-hidden bg-secondary">
                    <Image
                      src={cover.src}
                      alt={cover.alt}
                      fill
                      sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                      className={`object-cover transition-transform duration-500 ${
                        fits ? "group-hover:scale-[1.04]" : "grayscale"
                      }`}
                    />
                    {selected ? (
                      <span className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                        ✓
                      </span>
                    ) : null}

                    <button
                      type="button"
                      onClick={() => setGallery(vehicle.value)}
                      className="absolute bottom-2 left-2 inline-flex items-center gap-1.5 rounded-full bg-black/65 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-sm transition-colors hover:bg-black/85"
                    >
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M15 3h6v6M21 3l-7 7M9 21H3v-6M3 21l7-7" />
                      </svg>
                      View photos
                      <span className="text-white/60">({vehicle.photos.length})</span>
                    </button>
                  </div>

                  <button
                    type="button"
                    disabled={!fits}
                    onClick={() => setVehicleClass(vehicle.value)}
                    aria-pressed={selected}
                    className={`block w-full p-4 text-left ${
                      fits ? "" : "cursor-not-allowed"
                    }`}
                  >
                    <span className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                        {vehicle.label}
                      </span>
                      <span className="shrink-0 text-sm font-bold text-foreground">
                        {price !== undefined ? (
                          fmtMoney(price)
                        ) : prices === null ? (
                          <span className="inline-block h-3 w-12 animate-pulse rounded bg-secondary align-middle" />
                        ) : (
                          <span className="text-xs font-normal text-muted-foreground">
                            On review
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {fits ? vehicle.detail : `Seats ${vehicle.seats} — too small`}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
            Prices are for this journey, before tax, and are quoted by the same calculator
            that will charge you. Showing what seats {passengers}{" "}
            {passengers === 1 ? "passenger" : "passengers"} — you can change the class
            later from the booking, up until a chauffeur is assigned.
          </p>

          <StepNav onBack={() => setStep(0)} onNext={() => goTo(2)} nextLabel="See the price" />
        </Panel>
      ) : null}

      {/* ----------------------------- 3 · Review ----------------------------- */}
      {/*
        items-stretch, not items-start: the price column matches the summary's height
        and its confirm block sits at the foot rather than floating mid-panel.
      */}
      {step === 2 ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-stretch">
          <div className="space-y-6">
            {/* The car, with the photograph the passenger chose it from. */}
            <Panel>
              <div className="flex items-center gap-3">
                <SectionTitle>Your vehicle</SectionTitle>
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="ml-auto text-sm text-brand underline underline-offset-4"
                >
                  Change
                </button>
              </div>

              {chosenVehicle ? (
                <div className="mt-5 overflow-hidden rounded-xl border border-border">
                  {chosenVehicle.photos[0] ? (
                    <div className="relative aspect-[16/9] bg-secondary">
                      <Image
                        src={chosenVehicle.photos[0].src}
                        alt={chosenVehicle.photos[0].alt}
                        fill
                        sizes="(min-width: 1024px) 40vw, 100vw"
                        className="object-cover"
                      />
                      {chosenVehicle.photos.length > 1 ? (
                        <button
                          type="button"
                          onClick={() => setGallery(chosenVehicle.value)}
                          className="absolute bottom-2 left-2 rounded-full bg-black/65 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-sm transition-colors hover:bg-black/85"
                        >
                          View photos ({chosenVehicle.photos.length})
                        </button>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 p-4">
                    <p className="text-base font-medium text-foreground">
                      {chosenVehicle.label}
                    </p>
                    <p className="text-sm text-muted-foreground">{chosenVehicle.detail}</p>
                    <p className="ml-auto text-sm text-muted-foreground">
                      Seats {chosenVehicle.seats} · {chosenVehicle.bags} bags
                    </p>
                  </div>
                </div>
              ) : (
                <p className="mt-5 text-sm text-muted-foreground">
                  {vehicleClass} — no details available for this class.
                </p>
              )}
            </Panel>

            <Panel>
              <div className="flex items-center gap-3">
                <SectionTitle>Your journey</SectionTitle>
                <button
                  type="button"
                  onClick={() => setStep(0)}
                  className="ml-auto text-sm text-brand underline underline-offset-4"
                >
                  Change
                </button>
              </div>

              <dl className="mt-5 space-y-3 text-sm">
                <Row label="Trip type" value={isRoundTrip ? "Round trip" : "One way"} />
                <Row label="Pickup location" value={pickup} />
                <Row label="Drop-off location" value={drop} />
                <Row label="Pickup date" value={longDate(date)} />
                <Row label="Pickup time" value={`${time} PT`} />
                {isRoundTrip ? (
                  <>
                    <Row label="Return date" value={longDate(returnDate)} />
                    <Row label="Return time" value={`${returnTime} PT`} />
                  </>
                ) : null}
                <Row
                  label="Passengers"
                  value={`${passengers} ${passengers === 1 ? "passenger" : "passengers"}`}
                />
              </dl>

              {chosenVehicle && passengers > chosenVehicle.seats ? (
                <p className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 text-xs text-destructive-foreground">
                  {passengers} passengers will not fit a {chosenVehicle.seats}-seat{" "}
                  {chosenVehicle.label}. Pick a larger class before confirming.
                </p>
              ) : null}
            </Panel>
          </div>

          <Panel className="flex flex-col">
            <SectionTitle>Price</SectionTitle>

            {quoting || pending ? (
              <p className="mt-6 text-sm text-muted-foreground">Pricing your journey…</p>
            ) : quote?.error ? (
              <div className="mt-6">
                <ErrorNote>{quote.error}</ErrorNote>
              </div>
            ) : quote?.fieldErrors ? (
              <div className="mt-6 space-y-4">
                <ErrorNote>Some journey details need fixing before we can price this.</ErrorNote>
                <Button type="button" variant="outline" onClick={() => setStep(0)}>
                  Back to the journey
                </Button>
              </div>
            ) : !fare || !input ? (
              <p className="mt-6 text-sm text-muted-foreground">No price yet.</p>
            ) : (
              <>
                <dl className="mt-6 space-y-3 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">
                      Base fare
                    </dt>
                    <dd className="text-foreground">{money(fare.baseFare)}</dd>
                  </div>
                  {fare.isPeak && !fare.subscriber ? (
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">
                        Peak surcharge · ×{fare.peakMultiplier}
                      </dt>
                      <dd className="text-foreground">
                        {money(round2(fare.fare - fare.baseFare * (fare.hours ?? 1)))}
                      </dd>
                    </div>
                  ) : null}
                  {fare.isPeak && fare.subscriber ? (
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">Peak surcharge</dt>
                      <dd className="text-brand">waived · subscriber</dd>
                    </div>
                  ) : null}
                  {isRoundTrip ? (
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">Return leg</dt>
                      <dd className="text-foreground">{money(fare.fare)}</dd>
                    </div>
                  ) : null}
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Tax · 8.9%</dt>
                    <dd className="text-foreground">{money(tax)}</dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-4 border-t border-border pt-4">
                    <dt className="font-medium text-foreground">Total</dt>
                    <dd className="font-sans text-2xl font-bold text-foreground">
                      {money(total)}
                    </dd>
                  </div>
                </dl>

                {isRoundTrip ? (
                  <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                    A round trip is booked as two journeys, each cancellable on its own.
                    The return is priced at the same rate as the outbound.
                  </p>
                ) : null}

                {fare.isPeak && !fare.subscriber ? (
                  <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                    This pickup falls in a peak window.{" "}
                    <Link
                      href="/subscription"
                      className="text-brand underline underline-offset-4"
                    >
                      The monthly plan
                    </Link>{" "}
                    waives the surcharge.
                  </p>
                ) : null}

                {/* Everything above is the breakdown; the commitment sits at the foot. */}
                <div className="flex-1" />

                {available > 0 && creditCeiling > 0 ? (
                  <div className="mt-3 rounded-xl border border-border bg-secondary/40 p-4">
                    <label className="flex cursor-pointer items-start gap-3">
                      <input
                        type="checkbox"
                        checked={useCredit}
                        onChange={(event) => setUseCredit(event.target.checked)}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--brand)]"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-foreground">
                          Use your wallet credit on this ride
                        </span>
                        <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                          {money(available)} available · no withdrawal fee.{" "}
                          {useCredit
                            ? "It comes off when your chauffeur is assigned — nothing leaves your wallet before then, and you can remove it any time until the fare is charged."
                            : "Nothing is taken now."}
                        </span>
                      </span>
                    </label>

                    {useCredit ? (
                      <div className="mt-3 border-t border-border pt-3">
                        <div className="flex flex-wrap items-end gap-3">
                          <div className="w-36">
                            <label
                              htmlFor="credit-amount"
                              className="text-xs font-medium text-muted-foreground"
                            >
                              Amount to use
                            </label>
                            <Input
                              id="credit-amount"
                              type="number"
                              step="0.01"
                              min={0.01}
                              max={creditCeiling}
                              value={creditInput}
                              placeholder={creditCeiling.toFixed(2)}
                              onChange={(event) => setCreditInput(event.target.value)}
                              className="mt-1.5"
                            />
                          </div>
                          {chosen < creditCeiling && !overCeiling ? (
                            <button
                              type="button"
                              onClick={() => setCreditInput(creditCeiling.toFixed(2))}
                              className="pb-2.5 text-xs font-medium text-brand underline underline-offset-4"
                            >
                              Use all {money(creditCeiling)}
                            </button>
                          ) : null}
                        </div>

                        {overCeiling ? (
                          <p className="mt-2 text-xs text-destructive">
                            The most you can put towards this ride is {money(creditCeiling)}.
                          </p>
                        ) : (
                          <dl className="mt-3 space-y-1.5 text-sm">
                            <div className="flex justify-between gap-4">
                              <dt className="text-muted-foreground">Wallet credit</dt>
                              <dd className="text-brand">−{money(creditApplied)}</dd>
                            </div>
                            <div className="flex items-baseline justify-between gap-4">
                              <dt className="font-medium text-foreground">You pay</dt>
                              <dd className="font-sans text-lg font-bold text-foreground">
                                {money(payable)}
                              </dd>
                            </div>
                          </dl>
                        )}

                        {/* The question everyone asks before spending credit on something
                            that has not happened yet. */}
                        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                          Cancel this ride and the credit returns to your wallet: in full
                          if no chauffeur was ever assigned, otherwise 90% like any other
                          refund.
                        </p>
                      </div>
                    ) : null}
                  </div>
                ) : available > 0 ? (
                  <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                    You have {money(available)} in wallet credit, which will go towards a
                    future ride.
                  </p>
                ) : null}

                {confirmState?.error ? (
                  <div className="mt-4">
                    <ErrorNote>{confirmState.error}</ErrorNote>
                  </div>
                ) : null}

                <form action={confirmFormAction} className="mt-6 pt-2">
                  <input type="hidden" name="city" value={input.city} />
                  <input type="hidden" name="tripType" value={input.tripType} />
                  <input type="hidden" name="vehicleClass" value={input.vehicleClass} />
                  <input type="hidden" name="passengers" value={passengers} />
                  <input type="hidden" name="pickup" value={input.pickup} />
                  <input type="hidden" name="drop" value={input.drop} />
                  <input type="hidden" name="scheduledAt" value={input.scheduledAt} />
                  {isRoundTrip ? (
                    <input
                      type="hidden"
                      name="returnScheduledAt"
                      value={`${returnDate}T${returnTime}:00`}
                    />
                  ) : null}

                  <input
                    type="hidden"
                    name="walletCreditRequested"
                    value={creditApplied}
                  />

                  <Button
                    type="submit"
                    size="lg"
                    className="w-full"
                    disabled={confirming || (useCredit && overCeiling)}
                  >
                    {confirming ? "Confirming…" : `Confirm · ${money(payable)}`}
                  </Button>
                </form>

                <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                  Free cancellation up to {FREE_CANCEL_HOURS[input.tripType]} h before
                  pickup — you get 90% back as wallet credit. Cancel inside that window and
                  the fare is retained.
                </p>
              </>
            )}
          </Panel>
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------- fragments -------------------------------- */

/**
 * Package and multi-city journeys have no endpoint: the API creates one booking with
 * one pickup and one drop. Rather than accept details nothing would act on, these route
 * to the team, who quote and enter the legs.
 */
function QuoteByRequest({ shape }: { shape: JourneyShape }) {
  const isPackage = shape === "package";
  return (
    <div className="rounded-xl border border-white/15 bg-black/40 p-5">
      <p className="text-sm font-medium text-white">
        {isPackage ? "Packages are quoted by our team" : "Multi-city routes are quoted by our team"}
      </p>
      <p className="mt-2 text-xs leading-relaxed text-white/60">
        {isPackage
          ? "Multi-day and event packages are priced on the itinerary rather than a single journey."
          : "More than two stops needs each leg scheduled individually, so we build the itinerary with you."}{" "}
        Send us the details and we&apos;ll come back with a price — usually the same day.
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <Link href="/support/new">
          <Button size="lg">Request a quote</Button>
        </Link>
        <Link href="/contact">
          <Button size="lg" variant="outline">
            Contact us
          </Button>
        </Link>
      </div>
    </div>
  );
}

function FieldNote({ error, hint }: { error?: string; hint?: string }) {
  if (error) return <p className="mt-1.5 text-xs text-red-400">{error}</p>;
  if (hint) return <p className="mt-1.5 text-xs text-white/40">{hint}</p>;
  return null;
}

function Stepper({ step, onSelect }: { step: number; onSelect: (i: number) => void }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-2 text-xs">
      {STEPS.map((label, i) => {
        const state = i === step ? "current" : i < step ? "done" : "todo";
        return (
          <li key={label} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onSelect(i)}
              disabled={i > step}
              aria-current={i === step ? "step" : undefined}
              className={`flex items-center gap-2 rounded-full px-3 py-1.5 transition-colors ${
                state === "current"
                  ? "bg-primary text-primary-foreground"
                  : state === "done"
                    ? "text-foreground hover:bg-secondary"
                    : "text-muted-foreground"
              }`}
            >
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ${
                  state === "current"
                    ? "bg-primary-foreground/20"
                    : state === "done"
                      ? "bg-brand/15 text-brand"
                      : "bg-secondary"
                }`}
              >
                {state === "done" ? "✓" : i + 1}
              </span>
              {label}
            </button>
            {i < STEPS.length - 1 ? (
              <span aria-hidden className="text-muted-foreground/40">
                ›
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function StepNav({
  onBack,
  onNext,
  nextLabel = "Continue",
}: {
  onBack?: () => void;
  onNext: () => void;
  nextLabel?: string;
}) {
  return (
    <div className="mt-8 flex gap-3">
      {onBack ? (
        <Button type="button" variant="outline" onClick={onBack}>
          Back
        </Button>
      ) : null}
      <Button type="button" size="lg" className="flex-1" onClick={onNext}>
        {nextLabel}
      </Button>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right text-foreground">{value}</dd>
    </div>
  );
}

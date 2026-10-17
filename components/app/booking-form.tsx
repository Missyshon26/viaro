"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
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
import {
  CRUISE_PORTS,
  MAX_CAR_SEATS,
  MEET_AND_GREET_FEE,
  SEA_TAC_ADDRESS,
  SUPPORT_EMAIL,
  SUPPORT_PHONE,
  type VehicleClassOption,
} from "@/lib/constants";
import { money as fmtMoney } from "@/components/app/shell";
import { VehicleGallery } from "@/components/app/vehicle-gallery";
import { RoutePreview } from "@/components/app/route-preview";
import { AddressAutocomplete } from "@/components/app/address-autocomplete";
import { PassengerPicker } from "@/components/passenger-picker";
import { DateField, TimeField } from "@/components/date-time-fields";
import type { FormState } from "@/lib/actions/auth";
import type { CruisePort, TripType } from "@/lib/api/types";

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
  /** Answers carried over from the homepage widget; see app/book/page.tsx. */
  prefill?: JourneyPrefill;
}

/* ------------------------------- vocabulary -------------------------------- */

type JourneyShape = "oneway" | "roundtrip" | "package" | "multicity";

export interface JourneyPrefill {
  shape: "oneway" | "roundtrip";
  pickup: string;
  drop: string;
  date: string;
  time: string;
  returnDate: string;
  returnTime: string;
  passengers: number;
}

const TABS: { key: JourneyShape; label: string }[] = [
  { key: "oneway", label: "One Way" },
  { key: "roundtrip", label: "Round Trip" },
  { key: "package", label: "Package" },
  { key: "multicity", label: "Multi-City" },
];

/**
 * What the customer is booking. A cruise pickup is a point-to-point transfer that starts
 * at a terminal, so it maps onto the API's three trip types like this.
 */
type Service = "point2point" | "airport" | "cruise" | "hourly";

const SERVICES: { key: Service; label: string }[] = [
  { key: "point2point", label: "Point to Point" },
  { key: "airport", label: "Airport" },
  { key: "cruise", label: "Cruise Port" },
  { key: "hourly", label: "Hourly" },
];

const tripTypeFor = (service: Service): TripType =>
  service === "airport" ? "airport" : service === "hourly" ? "hourly" : "point2point";

const HOUR_OPTIONS = [2, 3, 4, 5, 6, 8, 10, 12];

/**
 * Every journey is priced by Seattle's rule: there is no geocoder, so both ends resolve
 * to Seattle's centre and a journey elsewhere is quoted at Seattle's rates.
 */
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

export function BookingForm({ walletBalance, vehicles, prefill }: BookingFormProps) {
  const [step, setStep] = useState(0);

  // Every answer lives here so stepping back never loses what was typed.
  const [shape, setShape] = useState<JourneyShape>(prefill?.shape ?? "oneway");
  const [pickup, setPickup] = useState(prefill?.pickup ?? "");
  const [drop, setDrop] = useState(prefill?.drop ?? "");
  const [date, setDate] = useState(prefill?.date || tomorrow());
  const [time, setTime] = useState(prefill?.time || "06:30");
  const [returnDate, setReturnDate] = useState(prefill?.returnDate ?? "");
  const [returnTime, setReturnTime] = useState(prefill?.returnTime ?? "");
  const [passengers, setPassengers] = useState(prefill?.passengers ?? 1);
  const [vehicleClass, setVehicleClass] = useState("sedan");
  const [service, setService] = useState<Service>("point2point");
  const [flightNumber, setFlightNumber] = useState("");
  const [cruisePort, setCruisePort] = useState<CruisePort>("pier91");
  const [cruiseShip, setCruiseShip] = useState("");
  const [hours, setHours] = useState(3);
  const [meetAndGreet, setMeetAndGreet] = useState(false);
  const [carSeats, setCarSeats] = useState(0);

  /** Fare per class for this journey, quoted by the API when the step is entered. */
  const [prices, setPrices] = useState<Record<string, number> | null>(null);
  /** Which class's photos the lightbox is showing, if any. */
  const [gallery, setGallery] = useState<string | null>(null);
  const tripType = tripTypeFor(service);
  // Only what the API will quote for this kind of trip: an hourly-only class (NEMT)
  // appears on the Hourly tab alone, a transfers-only class never does.
  const offered = vehicles.filter((v) =>
    tripType === "hourly" ? v.usage !== "transfer" : v.usage !== "hourly",
  );
  const galleryVehicle = vehicles.find((v) => v.value === gallery) ?? null;
  const chosenVehicle = vehicles.find((v) => v.value === vehicleClass) ?? null;

  // Capacity comes from the fetched catalogue, so a class added in the console filters
  // by its real seat count rather than by anything hard-coded here.
  const seatsOf = (value: string) =>
    offered.find((v) => v.value === value)?.seats ?? 0;
  const largestClass = Math.max(...offered.map((v) => v.seats), 1);

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

  const city = DEFAULT_CITY;
  // An hourly charter is a single block of time; it has no return leg.
  const isRoundTrip = shape === "roundtrip" && service !== "hourly";
  const cruise = CRUISE_PORTS.find((p) => p.value === cruisePort) ?? CRUISE_PORTS[0];
  // A cruise pickup starts at the terminal, whatever was typed before switching.
  const pickupAddress = service === "cruise" ? cruise.address : pickup.trim();
  const bookable = shape === "oneway" || shape === "roundtrip";

  const fare = quote?.fare;
  const input = quote?.input;
  // A round trip is two bookings at the same fare, so the quote doubles. The rate card
  // is the price: no tax is added on top.
  const legs = isRoundTrip ? 2 : 1;
  const total = fare ? round2(fare.fare * legs) : 0;

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
    fd.set("pickup", pickupAddress);
    fd.set("drop", drop.trim());
    fd.set("date", date);
    fd.set("time", time);
    if (tripType === "airport") fd.set("flightNumber", flightNumber.trim());
    if (tripType === "hourly") fd.set("hours", String(hours));
    if (meetAndGreet) fd.set("meetAndGreet", "true");
    fd.set("carSeats", String(carSeats));
    if (service === "cruise") {
      fd.set("cruisePort", cruisePort);
      if (cruiseShip.trim()) fd.set("cruiseShip", cruiseShip.trim());
    }
    return fd;
  }

  /** Switching to Airport starts the pickup at Sea-Tac, which is where most begin. */
  function chooseService(next: Service) {
    setService(next);
    if (next === "airport" && !pickup.trim()) setPickup(SEA_TAC_ADDRESS);
  }

  /** Mirrors the server's checks so a step never advances into a rejection. */
  function validate(leaving: number): boolean {
    const next: Record<string, string> = {};
    if (leaving === 0) {
      if (pickupAddress.length < 3) next.pickup = "Enter a pickup location (3 characters or more)";
      // An hourly charter can end where it started; the drop-off is optional there.
      if (tripType !== "hourly" && drop.trim().length < 3) {
        next.drop = "Enter a drop-off location (3 characters or more)";
      }
      if (tripType === "airport" && flightNumber.trim().length < 2) {
        next.flightNumber = "Enter your flight number, e.g. AS 123";
      }
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
    // The same when the chosen class is not offered for this kind of trip.
    if (target > 0 && seatsOf(vehicleClass) < passengers) {
      const fits = offered.find((v) => v.seats >= passengers);
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
            ...(tripType === "hourly" ? { hours } : {}),
            pickup: pickupAddress,
            drop: drop.trim() || pickupAddress,
            meetAndGreet,
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

  /*
   * Arriving from the homepage search with the journey already described, go straight to
   * vehicle choice, as Blacklane does after its search box. If anything is missing or
   * wrong, validate() leaves them on the journey step with the problems listed.
   */
  const autoAdvanced = useRef(false);
  useEffect(() => {
    if (!prefill || autoAdvanced.current) return;
    autoAdvanced.current = true;
    goTo(1);
    // Runs once, on arrival; goTo reads the initial state set from `prefill`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  const showRoute = step > 0 && pickupAddress.length >= 3 && drop.trim().length >= 3;

  return (
    <div className="space-y-6">
      {showRoute ? (
        <RoutePreview
          pickup={pickupAddress}
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
              <div
                role="radiogroup"
                aria-label="Service"
                className="mb-5 grid grid-cols-2 gap-1 rounded-xl border border-white/10 p-1 sm:grid-cols-4"
              >
                {SERVICES.map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={service === key}
                    onClick={() => chooseService(key)}
                    className={`rounded-lg py-2 text-[10px] font-bold uppercase tracking-wider transition-all duration-200 sm:text-xs ${
                      service === key ? "bg-white/15 text-white" : "text-white/50 hover:text-white"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {service === "hourly" && shape === "roundtrip" ? (
                <p className="mb-4 text-xs text-white/50">
                  An hourly charter is one block of time, so it is booked one way.
                </p>
              ) : null}

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
                {service === "cruise" ? (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className={labelCls} htmlFor="cruisePort">
                        Cruise Terminal
                      </label>
                      <select
                        id="cruisePort"
                        value={cruisePort}
                        onChange={(e) => setCruisePort(e.target.value as CruisePort)}
                        className={fieldCls}
                      >
                        {CRUISE_PORTS.map((port) => (
                          <option key={port.value} value={port.value}>
                            {port.label}
                          </option>
                        ))}
                      </select>
                      <FieldNote hint={cruise.address} />
                    </div>
                    <div>
                      <label className={labelCls} htmlFor="cruiseShip">
                        Ship (optional)
                      </label>
                      <input
                        id="cruiseShip"
                        value={cruiseShip}
                        maxLength={80}
                        onChange={(e) => setCruiseShip(e.target.value)}
                        placeholder="e.g. Norwegian Encore"
                        className={fieldCls}
                      />
                      <FieldNote hint="Helps your chauffeur find you at disembarkation." />
                    </div>
                  </div>
                ) : (
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
                )}

                {service === "airport" ? (
                  <div>
                    <label className={labelCls} htmlFor="flightNumber">
                      Flight Number
                    </label>
                    <input
                      id="flightNumber"
                      value={flightNumber}
                      maxLength={10}
                      autoCapitalize="characters"
                      onChange={(e) => setFlightNumber(e.target.value.toUpperCase())}
                      placeholder="e.g. AS 123"
                      className={fieldCls}
                      aria-invalid={Boolean(errors.flightNumber)}
                    />
                    <FieldNote
                      error={errors.flightNumber}
                      hint="We track the flight, so a delay doesn't cost you your car."
                    />
                  </div>
                ) : null}

                <div>
                  <label className={labelCls} htmlFor="drop">
                    {service === "hourly" ? "Final Drop-off (optional)" : "Drop-off Location"}
                  </label>
                  <AddressAutocomplete
                    id="drop"
                    value={drop}
                    onChange={setDrop}
                    placeholder={service === "hourly" ? "Leave blank to end at the pickup" : "Destination..."}
                    className={fieldCls}
                  />
                  <FieldNote error={errors.drop} />
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className={labelCls} htmlFor="date">
                      Pickup Date
                    </label>
                    <DateField id="date" value={date} onChange={setDate} className={fieldCls} />
                    <FieldNote error={errors.date} />
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="time">
                      Pickup Time
                    </label>
                    <TimeField id="time" value={time} onChange={setTime} className={fieldCls} />
                    <FieldNote error={errors.time} hint="Pacific time." />
                  </div>
                </div>

                {service === "hourly" ? (
                  <div>
                    <label className={labelCls} htmlFor="hours">
                      Hours
                    </label>
                    <select
                      id="hours"
                      value={hours}
                      onChange={(e) => setHours(Number(e.target.value))}
                      className={fieldCls}
                    >
                      {HOUR_OPTIONS.map((h) => (
                        <option key={h} value={h}>
                          {h} hours
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}

                {isRoundTrip ? (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className={labelCls} htmlFor="returnDate">
                        Return Date
                      </label>
                      <DateField
                        id="returnDate"
                        value={returnDate}
                        onChange={setReturnDate}
                        min={date}
                        className={fieldCls}
                      />
                      <FieldNote error={errors.returnDate} />
                    </div>
                    <div>
                      <label className={labelCls} htmlFor="returnTime">
                        Return Time
                      </label>
                      <TimeField
                        id="returnTime"
                        value={returnTime}
                        onChange={setReturnTime}
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
                  <PassengerPicker
                    id="passengers"
                    value={passengers}
                    onChange={setPassengers}
                    className={fieldCls}
                  />
                  <FieldNote
                    error={errors.passengers}
                    hint="Sets which vehicle classes you can pick next."
                  />
                  {errors.passengers ? (
                    <Link
                      href="/?scrollTo=contact-us"
                      className="mt-2 inline-block text-xs font-semibold uppercase tracking-widest text-brand underline underline-offset-4"
                    >
                      Request a group quote
                    </Link>
                  ) : null}
                </div>

                <fieldset className="rounded-xl border border-white/15 p-4">
                  <legend className="px-1 text-[10px] uppercase tracking-widest text-white/40">
                    Extras
                  </legend>
                  <label className="flex cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      checked={meetAndGreet}
                      onChange={(e) => setMeetAndGreet(e.target.checked)}
                      className="mt-0.5 h-4 w-4 accent-[var(--primary)]"
                    />
                    <span className="min-w-0 flex-1 text-sm text-white">
                      Meet and Greet
                      <span className="block text-xs text-white/50">
                        Your chauffeur meets you inside with a name sign.
                      </span>
                    </span>
                    <span className="text-sm font-semibold text-white">
                      +{fmtMoney(MEET_AND_GREET_FEE)}
                    </span>
                  </label>

                  <div className="mt-4 flex items-center gap-3">
                    <span className="min-w-0 flex-1 text-sm text-white" id="carSeatsLabel">
                      Child car seats
                      <span className="block text-xs text-white/50">Free · up to {MAX_CAR_SEATS}</span>
                    </span>
                    <div className="flex items-center gap-2" role="group" aria-labelledby="carSeatsLabel">
                      <button
                        type="button"
                        onClick={() => setCarSeats((n) => Math.max(0, n - 1))}
                        disabled={carSeats === 0}
                        aria-label="One fewer car seat"
                        className="h-8 w-8 rounded-full border border-white/20 text-white disabled:opacity-30"
                      >
                        −
                      </button>
                      <span className="w-5 text-center text-sm font-semibold text-white" aria-live="polite">
                        {carSeats}
                      </span>
                      <button
                        type="button"
                        onClick={() => setCarSeats((n) => Math.min(MAX_CAR_SEATS, n + 1))}
                        disabled={carSeats === MAX_CAR_SEATS}
                        aria-label="One more car seat"
                        className="h-8 w-8 rounded-full border border-white/20 text-white disabled:opacity-30"
                      >
                        +
                      </button>
                    </div>
                  </div>
                </fieldset>
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
            {offered.map((vehicle) => {
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
                    {cover ? (
                      <Image
                        src={cover.src}
                        alt={cover.alt}
                        fill
                        sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                        className={`object-cover transition-transform duration-500 ${
                          fits ? "group-hover:scale-[1.04]" : "grayscale"
                        }`}
                      />
                    ) : (
                      // A class added in the console before its photography exists.
                      <span className="absolute inset-0 flex items-center justify-center text-xs uppercase tracking-widest text-muted-foreground">
                        {vehicle.label}
                      </span>
                    )}
                    {selected ? (
                      <span className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                        ✓
                      </span>
                    ) : null}

                    {vehicle.photos.length ? (
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
                    ) : null}
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
            Prices are the total for this journey{meetAndGreet ? ", Meet and Greet included" : ""},
            quoted by the same calculator that will charge you. Showing what seats {passengers}{" "}
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
                <Row label="Service" value={SERVICES.find((x) => x.key === service)?.label ?? ""} />
                <Row label="Trip type" value={isRoundTrip ? "Round trip" : "One way"} />
                {service === "cruise" ? (
                  <>
                    <Row label="Cruise terminal" value={cruise.label} />
                    {cruiseShip.trim() ? <Row label="Ship" value={cruiseShip.trim()} /> : null}
                  </>
                ) : null}
                <Row label="Pickup location" value={pickupAddress} />
                <Row
                  label="Drop-off location"
                  value={drop.trim() || (service === "hourly" ? "Back to the pickup" : "")}
                />
                {service === "airport" ? <Row label="Flight" value={flightNumber.trim()} /> : null}
                {service === "hourly" ? <Row label="Hours" value={`${hours} hours`} /> : null}
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
                <Row
                  label="Extras"
                  value={
                    [
                      meetAndGreet ? "Meet and Greet" : null,
                      carSeats ? `${carSeats} car seat${carSeats > 1 ? "s" : ""} (free)` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "None"
                  }
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
                  {fare.pricingModel && fare.pricingModel !== "multiplier" ? (
                    // A fixed rate is the price: no base fare, no peak line to explain.
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">
                        {chosenVehicle?.label ?? "Vehicle"} ·{" "}
                        {fare.pricingModel === "hourly"
                          ? `${fare.hours ?? 1} h`
                          : fare.pricingModel === "route"
                            ? fare.route
                            : "flat rate"}
                        {fare.minimumFare ? " · minimum fare" : ""}
                      </dt>
                      <dd className="text-foreground">{money(fare.classFare ?? fare.fare)}</dd>
                    </div>
                  ) : (
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">
                      Base fare
                    </dt>
                    <dd className="text-foreground">{money(fare.baseFare)}</dd>
                  </div>
                  )}
                  {(fare.peakApplied ?? fare.isPeak) && !fare.subscriber ? (
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">
                        Peak surcharge · ×{fare.peakMultiplier}
                      </dt>
                      <dd className="text-foreground">
                        {money(
                          round2(
                            (fare.classFare ?? fare.fare) -
                              fare.baseFare * (fare.hours ?? 1) * fare.vehicleMultiplier,
                          ),
                        )}
                      </dd>
                    </div>
                  ) : null}
                  {(fare.pricingModel ?? "multiplier") === "multiplier" &&
                  fare.vehicleMultiplier !== 1 ? (
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">
                        {chosenVehicle?.label ?? "Vehicle"} · ×{fare.vehicleMultiplier}
                      </dt>
                      <dd className="text-foreground">
                        {money(
                          round2(fare.baseFare * (fare.hours ?? 1) * (fare.vehicleMultiplier - 1)),
                        )}
                      </dd>
                    </div>
                  ) : null}
                  {fare.isPeak && fare.subscriber && fare.pricingModel !== "flat" && fare.pricingModel !== "hourly" ? (
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">Peak surcharge</dt>
                      <dd className="text-brand">waived · subscriber</dd>
                    </div>
                  ) : null}
                  {fare.primetimeSurcharge ? (
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">Primetime surcharge · 10pm–7am</dt>
                      <dd className="text-foreground">{money(fare.primetimeSurcharge)}</dd>
                    </div>
                  ) : null}
                  {fare.meetAndGreetFee ? (
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">Meet and Greet</dt>
                      <dd className="text-foreground">{money(fare.meetAndGreetFee)}</dd>
                    </div>
                  ) : null}
                  {carSeats ? (
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">
                        Child car seat{carSeats > 1 ? `s × ${carSeats}` : ""}
                      </dt>
                      <dd className="text-brand">free</dd>
                    </div>
                  ) : null}
                  {isRoundTrip ? (
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">Return leg</dt>
                      <dd className="text-foreground">{money(fare.fare)}</dd>
                    </div>
                  ) : null}
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

                {fare.primetimeSurcharge ? (
                  <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                    Pickups between 10pm and 7am carry a {money(fare.primetimeSurcharge)} primetime
                    surcharge per journey.
                  </p>
                ) : null}

                {(fare.peakApplied ?? fare.isPeak) && !fare.subscriber ? (
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

                {/*
                  Wallet credit, compact: one line with a switch, and the amount only once
                  it is switched on. It used to be a large boxed panel with three
                  paragraphs, heavier than the price it adjusts.
                */}
                {available > 0 && creditCeiling > 0 ? (
                  <div className="mt-3 rounded-lg border border-border px-3 py-2.5">
                    <label className="flex cursor-pointer items-center gap-3">
                      <span className="min-w-0 flex-1 text-sm">
                        <span className="text-cloud">Use wallet credit</span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {money(available)} available
                        </span>
                      </span>
                      <input
                        type="checkbox"
                        role="switch"
                        checked={useCredit}
                        onChange={(event) => setUseCredit(event.target.checked)}
                        className="peer sr-only"
                      />
                      <span
                        aria-hidden
                        className="relative h-5 w-9 shrink-0 rounded-full bg-secondary transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-cloud after:transition-transform peer-checked:after:translate-x-4"
                      />
                    </label>

                    {useCredit ? (
                      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border pt-2.5 text-sm">
                        <label htmlFor="credit-amount" className="text-muted-foreground">
                          Amount
                        </label>
                        <div className="relative w-28">
                          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                          <Input
                            id="credit-amount"
                            type="number"
                            inputMode="decimal"
                            step="0.01"
                            min={0.01}
                            max={creditCeiling}
                            value={creditInput}
                            placeholder={creditCeiling.toFixed(2)}
                            onChange={(event) => setCreditInput(event.target.value)}
                            className="h-8 pl-6 text-sm"
                          />
                        </div>
                        {chosen < creditCeiling && !overCeiling ? (
                          <button
                            type="button"
                            onClick={() => setCreditInput(creditCeiling.toFixed(2))}
                            className="text-xs font-medium text-azure underline underline-offset-4"
                          >
                            Max
                          </button>
                        ) : null}
                        <span className={`ml-auto ${overCeiling ? "text-destructive" : "text-azure"}`}>
                          {overCeiling ? `Max ${money(creditCeiling)}` : `−${money(creditApplied)}`}
                        </span>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {useCredit && !overCeiling && creditApplied > 0 ? (
                  <div className="mt-3 flex items-baseline justify-between gap-4 text-sm">
                    <span className="font-medium text-cloud">You pay</span>
                    <span className="font-sans text-lg font-semibold text-cloud">{money(payable)}</span>
                  </div>
                ) : null}
                {useCredit ? (
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    Taken when your chauffeur is assigned. Cancel before then and it all comes back.
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
                  {input.flightNumber ? (
                    <input type="hidden" name="flightNumber" value={input.flightNumber} />
                  ) : null}
                  {input.hours ? <input type="hidden" name="hours" value={input.hours} /> : null}
                  {input.meetAndGreet ? <input type="hidden" name="meetAndGreet" value="true" /> : null}
                  <input type="hidden" name="carSeats" value={input.carSeats} />
                  {input.cruisePort ? (
                    <input type="hidden" name="cruisePort" value={input.cruisePort} />
                  ) : null}
                  {input.cruiseShip ? (
                    <input type="hidden" name="cruiseShip" value={input.cruiseShip} />
                  ) : null}
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

                <div className="mt-4 rounded-lg border border-border px-3.5 py-3 text-xs leading-relaxed text-muted-foreground">
                  <p className="font-medium text-foreground">Cancellation policy</p>
                  <p className="mt-1">
                    Cancel at least {FREE_CANCEL_HOURS[input.tripType]} hours before pickup and
                    you get 90% back as wallet credit — a 10% admin fee applies. Cancel within{" "}
                    {FREE_CANCEL_HOURS[input.tripType]} hours of pickup and the fare is not refunded.
                  </p>
                  <p className="mt-2">
                    Questions? Call {SUPPORT_PHONE} or email {SUPPORT_EMAIL}.
                  </p>
                </div>
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

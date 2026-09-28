"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { AddressAutocomplete } from "@/components/app/address-autocomplete";
import { PassengerPicker } from "@/components/passenger-picker";
import { DateField, TimeField } from "@/components/date-time-fields";

/**
 * The booking widget in the homepage hero.
 *
 * Modelled on the Blacklane flow: the widget is the first step of booking, not a
 * decoration in front of it. What is typed here travels to /book in the URL, and /book
 * opens straight on vehicle choice when the journey is complete — so nobody enters the
 * same pickup twice. (It used to link to a bare /book and drop every field.)
 *
 * Packages and multi-city trips cannot be booked online (the API creates one booking
 * with one pickup and one drop), so those two tabs hand the itinerary to the quote form
 * further down the page, already written out, instead.
 */

type TripType = "oneway" | "roundtrip" | "package" | "multicity";

/** Event the quote form listens for, carrying a pre-written message. */
export const PREFILL_QUOTE_EVENT = "viaro:prefill-quote";

const inputCls =
  "w-full bg-black/60 border border-white/20 rounded-xl px-4 py-3 text-base sm:text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-primary transition-colors";
const labelCls = "block text-[10px] uppercase tracking-widest text-white/50 mb-1.5";

function FieldError({ message }: { message?: string }) {
  return message ? <p className="mt-1.5 text-xs text-red-400">{message}</p> : null;
}

export function HeroBookingForm({ t }: { t: any }) {
  const router = useRouter();
  const [trip, setTrip] = useState<TripType>("oneway");
  const [stops, setStops] = useState<string[]>(["", ""]);
  const [service, setService] = useState("");
  const [pickup, setPickup] = useState("");
  const [dropoff, setDropoff] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [dateReturn, setDateReturn] = useState("");
  const [timeReturn, setTimeReturn] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [pkgNotes, setPkgNotes] = useState("");
  const [passengers, setPassengers] = useState(1);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const bookable = trip === "oneway" || trip === "roundtrip";

  const tabs: { key: TripType; label: string }[] = [
    { key: "oneway", label: t.trip_oneway ?? "One Way" },
    { key: "roundtrip", label: t.trip_roundtrip ?? "Round Trip" },
    { key: "package", label: t.trip_package ?? "Package" },
    { key: "multicity", label: t.trip_multicity ?? "Multi-City" },
  ];

  const addStop = () => setStops((s) => [...s, ""]);
  const removeStop = (i: number) => setStops((s) => s.filter((_, idx) => idx !== i));
  const updateStop = (i: number, val: string) =>
    setStops((s) => s.map((v, idx) => (idx === i ? val : v)));

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (trip === "multicity") {
      if (stops.some((s) => s.trim().length < 3)) next.stops = "Fill in every stop, or remove the empty ones";
    } else {
      if (pickup.trim().length < 3) next.pickup = "Where should we pick you up?";
      if (trip !== "package" && dropoff.trim().length < 3) next.dropoff = "Where are you going?";
    }
    if (!date) next.date = "Pick a date";
    if (trip === "roundtrip" && dateReturn && date && dateReturn < date) {
      next.dateReturn = "The return must be after the outbound date";
    }
    if (!Number.isFinite(passengers) || passengers < 1) next.passengers = "How many passengers?";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!validate()) return;

    if (bookable) {
      const params = new URLSearchParams();
      params.set("trip", trip);
      params.set("pickup", pickup.trim());
      params.set("drop", dropoff.trim());
      params.set("date", date);
      if (time) params.set("time", time);
      if (trip === "roundtrip") {
        if (dateReturn) params.set("returnDate", dateReturn);
        if (timeReturn) params.set("returnTime", timeReturn);
      }
      params.set("passengers", String(passengers));
      router.push(`/book?${params.toString()}`);
      return;
    }

    // Package / multi-city: write the itinerary into the quote form and take them there.
    const lines =
      trip === "package"
        ? [
            "Package request",
            `Pickup: ${pickup.trim()}`,
            dropoff.trim() ? `Drop-off: ${dropoff.trim()}` : null,
            `Dates: ${date}${dateEnd ? ` to ${dateEnd}` : ""}`,
            pkgNotes.trim() ? `Details: ${pkgNotes.trim()}` : null,
          ]
        : [
            "Multi-city request",
            ...stops.map((s, i) =>
              i === 0 ? `Pickup: ${s.trim()}` : i === stops.length - 1 ? `Final destination: ${s.trim()}` : `Stop ${i}: ${s.trim()}`,
            ),
            `Date: ${date}${time ? ` at ${time}` : ""}`,
          ];
    lines.push(`Passengers: ${passengers}`);
    if (service) lines.push(`Service: ${service}`);

    window.dispatchEvent(
      new CustomEvent(PREFILL_QUOTE_EVENT, { detail: lines.filter(Boolean).join("\n") }),
    );
    document.getElementById("contact-us")?.scrollIntoView({ behavior: "smooth" });
  }

  const locationFields = (dropLabel?: string) => (
    <>
      <div>
        <label className={labelCls} htmlFor="hero-pickup">
          {t.form_pickup ?? "Pickup Location"}
        </label>
        <AddressAutocomplete
          id="hero-pickup"
          value={pickup}
          onChange={setPickup}
          placeholder={t.form_pickup_placeholder ?? "Address, airport, hotel..."}
          className={inputCls}
        />
        <FieldError message={errors.pickup} />
      </div>
      <div>
        <label className={labelCls} htmlFor="hero-dropoff">
          {dropLabel ?? t.form_dropoff ?? "Drop-off Location"}
        </label>
        <AddressAutocomplete
          id="hero-dropoff"
          value={dropoff}
          onChange={setDropoff}
          placeholder={t.form_dropoff_placeholder ?? "Destination..."}
          className={inputCls}
        />
        <FieldError message={errors.dropoff} />
      </div>
    </>
  );

  const dateTime = (dateLabel: string) => (
    <div className="grid grid-cols-2 gap-3 sm:gap-4">
      <div className="min-w-0">
        <label className={labelCls} htmlFor="hero-date">{dateLabel}</label>
        <DateField id="hero-date" value={date} onChange={setDate} className={inputCls} placeholder="Date" />
        <FieldError message={errors.date} />
      </div>
      <div className="min-w-0">
        <label className={labelCls} htmlFor="hero-time">{t.form_time ?? "Time"}</label>
        <TimeField id="hero-time" value={time} onChange={setTime} className={inputCls} placeholder="Time" />
      </div>
    </div>
  );

  return (
    <form
      onSubmit={submit}
      noValidate
      className="w-full min-w-0 rounded-2xl border border-white/15 bg-black/55 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] backdrop-blur-xl sm:p-8"
    >
      <h3 className="mb-1 font-serif text-xl font-bold sm:text-2xl">
        {t.form_title ?? "Book Your Ride"}
      </h3>
      <p className="mb-4 text-xs uppercase tracking-widest text-white/50">
        {t.form_subtitle ?? "Instant quote · No commitment"}
      </p>

      <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-white/5 p-1 sm:grid-cols-4" role="tablist">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={trip === key}
            onClick={() => {
              setTrip(key);
              setErrors({});
            }}
            className={`rounded-lg py-2 text-[11px] font-bold uppercase tracking-wider transition-all duration-200 sm:text-xs ${
              trip === key ? "bg-primary text-white" : "text-white/55 hover:text-white"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-4">
        {!bookable ? (
          <div>
            <label className={labelCls} htmlFor="hero-service">{t.form_service ?? "Service Type"}</label>
            <select id="hero-service" value={service} onChange={(e) => setService(e.target.value)} className={inputCls}>
              <option value="">{t.form_service_placeholder ?? "Select a service..."}</option>
              <option value="Airport Transfer">{t.form_service_airport ?? "Airport Transfer"}</option>
              <option value="Corporate / Executive">{t.form_service_corporate ?? "Corporate / Executive"}</option>
              <option value="Cruise Port">{t.form_service_cruise ?? "Cruise Port"}</option>
              <option value="Private Jet / FBO">{t.form_service_fbo ?? "Private Jet / FBO"}</option>
              <option value="Hourly Charter">{t.form_service_hourly ?? "Hourly Charter"}</option>
            </select>
          </div>
        ) : null}

        {trip === "oneway" && (
          <>
            {locationFields()}
            {dateTime(t.form_date ?? "Date")}
          </>
        )}

        {trip === "roundtrip" && (
          <>
            {locationFields()}
            {dateTime(t.form_date_depart ?? "Departure")}
            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              <div className="min-w-0">
                <label className={labelCls} htmlFor="hero-return-date">{t.form_date_return ?? "Return"}</label>
                <DateField id="hero-return-date" value={dateReturn} min={date || undefined} onChange={setDateReturn} className={inputCls} placeholder="Date" />
                <FieldError message={errors.dateReturn} />
              </div>
              <div className="min-w-0">
                <label className={labelCls} htmlFor="hero-return-time">{t.form_time_return ?? "Return Time"}</label>
                <TimeField id="hero-return-time" value={timeReturn} onChange={setTimeReturn} className={inputCls} placeholder="Time" />
              </div>
            </div>
          </>
        )}

        {trip === "package" && (
          <>
            {locationFields()}
            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              <div className="min-w-0">
                <label className={labelCls} htmlFor="hero-date">{t.form_date ?? "Start Date"}</label>
                <DateField id="hero-date" value={date} onChange={setDate} className={inputCls} placeholder="Date" />
                <FieldError message={errors.date} />
              </div>
              <div className="min-w-0">
                <label className={labelCls} htmlFor="hero-date-end">{t.form_date_end ?? "End Date"}</label>
                <DateField id="hero-date-end" value={dateEnd} min={date || undefined} onChange={setDateEnd} className={inputCls} placeholder="Date" />
              </div>
            </div>
            <div>
              <label className={labelCls} htmlFor="hero-notes">{t.form_package_notes ?? "Package Details"}</label>
              <input
                id="hero-notes"
                type="text"
                value={pkgNotes}
                onChange={(e) => setPkgNotes(e.target.value)}
                placeholder={t.form_package_placeholder ?? "E.g. 3-day corporate retreat..."}
                className={inputCls}
              />
            </div>
          </>
        )}

        {trip === "multicity" && (
          <>
            {stops.map((val, i) => (
              <div key={i}>
                <label className={labelCls} htmlFor={`hero-stop-${i}`}>
                  {i === 0
                    ? (t.form_pickup ?? "Pickup Location")
                    : i === stops.length - 1
                      ? (t.form_dropoff ?? "Final Destination")
                      : `${t.form_stop ?? "Stop"} ${i}`}
                </label>
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <AddressAutocomplete
                      id={`hero-stop-${i}`}
                      value={val}
                      onChange={(next) => updateStop(i, next)}
                      placeholder={
                        i === 0
                          ? (t.form_pickup_placeholder ?? "Starting point...")
                          : (t.form_stop_placeholder ?? "Next destination...")
                      }
                      className={inputCls}
                    />
                  </div>
                  {i > 1 && i === stops.length - 1 && (
                    <button
                      type="button"
                      onClick={() => removeStop(i)}
                      aria-label="Remove this stop"
                      className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg border border-white/20 text-lg leading-none text-white/50 transition-colors hover:border-white/50 hover:text-white"
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>
            ))}
            <FieldError message={errors.stops} />
            <button
              type="button"
              onClick={addStop}
              className="text-left text-xs font-semibold uppercase tracking-widest text-brand transition-colors hover:text-white"
            >
              + {t.form_add_stop ?? "Add Stop"}
            </button>
            {dateTime(t.form_date ?? "Date")}
          </>
        )}

        <div>
          <label className={labelCls} htmlFor="hero-passengers">{t.form_passengers ?? "Passengers"}</label>
          <PassengerPicker
            id="hero-passengers"
            value={passengers}
            onChange={setPassengers}
            className={inputCls}
            singular={t.form_passenger ?? "passenger"}
            plural={t.form_passengers_label ?? "passengers"}
          />
          <FieldError message={errors.passengers} />
        </div>

        <button
          type="submit"
          className="mt-2 flex h-12 w-full items-center justify-center rounded-full bg-primary text-xs font-semibold uppercase tracking-widest text-white transition-colors hover:bg-brand2"
        >
          {bookable ? (t.form_cta ?? "Get Instant Quote") : "Request a Quote"}
          <ArrowRight className="ml-2 h-4 w-4" />
        </button>
        {!bookable ? (
          <p className="text-center text-xs leading-relaxed text-white/45">
            Packages and multi-city trips are priced by our team — usually the same day.
          </p>
        ) : null}
      </div>
    </form>
  );
}

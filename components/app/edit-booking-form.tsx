"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, ErrorNote } from "@/components/app/shell";
import { AddressAutocomplete } from "@/components/app/address-autocomplete";
import { DateField, TimeField } from "@/components/date-time-fields";
import { updateBookingAction } from "@/lib/actions/trip";
import { CITIES, VEHICLE_CLASSES } from "@/lib/constants";
import type { FormState } from "@/lib/actions/auth";
import type { Booking } from "@/lib/api/types";

const selectClass =
  "flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Splits the stored timestamp into the date and time inputs — in Pacific time.
 *
 * The form submits a zone-less wall-clock string that the API reads as
 * America/Los_Angeles, so the pre-filled values must be in that zone too. Local-time
 * getters reflect wherever the page happens to render; from anywhere east of UTC an
 * evening Pacific pickup pre-filled as the next calendar day, and saving made it real.
 */
const APP_TIMEZONE = "America/Los_Angeles";

function splitSchedule(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: "", time: "" };

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";

  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    time: `${part("hour")}:${part("minute")}`,
  };
}

export function EditBookingForm({ booking }: { booking: Booking }) {
  const [state, action, pending] = useActionState<FormState | undefined, FormData>(
    updateBookingAction,
    undefined,
  );

  const when = splitSchedule(booking.scheduledAt);
  // Controlled so the pickers and suggestions can drive them; posted by `name`.
  const [pickup, setPickup] = useState(booking.pickup.address);
  const [drop, setDrop] = useState(booking.drop.address);
  const [date, setDate] = useState(when.date);
  const [time, setTime] = useState(when.time);
  const defaultCity =
    CITIES.find((c) => c.name.toLowerCase() === (booking.city ?? "").toLowerCase())?.name ??
    "Seattle";

  return (
    <form action={action} className="space-y-5">
      {state?.error ? <ErrorNote>{state.error}</ErrorNote> : null}
      <input type="hidden" name="bookingId" value={booking._id} />

      <Field label="City" htmlFor="city" hint="Sets the fare rules that apply.">
        <select id="city" name="city" defaultValue={defaultCity} className={selectClass}>
          {CITIES.map((city) => (
            <option key={city.name} value={city.name}>
              {city.name}
            </option>
          ))}
        </select>
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Pickup" htmlFor="pickup" error={state?.fieldErrors?.pickup}>
          <AddressAutocomplete id="pickup" name="pickup" value={pickup} onChange={setPickup} className={selectClass} />
        </Field>
        <Field label="Drop-off" htmlFor="drop" error={state?.fieldErrors?.drop}>
          <AddressAutocomplete id="drop" name="drop" value={drop} onChange={setDrop} className={selectClass} />
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Date" htmlFor="date">
          <DateField id="date" name="date" value={date} onChange={setDate} className={selectClass} />
        </Field>
        <Field label="Time" htmlFor="time" hint="Pacific time.">
          <TimeField id="time" name="time" value={time} onChange={setTime} className={selectClass} />
        </Field>
      </div>

      <Field label="Vehicle" htmlFor="vehicleClass">
        <select
          id="vehicleClass"
          name="vehicleClass"
          defaultValue={booking.vehicleClass}
          className={selectClass}
        >
          {VEHICLE_CLASSES.map((vehicle) => (
            <option key={vehicle.value} value={vehicle.value}>
              {vehicle.label} — {vehicle.detail}
            </option>
          ))}
        </select>
      </Field>

      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Saving…" : "Save changes"}
      </Button>
    </form>
  );
}

"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { AddressInput } from "@/components/ui/AddressInput";
import { errorText } from "@/lib/api/client";
import { updateBookingDetails, type BookingChanges } from "@/lib/api/admin";
import { listVehicleClasses, type VehicleClass } from "@/lib/api/vehicles";
import { centreOf, MAX_STOPS, OCCASIONS } from "@/lib/newTrip";
import type { Booking } from "@/lib/api/types";

const field =
  "mt-1 h-11 w-full rounded-field border border-border bg-surface-raised px-3 text-body text-fg outline-none focus:border-accent";
const label = "block text-label font-bold text-fg-muted";

/** The booking's pickup as the Pacific wall time a <input type="datetime-local"> takes. */
function pacificLocal(iso: string): string {
  const parts = new Date(iso).toLocaleString("sv-SE", { timeZone: "America/Los_Angeles", hour12: false });
  return parts.slice(0, 16).replace(" ", "T");
}

function initialForm(booking: Booking) {
  return {
    pickup: booking.pickup.address,
    drop: booking.drop.address,
    stops: (booking.stops ?? []).map((s) => s.address),
    when: pacificLocal(booking.scheduledAt),
    vehicleClass: booking.vehicleClass,
    passengers: booking.passengers !== undefined ? String(booking.passengers) : "",
    checkedBags: String(booking.checkedBags ?? 0),
    carryOnBags: String(booking.carryOnBags ?? 0),
    flightNumber: booking.flightDetails?.flightNumber ?? "",
    occasion: booking.occasion ?? "",
    occasionDetails: booking.occasionDetails ?? "",
    passengerName: booking.passengerName ?? "",
    passengerPhone: booking.passengerPhone ?? "",
    description: booking.description ?? "",
    notifyCustomer: true,
  };
}
type Form = ReturnType<typeof initialForm>;

/**
 * What the form changed, as the request the API takes: only the fields that moved, so each one
 * is recorded once in the booking's change trail. There is no geocoder here (same as "Add a trip"):
 * an address whose text did not change keeps its position; a new one is placed at the middle of
 * the booking's city, and dispatch and the chauffeur read the text.
 */
export function changesFor(booking: Booking, form: Form): BookingChanges {
  const before = initialForm(booking);
  const centre = centreOf(booking.city ?? "seattle");
  const pointFor = (address: string, known: { lat: number; lng: number; address: string }[]) => {
    const match = known.find((p) => p.address === address);
    return { lat: match?.lat ?? centre.lat, lng: match?.lng ?? centre.lng, address };
  };
  const known = [booking.pickup, booking.drop, ...(booking.stops ?? [])];
  const out: BookingChanges = {};

  const pickup = form.pickup.trim();
  if (pickup && pickup !== before.pickup) out.pickup = pointFor(pickup, known);
  const drop = form.drop.trim();
  if (drop && drop !== before.drop) out.drop = pointFor(drop, known);

  const stops = form.stops.map((s) => s.trim()).filter(Boolean);
  if (stops.join("|") !== before.stops.join("|")) out.stops = stops.map((s) => pointFor(s, known));

  if (form.when && form.when !== before.when) out.scheduledAt = `${form.when}:00`;
  if (form.vehicleClass && form.vehicleClass !== before.vehicleClass) out.vehicleClass = form.vehicleClass;

  const num = (text: string) => (text.trim() === "" ? undefined : Number(text));
  const passengers = num(form.passengers);
  if (passengers !== undefined && form.passengers !== before.passengers) out.passengers = passengers;
  if (form.checkedBags !== before.checkedBags) out.checkedBags = num(form.checkedBags) ?? 0;
  if (form.carryOnBags !== before.carryOnBags) out.carryOnBags = num(form.carryOnBags) ?? 0;

  const flight = form.flightNumber.trim();
  if (booking.tripType === "airport" && flight && flight !== before.flightNumber) out.flightNumber = flight;

  if (form.occasion !== before.occasion) out.occasion = form.occasion || null;
  if (form.occasionDetails !== before.occasionDetails || form.occasion !== before.occasion) {
    const details = form.occasion === "Other" ? form.occasionDetails.trim() : "";
    if (details !== before.occasionDetails.trim()) out.occasionDetails = details || null;
  }

  const name = form.passengerName.trim();
  const phone = form.passengerPhone.trim();
  if (name !== before.passengerName || phone !== before.passengerPhone) {
    out.passengerName = name || null;
    if (name) out.passengerPhone = phone || null;
  }

  if (form.description.trim() !== before.description.trim()) out.description = form.description.trim() || null;

  return out;
}

/**
 * Operations changing a booking's details: route, time, vehicle, party, notes. No deadline —
 * dispatch can fix a pickup right up to the ride. Each change is recorded in the booking's trail
 * as made by an admin, the fare is re-quoted when it should move, the calendar event follows, and
 * the client is emailed unless that is switched off.
 */
export function EditTripButton({ booking, onChanged }: { booking: Booking; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-9 rounded-field border border-border bg-surface-raised px-3.5 text-meta font-bold text-fg-body shadow-[var(--shadow-card)] transition-colors hover:border-accent hover:text-fg"
      >
        Change trip details
      </button>
      {open ? <EditTripDialog booking={booking} onClose={() => setOpen(false)} onSaved={onChanged} /> : null}
    </>
  );
}

function EditTripDialog({ booking, onClose, onSaved }: { booking: Booking; onClose: () => void; onSaved: () => void }) {
  const titleId = useId();
  const [form, setForm] = useState<Form>(() => initialForm(booking));
  const [vehicles, setVehicles] = useState<VehicleClass[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));

  useEffect(() => {
    let cancelled = false;
    listVehicleClasses(false)
      .then((rows) => !cancelled && setVehicles(rows))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, pending]);

  const changes = useMemo(() => changesFor(booking, form), [booking, form]);
  const changed = Object.keys(changes).length > 0;
  const hourly = booking.tripType === "hourly";
  const chosen = vehicles.find((v) => v.value === form.vehicleClass);
  const seats = Number(form.passengers);

  async function save() {
    if (!changed) return;
    setPending(true);
    setError(null);
    try {
      await updateBookingDetails(booking._id, { ...changes, notifyCustomer: form.notifyCustomer });
      onSaved();
      onClose();
    } catch (err) {
      setError(errorText(err, "Could not save these changes"));
      setPending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center p-4 sm:items-center">
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        disabled={pending}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-panel/60 backdrop-blur-[2px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-card border border-border bg-surface-raised p-5 shadow-[var(--shadow-raised)]"
      >
        <h2 id={titleId} className="text-action font-bold text-fg">
          Change trip details
        </h2>
        <p className="mt-1 text-note text-fg-body">
          Only what you change is saved. The price is re-quoted when the route, time or vehicle moves, and the calendar updates.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={label} htmlFor="et-pickup">Pickup</label>
            <AddressInput id="et-pickup" value={form.pickup} onChange={(v) => set("pickup", v)} className={field} />
          </div>

          {!hourly
            ? form.stops.map((stop, i) => (
                <div key={i} className="sm:col-span-2">
                  <label className={label} htmlFor={`et-stop-${i}`}>Stop {i + 1}</label>
                  <div className="flex gap-2">
                    <div className="min-w-0 flex-1">
                      <AddressInput
                        id={`et-stop-${i}`}
                        value={stop}
                        onChange={(v) => set("stops", form.stops.map((s, j) => (j === i ? v : s)))}
                        className={field}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => set("stops", form.stops.filter((_, j) => j !== i))}
                      className="mt-1 h-11 rounded-field border border-border px-3 text-meta font-bold text-fg-body hover:border-danger hover:text-danger"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))
            : null}
          {!hourly && form.stops.length < MAX_STOPS ? (
            <div className="sm:col-span-2">
              <button
                type="button"
                onClick={() => set("stops", [...form.stops, ""])}
                className="text-note font-bold text-accent"
              >
                + Add a stop
              </button>
            </div>
          ) : null}

          <div className="sm:col-span-2">
            <label className={label} htmlFor="et-drop">Drop-off</label>
            <AddressInput id="et-drop" value={form.drop} onChange={(v) => set("drop", v)} className={field} />
          </div>

          <div>
            <label className={label} htmlFor="et-when">Pickup time (Pacific)</label>
            <input id="et-when" type="datetime-local" className={field} value={form.when} onChange={(e) => set("when", e.target.value)} />
          </div>
          <div>
            <label className={label} htmlFor="et-veh">Vehicle</label>
            <select id="et-veh" className={field} value={form.vehicleClass} onChange={(e) => set("vehicleClass", e.target.value)}>
              {!vehicles.some((v) => v.value === form.vehicleClass) ? <option value={form.vehicleClass}>{form.vehicleClass}</option> : null}
              {vehicles.map((v) => (
                <option key={v.value} value={v.value}>
                  {v.label} — up to {v.seats} passengers, {v.bags} bags
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={label} htmlFor="et-pax">Passengers</label>
            <input id="et-pax" type="number" min={1} max={60} className={field} value={form.passengers} onChange={(e) => set("passengers", e.target.value)} />
            {chosen && seats > chosen.seats ? (
              <p className="mt-1 text-note font-bold text-danger">{chosen.label} seats {chosen.seats}.</p>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label} htmlFor="et-checked">Checked bags</label>
              <input id="et-checked" type="number" min={0} max={60} className={field} value={form.checkedBags} onChange={(e) => set("checkedBags", e.target.value)} />
            </div>
            <div>
              <label className={label} htmlFor="et-carry">Carry-on bags</label>
              <input id="et-carry" type="number" min={0} max={60} className={field} value={form.carryOnBags} onChange={(e) => set("carryOnBags", e.target.value)} />
            </div>
          </div>

          {booking.tripType === "airport" ? (
            <div>
              <label className={label} htmlFor="et-flight">Flight number</label>
              <input id="et-flight" className={field} value={form.flightNumber} onChange={(e) => set("flightNumber", e.target.value)} />
            </div>
          ) : null}

          <div>
            <label className={label} htmlFor="et-occ">Occasion</label>
            <select id="et-occ" className={field} value={form.occasion} onChange={(e) => set("occasion", e.target.value)}>
              <option value="">None</option>
              {OCCASIONS.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </div>
          {form.occasion === "Other" ? (
            <div>
              <label className={label} htmlFor="et-occd">Occasion details</label>
              <input id="et-occd" className={field} maxLength={200} value={form.occasionDetails} onChange={(e) => set("occasionDetails", e.target.value)} />
            </div>
          ) : null}

          <div>
            <label className={label} htmlFor="et-pname">Passenger name (if not the client)</label>
            <input id="et-pname" className={field} value={form.passengerName} onChange={(e) => set("passengerName", e.target.value)} />
          </div>
          <div>
            <label className={label} htmlFor="et-pphone">Passenger phone</label>
            <input id="et-pphone" className={field} value={form.passengerPhone} onChange={(e) => set("passengerPhone", e.target.value)} />
          </div>

          <div className="sm:col-span-2">
            <label className={label} htmlFor="et-notes">Notes</label>
            <textarea id="et-notes" rows={3} maxLength={500} className={`${field} h-auto py-2`} value={form.description} onChange={(e) => set("description", e.target.value)} />
          </div>
        </div>

        {booking.payment ? (
          <p className="mt-4 rounded-field border border-chart-warn/40 bg-chart-warn/5 px-3.5 py-2.5 text-note text-fg-body">
            This booking is already paid. A change that moves the price does not change the amount charged: settle any difference with a refund or a new payment link.
          </p>
        ) : null}

        <label className="mt-4 flex cursor-pointer items-center gap-2.5 text-meta text-fg">
          <input
            type="checkbox"
            checked={form.notifyCustomer}
            onChange={(e) => set("notifyCustomer", e.target.checked)}
            className="h-4 w-4 accent-[var(--accent)]"
          />
          Email the client about this change
        </label>

        {error ? (
          <p role="alert" className="mt-3 rounded-field border border-danger/30 bg-danger/5 px-3.5 py-2.5 text-note font-bold text-danger">
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex items-center justify-end gap-2">
          {!changed ? <span className="mr-auto text-note text-fg-muted">Nothing changed yet</span> : null}
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="h-10 rounded-field border border-border px-4 text-meta font-bold text-fg hover:border-accent disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!changed || pending}
            aria-busy={pending}
            onClick={() => void save()}
            className="h-10 rounded-field bg-primary px-4 text-meta font-bold text-primary-fg disabled:opacity-40"
          >
            {pending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

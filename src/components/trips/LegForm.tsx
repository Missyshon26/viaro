"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useMemo } from "react";
import { classesFor, GRATUITY_OPTIONS, MAX_CAR_SEATS, MAX_STOPS, OCCASIONS, SERVICE_LABEL, type Service, type TripForm } from "@/lib/newTrip";
import type { PricingRule } from "@/lib/api/admin";
import type { VehicleClass } from "@/lib/api/vehicles";

const field =
  "mt-1 h-11 w-full rounded-field border border-border bg-surface-raised px-3 text-body text-fg outline-none focus:border-accent";
const label = "block text-label font-bold text-fg-muted";

/**
 * One leg of a trip: where, when, which car and who is travelling. The "Add a trip" page
 * shows one of these, or several for a round trip or multi-city journey.
 */
export function LegForm({
  form,
  onChange,
  vehicles,
  cities,
  prefix,
  title,
  onRemove,
}: {
  form: TripForm;
  onChange: (next: TripForm) => void;
  vehicles: VehicleClass[];
  cities: PricingRule[];
  /** Keeps element ids unique when several legs are on the page. */
  prefix: string;
  /** "Trip", or "Leg 2" on a journey. */
  title: string;
  onRemove?: () => void;
}) {
  const set = <K extends keyof TripForm>(key: K, value: TripForm[K]) => onChange({ ...form, [key]: value });
  const service = form.service;
  const offered = useMemo(() => classesFor(vehicles, service), [vehicles, service]);
  const chosenVehicle = vehicles.find((v) => v.value === form.vehicleClass);
  const id = (name: string) => `${prefix}-${name}`;

  // A vehicle chosen for one kind of trip may not exist for another.
  useEffect(() => {
    if (form.vehicleClass && !offered.some((v) => v.value === form.vehicleClass)) {
      onChange({ ...form, vehicleClass: "" });
    }
  }, [offered, form, onChange]);

  return (
    <>
    {/* ------------------------------- trip ------------------------------- */}
    <section className="rounded-card border border-border bg-surface-raised p-5">
      <div className="flex items-center gap-3">
        <h3 className="text-action font-bold text-fg">{title}</h3>
        {onRemove ? (
          <button type="button" onClick={onRemove} className="ml-auto text-note font-bold text-danger hover:underline">
            Remove this leg
          </button>
        ) : null}
      </div>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor={id("svc")}>Service</label>
          <div className="relative"><select id={id("svc")} className={`${field} appearance-none pr-10`} value={service} onChange={(e) => set("service", e.target.value as Service)}>
            {(Object.keys(SERVICE_LABEL) as Service[]).map((s) => (
              <option key={s} value={s}>{SERVICE_LABEL[s]}</option>
            ))}
          </select><ChevronDown aria-hidden size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-fg-muted" /></div>
        </div>
        <div>
          <label className={label} htmlFor={id("city")}>City (sets the price)</label>
          <div className="relative"><select id={id("city")} className={`${field} appearance-none pr-10`} value={form.city} onChange={(e) => set("city", e.target.value)}>
            {(cities.length ? cities.map((c) => c.city) : ["seattle"]).map((c) => (
              <option key={c} value={c.toLowerCase()}>{c.replace(/\b\w/g, (m) => m.toUpperCase())}</option>
            ))}
          </select><ChevronDown aria-hidden size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-fg-muted" /></div>
        </div>
        <div className="sm:col-span-2">
          <label className={label} htmlFor={id("pickup")}>Pickup address</label>
          <input id={id("pickup")} className={field} value={form.pickup} onChange={(e) => set("pickup", e.target.value)} />
        </div>

        {service !== "hourly"
          ? form.stops.map((stop, i) => (
              <div key={i} className="sm:col-span-2">
                <label className={label} htmlFor={id(`stop-${i}`)}>Stop {i + 1}</label>
                <div className="flex gap-2">
                  <input
                    id={id(`stop-${i}`)}
                    className={field}
                    value={stop}
                    onChange={(e) => set("stops", form.stops.map((s, j) => (j === i ? e.target.value : s)))}
                  />
                  <button
                    type="button"
                    onClick={() => set("stops", form.stops.filter((_, j) => j !== i))}
                    className="mt-1 h-11 shrink-0 rounded-field border border-border px-3 text-note font-bold text-fg-body"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))
          : null}
        {service !== "hourly" && form.stops.length < MAX_STOPS ? (
          <div className="sm:col-span-2">
            <button
              type="button"
              onClick={() => set("stops", [...form.stops, ""])}
              className="text-note font-bold text-accent hover:underline"
            >
              + Add a stop
            </button>
          </div>
        ) : null}

        <div className="sm:col-span-2">
          <label className={label} htmlFor={id("drop")}>{service === "hourly" ? "Where the charter ends" : "Drop-off address"}</label>
          <input id={id("drop")} className={field} value={form.drop} onChange={(e) => set("drop", e.target.value)} />
        </div>

        <div>
          <label className={label} htmlFor={id("when")}>Pickup (Pacific time)</label>
          <input id={id("when")} type="datetime-local" className={field} value={form.when} onChange={(e) => set("when", e.target.value)} />
        </div>
        {service === "hourly" ? (
          <div>
            <label className={label} htmlFor={id("hours")}>Hours</label>
            <input id={id("hours")} type="number" min={1} max={24} className={field} value={form.hours} onChange={(e) => set("hours", e.target.value)} />
          </div>
        ) : null}
        {service === "airport" ? (
          <div>
            <label className={label} htmlFor={id("flight")}>Flight number</label>
            <input id={id("flight")} className={field} value={form.flightNumber} onChange={(e) => set("flightNumber", e.target.value)} placeholder="AS1042" />
          </div>
        ) : null}
      </div>
    </section>

    {/* ------------------------------ vehicle ----------------------------- */}
    <section className="rounded-card border border-border bg-surface-raised p-5">
      <h3 className="text-action font-bold text-fg">Vehicle and party{title === "Trip" ? "" : ` — ${title}`}</h3>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={label} htmlFor={id("veh")}>Vehicle</label>
          <div className="relative"><select id={id("veh")} className={`${field} appearance-none pr-10`} value={form.vehicleClass} onChange={(e) => set("vehicleClass", e.target.value)}>
            <option value="">Choose a vehicle…</option>
            {offered.map((v) => (
              <option key={v.value} value={v.value}>
                {v.label} — up to {v.seats} passengers, {v.bags} bags
              </option>
            ))}
          </select><ChevronDown aria-hidden size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-fg-muted" /></div>
        </div>
        <div>
          <label className={label} htmlFor={id("pax")}>Passengers</label>
          <input id={id("pax")} type="number" min={1} max={60} className={field} value={form.passengers} onChange={(e) => set("passengers", e.target.value)} />
          {chosenVehicle && Number(form.passengers) > chosenVehicle.seats ? (
            <p className="mt-1 text-note font-bold text-danger">More than this vehicle seats ({chosenVehicle.seats}).</p>
          ) : null}
        </div>
      </div>
      <details className="mt-5 border-t border-border-subtle pt-4">
        <summary className="cursor-pointer text-note font-bold text-accent">Additional requirements <span className="font-normal text-fg-muted">· optional</span></summary>
        <p className="mt-2 text-label text-fg-muted">Luggage, child seats, meet and greet, gratuity, and passenger details.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor={id("occ")}>Occasion</label>
          <div className="relative"><select id={id("occ")} className={`${field} appearance-none pr-10`} value={form.occasion} onChange={(e) => set("occasion", e.target.value)}>
            <option value="">Not specified</option>
            {OCCASIONS.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select><ChevronDown aria-hidden size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-fg-muted" /></div>
        </div>
        {form.occasion === "Other" ? (
          <div className="sm:col-span-2">
            <label className={label} htmlFor={id("occd")}>What is the occasion?</label>
            <input id={id("occd")} className={field} maxLength={200} value={form.occasionDetails} onChange={(e) => set("occasionDetails", e.target.value)} />
          </div>
        ) : null}
        <div>
          <label className={label} htmlFor={id("chk")}>Checked bags</label>
          <input id={id("chk")} type="number" min={0} className={field} value={form.checkedBags} onChange={(e) => set("checkedBags", e.target.value)} />
        </div>
        <div>
          <label className={label} htmlFor={id("cry")}>Carry-on bags</label>
          <input id={id("cry")} type="number" min={0} className={field} value={form.carryOnBags} onChange={(e) => set("carryOnBags", e.target.value)} />
        </div>
        <div>
          <label className={label} htmlFor={id("tip")}>Tip for the chauffeur</label>
          <div className="relative"><select id={id("tip")} className={`${field} appearance-none pr-10`} value={form.gratuity} onChange={(e) => set("gratuity", e.target.value)}>
            {GRATUITY_OPTIONS.map((pct) => (
              <option key={pct} value={String(pct)}>
                {pct === 0 ? "No tip" : `${pct}% of the trip price`}
              </option>
            ))}
          </select><ChevronDown aria-hidden size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-fg-muted" /></div>
        </div>
        <div>
          <label className={label} htmlFor={id("seat")}>Child car seats</label>
          <input id={id("seat")} type="number" min={0} max={MAX_CAR_SEATS} className={field} value={form.carSeats} onChange={(e) => set("carSeats", e.target.value)} />
        </div>
        <label className="flex items-center gap-2.5 self-end pb-3">
          <input type="checkbox" checked={form.meetAndGreet} onChange={(e) => set("meetAndGreet", e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
          <span className="text-meta text-fg">Meet and greet</span>
        </label>
        <div>
          <label className={label} htmlFor={id("pn")}>Travelling passenger (if not the client)</label>
          <input id={id("pn")} className={field} value={form.passengerName} onChange={(e) => set("passengerName", e.target.value)} placeholder="Name" />
        </div>
        <div>
          <label className={label} htmlFor={id("pp")}>Their phone</label>
          <input id={id("pp")} type="tel" className={field} value={form.passengerPhone} onChange={(e) => set("passengerPhone", e.target.value)} />
        </div>
      </div>
      </details>
    </section>


    </>
  );
}

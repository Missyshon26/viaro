"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { X, ArrowLeft, ArrowRight, Route } from "lucide-react";
import { money } from "@/components/ui/DataTable";
import { errorText } from "@/lib/api/client";
import {
  createJourneyForClient,
  createTripForClient,
  listPricingRules,
  quoteJourneyForClient,
  quoteTripForClient,
  type PricingRule,
} from "@/lib/api/admin";
import { LegForm } from "@/components/trips/LegForm";
import { listClients, type Client } from "@/lib/api/clients";
import { listVehicleClasses, type VehicleClass } from "@/lib/api/vehicles";
import { discountLabel } from "@/lib/fareLines";
import {
  discountProblem,
  emptyDiscount,
  emptyTripForm,
  journeyPayload,
  MAX_LEGS,
  missingForJourney,
  nextLeg,
  returnLeg,
  tripPayload,
  type DiscountForm,
  type TripForm,
} from "@/lib/newTrip";

/**
 * Book a trip on a client's behalf — the phone-and-email requests.
 *
 * The same booking the passenger site makes, so every rule it enforces applies here (the
 * vehicle for the occasion, whether the luggage fits, the stop fee, the signed agreement,
 * the confirmation email). The one difference is payment: nothing is charged. The trip is
 * saved unpaid and the fare is collected afterwards from the trip's own page.
 *
 * The price shown is the server's own quote for this client and trip, refreshed as the
 * form changes, so the figure confirmed is the figure that is stored.
 */
const field =
  "mt-1 h-11 w-full rounded-field border border-border bg-surface-raised px-3 text-body text-fg outline-none focus:border-accent";
const label = "block text-label font-bold text-fg-muted";

export function AddTripModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [discarding, setDiscarding] = useState(false);
  const submitting = useRef(false);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const modal = dialog.current;
    const overflow = document.body.style.overflow;
    modal?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      modal?.close();
      document.body.style.overflow = overflow;
      opener?.focus();
    };
  }, []);

  const [legs, setLegs] = useState<TripForm[]>(() => [emptyTripForm()]);
  const [clientId, setClientId] = useState("");
  const [discount, setDiscount] = useState<DiscountForm>(emptyDiscount);
  const discountError = discountProblem(discount);
  const [vehicles, setVehicles] = useState<VehicleClass[]>([]);
  const [cities, setCities] = useState<PricingRule[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [client, setClient] = useState<Client | null>(null);
  const [search, setSearch] = useState("");
  const [matches, setMatches] = useState<Client[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  const [quote, setQuote] = useState<{
    fare: number;
    isPeak: boolean;
    fares?: number[];
    /** The lines added on top of the trip price, for a single trip. */
    extras?: { label: string; amount: number }[];
  } | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [booking, setBooking] = useState(false);
  const [bookError, setBookError] = useState<string | null>(null);
  // Set when only the first legs of a journey were saved: booking again would duplicate them.
  const [savedLegs, setSavedLegs] = useState<string | null>(null);

  const setLeg = (index: number, next: TripForm) => setLegs((prev) => prev.map((leg, i) => (i === index ? next : leg)));
  const journey = legs.length > 1;

  useEffect(() => {
    let live = true;
    Promise.all([listVehicleClasses(), listPricingRules()])
      .then(([classes, rules]) => {
        if (!live) return;
        setVehicles(classes);
        setCities(rules);
        if (rules.length && !rules.some((r) => r.city.toLowerCase() === "seattle")) {
          setLegs((prev) => prev.map((leg) => ({ ...leg, city: rules[0].city.toLowerCase() })));
        }
      })
      .catch((err) => live && setLoadError(errorText(err, "Could not load vehicles and cities")));
    return () => {
      live = false;
    };
  }, []);

  // Client search: waits for a pause in typing, and ignores an answer that arrives late.
  useEffect(() => {
    const term = search.trim();
    setSearchError(null);
    setMatches([]);
    setSearching(false);
    if (term.length < 2 || client) {
      setMatches([]);
      return;
    }
    let live = true;
    setSearching(true);
    const timer = setTimeout(() => {
      listClients({ search: term, status: "active", guest: "" }, 1, 8)
        .then((page) => live && setMatches(page.items ?? []))
        .catch((err) => live && setSearchError(errorText(err, "Could not search clients. Try again.")))
        .finally(() => live && setSearching(false));
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [search, client]);

  const missing = missingForJourney(clientId, legs) ?? discountError;
  const payload = useMemo(
    () => (missing ? null : journey ? journeyPayload(clientId, legs, discount) : tripPayload({ ...legs[0], clientId }, discount)),
    [clientId, legs, missing, journey, discount],
  );

  // The live quote.
  const latest = useRef(0);
  useEffect(() => {
    const ticket = ++latest.current;
    setQuote(null);
    setQuoteError(null);
    if (!payload) return;
    const timer = setTimeout(() => {
      const asked = journey
        ? quoteJourneyForClient(payload as ReturnType<typeof journeyPayload>).then((q) => ({
            fare: q.total,
            isPeak: false,
            fares: q.fares,
          }))
        : quoteTripForClient(payload as ReturnType<typeof tripPayload>).then((q) => ({
            fare: q.fare,
            isPeak: q.isPeak,
            extras: [
              ...(q.fuelSurcharge ? [{ label: `Fuel surcharge (${q.fuelSurchargePct}%)`, amount: q.fuelSurcharge }] : []),
              ...(q.gratuity ? [{ label: `Tip (${q.gratuityPct}%)`, amount: q.gratuity }] : []),
              ...(q.discount
                ? [{ label: discountLabel(q.discountKind), amount: -q.discount }]
                : []),
              ...(q.tax ? [{ label: `Tax (${q.taxPct}%)`, amount: q.tax }] : []),
            ],
          }));
      asked
        .then((q) => ticket === latest.current && setQuote(q))
        .catch((err) => ticket === latest.current && setQuoteError(errorText(err, "Could not price this trip")));
    }, 400);
    return () => { clearTimeout(timer); latest.current += 1; };
  }, [payload, journey]);

  async function book() {
    if (!payload || !quote || submitting.current || savedLegs) return;
    submitting.current = true;
    setBooking(true);
    setBookError(null);
    try {
      if (journey) {
        const made = await createJourneyForClient(payload as ReturnType<typeof journeyPayload>);
        if (made.error) {
          // Part of the journey is saved: stay put so the message is read, and from here the
          // dialog only leads to the trips — it must not offer to book the saved legs again.
          setBookError(made.error);
          setSavedLegs(made.bookings[0]._id);
          setBooking(false);
          return;
        }
        onCreated(made.bookings[0]._id);
      } else {
        const made = await createTripForClient(payload as ReturnType<typeof tripPayload>);
        onCreated(made.booking._id);
      }
    } catch (err) {
      setBookError(errorText(err, "Could not book this trip"));
      setBooking(false);
    } finally {
      submitting.current = false;
    }
  }

  useEffect(() => {
    if (confirming) document.getElementById("add-trip-title")?.focus();
    else document.getElementById("client-search")?.focus();
    body.current?.scrollTo({ top: 0 });
  }, [confirming]);

  const dirty = Boolean(clientId || search || legs.length > 1 || legs.some((leg) => JSON.stringify(leg) !== JSON.stringify({ ...emptyTripForm(), city: leg.city })));
  function close() {
    if (booking) return;
    if (savedLegs) { onCreated(savedLegs); return; }
    if (dirty) setDiscarding(true);
    else onClose();
  }
  function review(next: boolean) {
    setConfirming(next);
    body.current?.scrollTo({ top: 0 });
  }

  return (
    <dialog ref={dialog} aria-labelledby="add-trip-title" aria-describedby="add-trip-description" onCancel={(event) => { event.preventDefault(); close(); }} className="fixed inset-0 m-auto max-h-[92dvh] w-[calc(100%-2rem)] max-w-3xl overflow-hidden rounded-2xl border border-border bg-surface-raised p-0 text-fg shadow-2xl backdrop:bg-black/45 backdrop:backdrop-blur-sm">
      <div className="flex max-h-[92dvh] flex-col">
        <header className="flex shrink-0 items-start gap-3 border-b border-border-subtle px-5 py-5 sm:px-7">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-field bg-accent-soft text-accent"><Route size={20} /></span>
          <div className="min-w-0 flex-1"><h2 id="add-trip-title" tabIndex={-1} className="text-xl font-bold">{confirming ? "Review your trip" : "Add a trip"}</h2><p id="add-trip-description" className="mt-1 text-note text-fg-muted">{confirming ? "Check the details before sending this trip to dispatch." : "Arrange a trip for your client. Payment is collected later."}</p></div>
          <button type="button" aria-label="Close add trip" disabled={booking} onClick={close} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-field text-fg-muted hover:bg-surface disabled:opacity-40"><X size={19} /></button>
        </header>
        <div className="flex shrink-0 items-center gap-3 border-b border-border-subtle px-5 py-3 text-label sm:px-7" aria-label="Booking steps">
          <span aria-current={!confirming ? "step" : undefined} className={!confirming ? "font-bold text-accent" : "text-fg-muted"}>1. Trip details</span><ArrowRight size={13} className="text-fg-muted" /><span aria-current={confirming ? "step" : undefined} className={confirming ? "font-bold text-accent" : "text-fg-muted"}>2. Review & book</span>
        </div>
        {discarding && <div role="alert" className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border bg-accent-soft px-5 py-3 text-note"><span className="flex-1">Discard this unsaved trip?</span><button type="button" onClick={() => setDiscarding(false)} className="min-h-10 font-bold text-fg">Keep editing</button><button type="button" onClick={onClose} className="min-h-10 rounded-field border border-danger/30 px-3 font-bold text-danger">Discard trip</button></div>}
        <div ref={body} className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-surface p-4 sm:p-6">
        {bookError && <p role="alert" className="mb-4 rounded-field border border-danger/30 bg-danger/5 p-4 text-note text-danger">{bookError}{savedLegs ? " Some legs were saved. View the saved trip before creating any more legs." : ""}</p>}
        <div hidden={confirming}>
      {loadError ? (
        <p className="mb-4 rounded-field border border-danger/30 bg-danger/5 px-4 py-3 text-note font-bold text-danger">{loadError}</p>
      ) : null}

      <div className="space-y-5">
        {/* ------------------------------ client ------------------------------ */}
        <section className="rounded-card border border-border bg-surface-raised p-5">
          <h3 className="text-action font-bold text-fg">Client</h3>
          {client ? (
            <div className="mt-3 flex items-center gap-3 rounded-field border border-border bg-surface px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-body font-bold text-fg">
                  {client.name}
                  {client.isGuest ? <span className="ml-2 text-note font-bold text-fg-muted">Guest</span> : null}
                </p>
                <p className="truncate text-note text-fg-muted">
                  {client.email} · {client.phone}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setClient(null);
                  setClientId("");
                  setSearch("");
                }}
                className="ml-auto text-note font-bold text-accent hover:underline"
              >
                Change
              </button>
            </div>
          ) : (
            <div className="mt-3">
              <label className={label} htmlFor="client-search">
                Search by name, email or phone
              </label>
              <input
                id="client-search"
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoComplete="off"
                className={field}
                placeholder="Start typing…"
              />
              {searchError && <p role="alert" className="mt-2 text-note text-danger">{searchError}</p>}
              {searching ? <p className="mt-2 text-note text-fg-muted">Searching…</p> : null}
              {matches.length > 0 ? (
                <ul className="mt-2 divide-y divide-border-subtle overflow-hidden rounded-field border border-border">
                  {matches.map((m) => (
                    <li key={m._id}>
                      <button
                        type="button"
                        onClick={() => {
                          setClient(m);
                          setClientId(m._id);
                        }}
                        className="block w-full px-4 py-2.5 text-left hover:bg-surface"
                      >
                        <span className="block text-meta font-bold text-fg">{m.name}</span>
                        <span className="block text-note text-fg-muted">
                          {m.email} · {m.phone}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : search.trim().length >= 2 && !searching && !searchError ? (
                <p className="mt-2 text-note text-fg-muted">
                  No active client matches.{" "}
                  <Link href="/clients" className="font-bold text-accent hover:underline">
                    Add them in Clients
                  </Link>{" "}
                  first.
                </p>
              ) : null}
            </div>
          )}
        </section>

        {legs.map((leg, index) => (
          <LegForm
            key={index}
            prefix={`leg${index}`}
            title={journey ? `Leg ${index + 1}` : "Trip"}
            form={leg}
            onChange={(next) => setLeg(index, next)}
            vehicles={vehicles}
            cities={cities}
            onRemove={journey ? () => setLegs((prev) => prev.filter((_, i) => i !== index)) : undefined}
          />
        ))}

        {legs.length < MAX_LEGS ? (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-card border border-dashed border-border px-5 py-4">
            <span className="text-note text-fg-muted">
              {journey ? "More legs:" : "Round trip or several cities?"}
            </span>
            {legs[legs.length - 1].service !== "hourly" ? (
              <button
                type="button"
                onClick={() => setLegs((prev) => [...prev, returnLeg(prev[prev.length - 1])])}
                className="text-meta font-bold text-accent hover:underline"
              >
                + Add the return trip
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setLegs((prev) => [...prev, nextLeg(prev[prev.length - 1])])}
              className="text-meta font-bold text-accent hover:underline"
            >
              + Add another leg
            </button>
          </div>
        ) : null}

        {/* ----------------------------- discount ----------------------------- */}
        <section className="rounded-card border border-border bg-surface-raised p-5">
          <h3 className="text-action font-bold text-fg">Discount</h3>
          <p className="mt-1 text-label text-fg-muted">
            Optional. Replaces the automatic welcome or loyalty discount on this booking.
            {journey ? " On a journey, a % applies to every leg; a $ amount comes off the first leg." : ""}
          </p>
          <div className="mt-3 flex items-center gap-2">
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              aria-label="Discount amount"
              aria-invalid={discountError ? true : undefined}
              className="h-11 w-32 rounded-field border border-border bg-surface px-3 text-note"
              placeholder="0"
              value={discount.value}
              onChange={(e) => setDiscount((d) => ({ ...d, value: e.target.value }))}
            />
            <div role="group" aria-label="Discount type" className="inline-flex overflow-hidden rounded-field border border-border">
              {(["percent", "flat"] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  aria-pressed={discount.type === type}
                  onClick={() => setDiscount((d) => ({ ...d, type }))}
                  className={`h-11 w-12 text-note font-bold ${discount.type === type ? "bg-primary text-primary-fg" : "bg-surface text-fg"}`}
                >
                  {type === "percent" ? "%" : "$"}
                </button>
              ))}
            </div>
          </div>
          {discountError ? <p className="mt-2 text-note font-bold text-danger">{discountError}</p> : null}
        </section>

        {/* ------------------------------- price ------------------------------ */}
        <section className="rounded-card border border-border bg-surface-raised p-5" aria-live="polite">
          <div className="flex items-baseline gap-3">
            <h3 className="text-action font-bold text-fg">Price</h3>
            {quote ? (
              <span className="ml-auto text-[1.5rem] font-semibold text-fg">{money(quote.fare)}</span>
            ) : null}
          </div>
          {quoteError ? (
            <p className="mt-2 text-note font-bold text-danger">{quoteError}</p>
          ) : quote ? (
            <>
              {quote.extras && quote.extras.length > 0 ? (
                <ul className="mt-2 space-y-0.5 text-note text-fg-body">
                  {quote.extras.map((line) => (
                    <li key={line.label} className="flex">
                      <span>{line.label}</span>
                      <span className="ml-auto">{line.amount < 0 ? `-${money(-line.amount)}` : money(line.amount)}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {quote.fares ? (
                <ul className="mt-2 space-y-0.5 text-note text-fg-body">
                  {quote.fares.map((fare, i) => (
                    <li key={i} className="flex">
                      <span>Leg {i + 1}</span>
                      <span className="ml-auto">{money(fare)}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="mt-1 text-note text-fg-muted">
                Quoted for this client{quote.isPeak ? ", including the primetime surcharge" : ""}. Nothing is charged when you book.
              </p>
            </>
          ) : (
            <p className="mt-1 text-note text-fg-muted">{missing ?? "Pricing…"}</p>
          )}
        </section>

      </div>
      </div>
      {confirming && <div className="space-y-4">
        <section className="rounded-card border border-border bg-surface-raised p-5">
          <p className="text-label font-medium text-fg-muted">Booked for</p><p className="mt-1 text-card font-bold">{client?.name}</p><p className="mt-1 break-words text-note text-fg-muted">{client?.email}</p>
        </section>
        {legs.map((leg, index) => <section key={index} className="rounded-card border border-border bg-surface-raised p-5">
          <h3 className="text-action font-bold">{journey ? `Leg ${index + 1}` : "Trip"}</h3>
          <dl className="mt-4 grid gap-4 text-note sm:grid-cols-2">
            <div className="sm:col-span-2"><dt className="text-label text-fg-muted">Route</dt><dd className="mt-1 break-words">{[leg.pickup, ...leg.stops, leg.drop].filter(Boolean).join(" → ")}</dd></div>
            <div><dt className="text-label text-fg-muted">Pickup · Pacific time</dt><dd className="mt-1">{leg.when.replace("T", " · ")}</dd></div>
            <div><dt className="text-label text-fg-muted">Vehicle</dt><dd className="mt-1">{vehicles.find((vehicle) => vehicle.value === leg.vehicleClass)?.label ?? leg.vehicleClass}</dd></div>
          </dl>
        </section>)}
        <div className="rounded-card border border-accent/20 bg-accent-soft p-5"><p className="text-note text-fg-body">{client?.name} will receive a booking confirmation. {journey ? "All legs go" : "The trip goes"} to dispatch. No payment is collected now.</p></div>
      </div>}
      </div>
      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border bg-surface-raised px-5 py-4 sm:px-7">
        <div className="min-w-0 flex-1" aria-live="polite"><p className="text-label text-fg-muted">{quote ? "Estimated total · unpaid" : "Estimated total"}</p><p className="mt-1 text-xl font-bold">{quote ? money(quote.fare) : "—"}</p>{!quote && <p className="mt-1 text-label text-fg-muted">{quoteError ?? missing ?? "Calculating fare…"}</p>}</div>
        <div className="flex items-center gap-2">
          <button type="button" disabled={booking} onClick={() => confirming && !savedLegs ? review(false) : close()} className="inline-flex h-11 items-center gap-2 rounded-field border border-border px-4 text-note font-medium hover:bg-surface disabled:opacity-40">{confirming && !savedLegs ? <><ArrowLeft size={15} />Edit</> : "Cancel"}</button>
          <button type="button" disabled={booking || (!savedLegs && (!quote || !!missing || !!loadError))} aria-busy={booking} onClick={() => savedLegs ? onCreated(savedLegs) : confirming ? void book() : review(true)} className="inline-flex h-11 items-center justify-center gap-2 rounded-field bg-primary px-5 text-note font-bold text-primary-fg hover:brightness-105 disabled:opacity-40">{booking ? "Booking…" : savedLegs ? "Finish" : confirming ? "Book trip" : "Review trip"}{!confirming && <ArrowRight size={15} />}</button>
        </div>
      </footer>
      </div>
    </dialog>
  );
}

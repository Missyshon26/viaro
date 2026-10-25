"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ConsolePage, money } from "@/components/ui/DataTable";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
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
import {
  emptyTripForm,
  journeyPayload,
  MAX_LEGS,
  missingForJourney,
  nextLeg,
  returnLeg,
  tripPayload,
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

export default function NewTripPage() {
  const router = useRouter();
  const [legs, setLegs] = useState<TripForm[]>(() => [emptyTripForm()]);
  const [clientId, setClientId] = useState("");
  const [vehicles, setVehicles] = useState<VehicleClass[]>([]);
  const [cities, setCities] = useState<PricingRule[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [client, setClient] = useState<Client | null>(null);
  const [search, setSearch] = useState("");
  const [matches, setMatches] = useState<Client[]>([]);
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
    if (term.length < 2 || client) {
      setMatches([]);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      setSearching(true);
      listClients({ search: term, status: "active", guest: "" }, 1, 8)
        .then((page) => live && setMatches(page.items ?? []))
        .catch(() => live && setMatches([]))
        .finally(() => live && setSearching(false));
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [search, client]);

  const missing = missingForJourney(clientId, legs);
  const payload = useMemo(
    () => (missing ? null : journey ? journeyPayload(clientId, legs) : tripPayload({ ...legs[0], clientId })),
    [clientId, legs, missing, journey],
  );

  // The live quote.
  const latest = useRef(0);
  useEffect(() => {
    setQuote(null);
    setQuoteError(null);
    if (!payload) return;
    const ticket = ++latest.current;
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
              ...(q.gratuity ? [{ label: `Tip (${q.gratuityPct}%)`, amount: q.gratuity }] : []),
              ...(q.discount
                ? [{ label: q.discountKind === "welcome" ? "Welcome discount" : "Loyalty discount", amount: -q.discount }]
                : []),
              ...(q.tax ? [{ label: `Tax (${q.taxPct}%)`, amount: q.tax }] : []),
            ],
          }));
      asked
        .then((q) => ticket === latest.current && setQuote(q))
        .catch((err) => ticket === latest.current && setQuoteError(errorText(err, "Could not price this trip")));
    }, 400);
    return () => clearTimeout(timer);
  }, [payload, journey]);

  async function book() {
    if (!payload) return;
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
        router.push(`/trips/${made.bookings[0]._id}`);
      } else {
        const made = await createTripForClient(payload as ReturnType<typeof tripPayload>);
        router.push(`/trips/${made.booking._id}`);
      }
    } catch (err) {
      setBookError(errorText(err, "Could not book this trip"));
      setBooking(false);
    }
  }


  return (
    <ConsolePage
      title="Add a trip"
      description="Book a journey for a client. It is saved unpaid — collect the fare from the trip once it is agreed."
      width="narrow"
      action={
        <Link href="/trips" className="text-meta font-bold text-fg-muted hover:text-fg">
          ← Back to trips
        </Link>
      }
    >
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
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoComplete="off"
                className={field}
                placeholder="Start typing…"
              />
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
              ) : search.trim().length >= 2 && !searching ? (
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

        <div className="flex gap-3">
          <Link
            href="/trips"
            className="inline-flex h-11 flex-1 items-center justify-center rounded-field border border-border bg-surface-raised text-meta font-bold text-fg-body"
          >
            Cancel
          </Link>
          <button
            type="button"
            disabled={!quote || booking}
            onClick={() => setConfirming(true)}
            className="h-11 flex-1 rounded-field bg-primary text-meta font-bold text-primary-fg disabled:opacity-40"
          >
            {journey ? `Book this ${legs.length}-leg journey` : "Book this trip"}
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirming}
        title={journey ? "Book this journey?" : "Book this trip?"}
        confirmLabel={savedLegs ? "View the trip" : journey ? "Book journey" : "Book trip"}
        pendingLabel="Booking…"
        pending={booking}
        error={bookError}
        onConfirm={() => (savedLegs ? router.push(`/trips/${savedLegs}`) : void book())}
        onCancel={() => {
          if (savedLegs) {
            router.push("/trips");
            return;
          }
          setConfirming(false);
          setBookError(null);
        }}
      >
        <p>
          {client?.name} will get a booking confirmation
          {quote ? ` for ${money(quote.fare)}` : ""}, and {journey ? `all ${legs.length} legs go` : "the trip goes"} to dispatch. It is unpaid — collect the fare
          from the trip afterwards.
        </p>
      </ConfirmDialog>
    </ConsolePage>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ApiError } from "@/lib/api/client";
import {
  acceptTrip,
  getDispatchPool,
  listVehicleClasses,
  type PoolEntry,
  type VehicleClassInfo,
} from "@/lib/api/driver";
import { refreshNavBadges } from "@/lib/nav/useNavBadges";
import { useLiveChanges } from "@/lib/live/useLiveChanges";
import { useAuth } from "@/lib/auth/AuthProvider";

/**
 * The open pool.
 *
 * Dispatch pushes offers over the `/dispatch` socket namespace, which no client is wired
 * to yet, so this polls `GET /dispatch/pool`. Either way the accept is authoritative:
 * the socket event is a courtesy broadcast and `POST /trips/:id/accept` is what claims
 * the ride.
 *
 * The screen is built around one decision — "can I take this?" — so a card leads with
 * WHEN, which is what makes the answer yes or no, and everything else is secondary.
 *
 * Two outcomes need to be visible rather than inferred:
 *   - accepting used to make a row vanish on the next poll, which reads as a glitch. The
 *     card is now removed immediately and a confirmation names what was taken.
 *   - the pool is first-come, so another chauffeur can claim a ride between the page
 *     loading and the tap. That is an ordinary event, not an error, and it says so.
 */
interface Claimed {
  reference: string;
  route: string;
  when: string;
}

const reference = (id: string) => `VRO-${id.slice(-6).toUpperCase()}`;

const SERVICE_LABEL: Record<string, string> = {
  point2point: "Point to point",
  airport: "Airport",
  hourly: "Hourly",
};

/** "in 40 min" / "in 3 h" / "Tomorrow" — the thing a chauffeur actually weighs. */
function relative(iso?: string): { text: string; soon: boolean } {
  if (!iso) return { text: "", soon: false };
  const minutes = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  if (Number.isNaN(minutes)) return { text: "", soon: false };
  if (minutes < 0) return { text: "Overdue", soon: true };
  if (minutes < 60) return { text: `in ${minutes} min`, soon: true };
  const hours = Math.round(minutes / 60);
  if (hours < 24) return { text: `in ${hours} h`, soon: hours <= 3 };
  const days = Math.round(hours / 24);
  return { text: days === 1 ? "Tomorrow" : `in ${days} days`, soon: false };
}

const timeOf = (iso?: string) =>
  iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "—";

const dayOf = (iso?: string) =>
  iso
    ? new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
    : "";

export default function RequestsPage() {
  const { user } = useAuth();
  // The API refuses an accept from an account still awaiting document review (the same
  // rule that blocks going online), so the pool is not shown to one at all.
  const awaitingReview = user?.status === "pending_documents";

  const [entries, setEntries] = useState<PoolEntry[] | null>(null);
  const [classes, setClasses] = useState<VehicleClassInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [taken, setTaken] = useState<string | null>(null);
  const [claimed, setClaimed] = useState<Claimed | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  /**
   * `isCurrent` guards each setState against a stale response.
   *
   * These effects had no cancellation flag, so two loads in flight at once — a quick
   * navigation, or a live update firing mid-fetch — could let the slower, older response
   * land last and overwrite fresher data with nothing to stop it. The dashboard's own
   * earnings-series effect in this same app already guards exactly this way.
   */
  const load = useCallback(async (isCurrent: () => boolean = () => true) => {
    try {
      const pool = await getDispatchPool();
      if (!isCurrent()) return;

      const items = Array.isArray(pool) ? pool : (pool.items ?? []);
      // Soonest first: the pool arrives in creation order, which is not the order a
      // chauffeur cares about.
      setEntries(
        [...items].sort((a, b) => (a.scheduledAt ?? "").localeCompare(b.scheduledAt ?? "")),
      );
      setError(null);
    } catch (err) {
      if (!isCurrent()) return;
      setError(err instanceof ApiError ? err.message : "Could not load the pool");
      setEntries([]);
    }
  }, []);

  useEffect(() => {
    if (awaitingReview) return;
    let cancelled = false;
    void load(() => !cancelled);
    return () => {
      cancelled = true;
    };
  }, [load, awaitingReview]);

  /*
   * The pool used to be re-read on a fixed 15 s timer, which meant an offer could sit
   * unseen for most of its life and one already taken by another chauffeur stayed on
   * screen just as long. The stream announces both the moment they happen; it falls
   * back to polling by itself if the connection will not hold, so this is never slower
   * than the timer it replaces.
   */
  useLiveChanges(["dispatch", "booking", "trip"], () => {
    if (!awaitingReview) void load();
  });

  useEffect(() => {
    // Labels are a nicety; a failure leaves the raw key rather than blanking the page.
    listVehicleClasses()
      .then(setClasses)
      .catch(() => undefined);
  }, []);

  const labelFor = useMemo(() => {
    const byValue = new Map(classes.map((c) => [c.value, c.label]));
    return (value?: string) => (value ? (byValue.get(value) ?? value) : "");
  }, [classes]);

  async function accept(entry: PoolEntry) {
    setBusy(entry._id);
    setError(null);
    setTaken(null);

    try {
      await acceptTrip(entry._id);
      setClaimed({
        reference: reference(entry._id),
        route: `${entry.pickup?.address ?? "Pickup"} → ${entry.drop?.address ?? "Drop-off"}`,
        when: `${dayOf(entry.scheduledAt)}, ${timeOf(entry.scheduledAt)}`,
      });
      // Drop it straight away rather than waiting for the next poll, so the list
      // matches what just happened.
      setEntries((prev) => (prev ?? []).filter((e) => e._id !== entry._id));
      // The ride just moved from the pool onto this chauffeur's schedule. Tell the
      // sidebar now — waiting for its own 30s timer would leave both counts wrong at
      // exactly the moment someone is looking for confirmation.
      refreshNavBadges();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Could not accept that ride";
      // Losing a race is normal in a first-come pool, so it reads as information rather
      // than as a failure — and the stale card goes, because it is gone.
      if (/claimed|cannot be accepted|cancelled/i.test(message)) {
        setTaken(message);
        setEntries((prev) => (prev ?? []).filter((e) => e._id !== entry._id));
        // It left the pool too, just not to us.
        refreshNavBadges();
      } else {
        setError(message);
      }
    } finally {
      setBusy(null);
    }
  }

  if (awaitingReview) {
    return (
      <div className="mx-auto max-w-[900px]">
        <h1 className="text-[1.5rem] font-bold tracking-tight text-fg">Open requests</h1>
        <div className="mt-5 rounded-card border border-border bg-surface-raised p-10 text-center">
          <p className="text-card font-bold text-fg">Your account is awaiting document review</p>
          <p className="mx-auto mt-2 max-w-sm text-note leading-relaxed text-fg-muted">
            Rides can be accepted once your licence and insurance have been reviewed —
            the same rule that keeps you from going online until then.
          </p>
          <Link
            href="/documents"
            className="mt-5 inline-flex h-10 items-center rounded-field bg-primary px-5 text-meta font-bold text-primary-fg"
          >
            Manage documents
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[900px]">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-[1.5rem] font-bold tracking-tight text-fg">Open requests</h1>
          <p className="mt-1 text-note text-fg-muted">
            First to accept takes the ride · updates as offers arrive
          </p>
        </div>
        {entries && entries.length > 0 ? (
          <span className="ml-auto rounded-full bg-accent-soft px-3 py-1.5 text-meta font-bold text-accent-strong">
            {entries.length} available
          </span>
        ) : null}
      </div>

      {/* --------------------------- outcome banners --------------------------- */}
      {claimed ? (
        <div className="mt-5 rounded-card border border-success/40 bg-success/5 p-5">
          <div className="flex flex-wrap items-start gap-3">
            <span
              aria-hidden
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-success/15 text-success"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="m5 12.5 4.5 4.5L19 7.5" />
              </svg>
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-card font-bold text-fg">
                The ride is yours — {claimed.reference}
              </p>
              <p className="mt-1 truncate text-note text-fg-body">{claimed.route}</p>
              <p className="mt-0.5 text-note text-fg-muted">Pickup {claimed.when}</p>
            </div>
            <button
              type="button"
              onClick={() => setClaimed(null)}
              aria-label="Dismiss"
              className="shrink-0 text-label font-bold text-fg-muted hover:text-fg"
            >
              Dismiss
            </button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2.5">
            <Link
              href="/schedule"
              className="inline-flex h-10 items-center rounded-field bg-primary px-5 text-meta font-bold text-primary-fg"
            >
              See it on my schedule
            </Link>
            <Link
              href="/"
              className="inline-flex h-10 items-center rounded-field border border-border bg-bg px-5 text-meta font-bold text-fg-body hover:text-fg"
            >
              Back to dashboard
            </Link>
          </div>
        </div>
      ) : null}

      {taken ? (
        <p className="mt-5 rounded-card border border-border bg-surface px-4 py-3 text-note text-fg-body">
          Another chauffeur got there first. It has been removed from your list.
        </p>
      ) : null}

      {error ? (
        <p className="mt-5 rounded-card border border-danger/30 bg-danger/5 px-4 py-3 text-note font-bold text-danger">
          {error}
        </p>
      ) : null}

      {/* -------------------------------- the pool ----------------------------- */}
      <div className="mt-5 space-y-3">
        {entries === null ? (
          [0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-[92px] animate-pulse rounded-card border border-border bg-surface"
              aria-hidden
            />
          ))
        ) : entries.length === 0 ? (
          <div className="rounded-card border border-border bg-surface-raised p-10 text-center">
            <p className="text-card font-bold text-fg">No open rides right now</p>
            <p className="mx-auto mt-2 max-w-sm text-note leading-relaxed text-fg-muted">
              New offers land here automatically. Going online puts you in range for the
              ones dispatch sends directly.
            </p>
          </div>
        ) : (
          entries.map((entry) => {
            const rel = relative(entry.scheduledAt);
            return (
              <article
                key={entry._id}
                className="rounded-card border border-border bg-surface-raised p-4 shadow-[var(--shadow-card)] transition-colors hover:border-accent/50 sm:p-5"
              >
                <div className="flex flex-wrap items-center gap-4">
                  {/* When — the thing that decides whether a chauffeur can take it. */}
                  <div className="w-[86px] shrink-0">
                    <p className="text-[1.25rem] font-bold leading-none tracking-tight text-fg">
                      {timeOf(entry.scheduledAt)}
                    </p>
                    <p className="mt-1 text-label text-fg-muted">{dayOf(entry.scheduledAt)}</p>
                    {rel.text ? (
                      <p
                        className={`mt-1 text-label font-bold ${
                          rel.soon ? "text-danger" : "text-fg-muted"
                        }`}
                      >
                        {rel.text}
                      </p>
                    ) : null}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body font-bold text-fg">
                      {entry.pickup?.address ?? "Pickup"}
                    </p>
                    <p className="mt-0.5 flex items-center gap-1.5 truncate text-note text-fg-muted">
                      <span aria-hidden>↓</span>
                      {entry.drop?.address ?? "Drop-off"}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Chip>{SERVICE_LABEL[entry.tripType] ?? entry.tripType}</Chip>
                      {entry.vehicleClass ? (
                        <Chip>{labelFor(entry.vehicleClass)}</Chip>
                      ) : null}
                      {entry.flightDetails?.flightNumber ? (
                        <Chip>✈ {entry.flightDetails.flightNumber}</Chip>
                      ) : null}
                      {entry.meetAndGreet ? <Chip>Meet and Greet</Chip> : null}
                      {entry.carSeats ? (
                        <Chip>
                          {entry.carSeats} car seat{entry.carSeats > 1 ? "s" : ""}
                        </Chip>
                      ) : null}
                      {entry.serviceNotes?.some((n) => n.startsWith("Cruise pickup")) ? (
                        <Chip>Cruise pickup</Chip>
                      ) : null}
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={busy === entry._id}
                    onClick={() => accept(entry)}
                    className="h-11 w-full shrink-0 rounded-field bg-accent px-7 text-body font-bold text-primary-fg transition-opacity disabled:opacity-50 sm:w-auto"
                  >
                    {busy === entry._id ? "Accepting…" : "Accept"}
                  </button>
                </div>
              </article>
            );
          })
        )}
      </div>

      <p className="mt-6 text-note leading-relaxed text-fg-muted">
        A ride reaches the pool when nobody asked for a favourite chauffeur, or the one
        they asked for was busy. Accepting claims it on the spot.
      </p>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-surface px-2.5 py-1 text-label font-bold text-fg-body">
      {children}
    </span>
  );
}

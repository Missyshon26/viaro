"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { rateTripAction } from "@/lib/actions/trip";
import type { Trip } from "@/lib/api/types";

/**
 * Asks a passenger to rate a chauffeur once the trip is done.
 *
 * It appears wherever they happen to be rather than only on the trip page, because the
 * moment a rating is worth asking for is the moment they come back — and almost nobody
 * navigates to a finished trip on purpose to score it.
 *
 * Three things keep it from being a nuisance:
 *
 *   - it only asks about trips the API says are unrated. `rated` is a real field, so a
 *     trip scored on another device never prompts again.
 *   - "Not now" is remembered per trip in localStorage, so dismissing means dismissed.
 *   - it stays out of the way of the booking flow and the sign-in pages, where an
 *     interruption would cost more than a rating is worth.
 */
const DISMISSED_KEY = "viaro-rating-dismissed";

/** Dispatched (with a trip id) to open the prompt for a specific trip. */
export const RATE_TRIP_EVENT = "viaro:rate-trip";

/** Paths where an interruption is worse than a missing rating. */
const QUIET_PATHS = ["/book", "/login", "/register", "/forgot-password", "/reset-password"];

function readDismissed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

function dismiss(tripId: string) {
  try {
    const next = [...new Set([...readDismissed(), tripId])].slice(-50);
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
  } catch {
    /* Storage unavailable: the prompt simply reappears next visit. */
  }
}

export function RatingPrompt({ trips }: { trips: Trip[] }) {
  const pathname = usePathname();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [score, setScore] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const quiet = QUIET_PATHS.some((path) => pathname.startsWith(path));

  useEffect(() => {
    if (quiet) {
      setTrip(null);
      return;
    }
    const dismissed = new Set(readDismissed());
    // Oldest unrated first: the one most likely to be forgotten.
    setTrip(trips.find((candidate) => !dismissed.has(candidate._id)) ?? null);
  }, [trips, quiet]);

  // "Rate chauffeur" on a row in My Trips opens this prompt for that trip, even if it
  // was dismissed earlier — asking explicitly overrides "not now".
  useEffect(() => {
    function onRequest(event: Event) {
      const id = (event as CustomEvent<string>).detail;
      const wanted = trips.find((candidate) => candidate._id === id);
      if (wanted) {
        setScore(0);
        setComment("");
        setDone(false);
        setError(null);
        setTrip(wanted);
      }
    }
    window.addEventListener(RATE_TRIP_EVENT, onRequest);
    return () => window.removeEventListener(RATE_TRIP_EVENT, onRequest);
  }, [trips]);

  const close = useCallback(() => {
    if (trip) dismiss(trip._id);
    setTrip(null);
  }, [trip]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);

  if (!trip) return null;

  async function submit() {
    if (!trip || score === 0 || saving) return;
    setSaving(true);
    setError(null);

    const form = new FormData();
    form.set("tripId", trip._id);
    form.set("score", String(score));
    if (comment.trim()) form.set("comment", comment.trim());

    const result = await rateTripAction(undefined, form);
    if (result?.error) {
      setError(result.error);
      setSaving(false);
      return;
    }

    // Remembered as well as sent, so a stale trips list cannot re-prompt.
    dismiss(trip._id);
    setDone(true);
    setSaving(false);
  }

  const shown = hover || score;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center p-4 sm:right-6 sm:left-auto sm:justify-end">
      <div
        role="dialog"
        aria-modal="false"
        aria-label="Rate your trip"
        className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-2xl"
      >
        {done ? (
          <div className="text-center">
            <p className="text-base font-medium text-foreground">Thank you</p>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Your rating helps other passengers pick a chauffeur.
            </p>
            <Button variant="outline" className="mt-4 w-full" onClick={() => setTrip(null)}>
              Close
            </Button>
          </div>
        ) : (
          <>
            <div className="flex items-start gap-3">
              <div className="min-w-0">
                <p className="text-base font-medium text-foreground">
                  How was your trip?
                </p>
                <p className="mt-1 truncate text-sm text-muted-foreground">
                  {trip.booking
                    ? `${trip.booking.pickup.address} → ${trip.booking.drop.address}`
                    : "Your recent journey"}
                </p>
                {trip.driver?.name ? (
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    with {trip.driver.name}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="Not now"
                className="-mr-1 -mt-1 ml-auto shrink-0 rounded-full p-1.5 text-muted-foreground transition-colors hover:text-foreground"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>

            <div
              className="mt-4 flex justify-center gap-1"
              onMouseLeave={() => setHover(0)}
            >
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setScore(value)}
                  onMouseEnter={() => setHover(value)}
                  aria-label={`${value} star${value === 1 ? "" : "s"}`}
                  aria-pressed={score === value}
                  className="p-1 transition-transform hover:scale-110"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className={`h-8 w-8 transition-colors ${
                      value <= shown ? "text-brand" : "text-muted-foreground/30"
                    }`}
                    fill={value <= shown ? "currentColor" : "none"}
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  >
                    <path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1.1 5.9-5.3-2.9-5.3 2.9 1.1-5.9L3.5 9.7l5.9-.8z" />
                  </svg>
                </button>
              ))}
            </div>

            {score > 0 ? (
              <textarea
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                rows={2}
                placeholder="Anything you want to add? (optional)"
                className="mt-3 w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            ) : null}

            {error ? (
              <p className="mt-3 text-sm text-destructive">{error}</p>
            ) : null}

            <div className="mt-4 flex gap-2">
              <Button variant="outline" className="flex-1" onClick={close}>
                Not now
              </Button>
              <Button className="flex-1" disabled={score === 0 || saving} onClick={submit}>
                {saving ? "Sending…" : "Submit"}
              </Button>
            </div>

            <Link
              href={`/trips/${trip._id}`}
              className="mt-3 block text-center text-xs text-muted-foreground hover:text-foreground"
            >
              See the trip
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

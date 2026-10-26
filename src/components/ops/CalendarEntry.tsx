"use client";

import { useEffect, useState, type ReactNode } from "react";
import { formatDateTime } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/Dashboard";
import { errorText } from "@/lib/api/client";
import { getCalendarStatus, syncBookingToCalendar } from "@/lib/api/admin";
import type { Booking } from "@/lib/api/types";

/**
 * Whether this booking is on the shared operations calendar, with a link to the event and a
 * button to bring it up to date.
 *
 * Bookings reach the calendar by themselves within moments of any change; the button is for
 * the day something was wrong (the calendar was not yet shared with the service account, say)
 * and an operator wants to see it fixed. When Google refuses, its reason is shown in words
 * that name the fix, rather than a bare error.
 */
export function CalendarEntry({ booking, onChanged, renderSection }: {
  booking: Booking;
  onChanged: () => void;
  /** Render the surrounding card only when calendar content is available. */
  renderSection?: (content: ReactNode) => ReactNode;
}) {
  const [state, setState] = useState<{ enabled: boolean; ok?: boolean; name?: string; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getCalendarStatus()
      .then((s) => live && setState(s))
      .catch(() => live && setState(null));
    return () => {
      live = false;
    };
  }, []);

  // Not set up, or the status could not be read: say nothing rather than add a section of noise.
  if (!state?.enabled) return null;

  const entry = booking.calendar;
  const onCalendar = Boolean(entry && !entry.removed && entry.hash !== "pending");

  async function sync() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await syncBookingToCalendar(booking._id);
      setNotice(
        result.action === "created"
          ? "Added to the calendar."
          : result.action === "updated"
            ? "Calendar updated."
            : result.action === "removed"
              ? "Removed from the calendar."
              : result.action === "unchanged"
                ? "Already up to date."
                : (result.reason ?? "Nothing to do."),
      );
      onChanged();
    } catch (err) {
      setError(errorText(err, "Could not update the calendar"));
    } finally {
      setBusy(false);
    }
  }

  const content = (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {booking.status === "cancelled" ? (
          <StatusBadge tone="neutral">{entry?.removed ? "Removed from the calendar" : "Not on the calendar"}</StatusBadge>
        ) : onCalendar ? (
          <StatusBadge tone="good">On the calendar</StatusBadge>
        ) : (
          <StatusBadge tone="warn">Not on the calendar yet</StatusBadge>
        )}
        {onCalendar && entry ? (
          <p className="text-note text-fg-muted">Updated {formatDateTime(entry.syncedAt)}</p>
        ) : null}
        {onCalendar && entry?.link ? (
          <a href={entry.link} target="_blank" rel="noopener noreferrer" className="text-note font-bold text-accent hover:underline">
            Open in Google Calendar
          </a>
        ) : null}
      </div>

      {state.ok === false && state.error ? (
        <p className="rounded-field border border-danger/30 bg-danger/5 px-3.5 py-2.5 text-note font-bold text-danger">
          The calendar cannot be reached: {state.error}
        </p>
      ) : null}
      {notice ? <p className="text-note font-bold text-fg">{notice}</p> : null}
      {error ? <p className="text-note font-bold text-danger">{error}</p> : null}

      <button
        type="button"
        disabled={busy}
        onClick={() => void sync()}
        className="rounded-field border border-border px-3.5 py-2 text-note font-bold text-fg hover:border-accent disabled:opacity-60"
      >
        {busy ? "Updating…" : onCalendar ? "Update the calendar now" : "Add to the calendar now"}
      </button>
    </div>
  );

  return renderSection ? renderSection(content) : content;
}

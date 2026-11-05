"use client";

import { useEffect, useId, useRef, useState } from "react";
import { errorText } from "@/lib/api/client";
import { rejectBookingRequest } from "@/lib/api/admin";
import { StatusBadge } from "@/components/ui/Dashboard";
import { canReject } from "@/lib/trips/reject";
import type { Booking } from "@/lib/api/types";

/**
 * Turning down a booking request that no chauffeur has taken.
 *
 * Shown only while that is still possible (still pending); once someone
 * accepts, the trip has its own cancellation. The reason is required because the customer
 * is emailed it word for word. A card payment is refunded in full automatically.
 */
export function RejectRequest({
  booking,
  clientName,
  onChanged,
  compact = false,
}: {
  booking: Booking;
  clientName?: string;
  onChanged: () => void;
  /** Just the button, for the page header; the full explanation stays in the Request section. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const rejected = booking.status === "cancelled" && booking.cancellation?.rejected;
  if (rejected && compact) {
    return done ? <p className="text-note font-bold text-danger">{done}</p> : null;
  }
  if (rejected) {
    return (
      <div className="space-y-2">
        <StatusBadge tone="bad">Rejected</StatusBadge>
        {booking.cancellation?.reason ? (
          <p className="text-note text-fg-body">
            Reason given to the customer: <span className="font-bold">{booking.cancellation.reason}</span>
          </p>
        ) : null}
        {done ? <p className="text-note font-bold text-danger">{done}</p> : null}
      </div>
    );
  }

  if (!canReject(booking)) return null;

  return (
    <div className={compact ? undefined : "space-y-3"}>
      {compact ? null : <p className="text-note leading-relaxed text-fg-muted">
        No driver has taken this ride yet. If it cannot be done, reject it: the customer is
        emailed your reason{booking.payment ? " and refunded in full" : ""}.
      </p>}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`rounded-field border border-danger/40 px-3.5 py-2 text-note font-bold text-danger hover:bg-danger/5 ${compact ? "" : "mt-3"}`}
      >
        Reject this request…
      </button>
      {open ? (
        <RejectDialog
          booking={booking}
          clientName={clientName}
          onClose={() => setOpen(false)}
          onDone={(message) => {
            setDone(message ?? null);
            onChanged();
          }}
        />
      ) : null}
    </div>
  );
}

function RejectDialog({
  booking,
  clientName,
  onClose,
  onDone,
}: {
  booking: Booking;
  clientName?: string;
  onClose: () => void;
  onDone: (warning?: string) => void;
}) {
  const titleId = useId();
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  const trimmed = reason.trim();
  const ready = trimmed.length >= 3;

  useEffect(() => {
    field.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, pending]);

  async function reject() {
    if (!ready) return;
    setPending(true);
    setError(null);
    try {
      const result = await rejectBookingRequest(booking._id, trimmed);
      onDone(result.refundError);
      onClose();
    } catch (err) {
      setError(errorText(err, "Could not reject this request"));
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
        className="relative w-full max-w-md rounded-card border border-border bg-surface-raised p-5 shadow-[var(--shadow-raised)]"
      >
        <h2 id={titleId} className="text-action font-bold text-fg">
          Reject this request
        </h2>
        <p className="mt-2 text-meta leading-relaxed text-fg-body">
          {clientName ?? "The customer"} will be emailed a rejection notice with the reason below
          {booking.payment ? ", and their card payment is refunded in full" : ""}. This cannot be undone.
        </p>

        <label htmlFor="reject-reason" className="mt-4 block text-label font-bold text-fg-muted">
          Reason (the customer reads this)
        </label>
        <textarea
          id="reject-reason"
          ref={field}
          value={reason}
          maxLength={300}
          rows={3}
          onChange={(event) => setReason(event.target.value)}
          placeholder="For example: we have no driver available at that time"
          className="mt-1 w-full rounded-field border border-border bg-surface-raised px-3 py-2 text-body text-fg outline-none focus:border-accent"
        />
        <p className="mt-1 text-note text-fg-muted">{trimmed.length}/300</p>

        {error ? (
          <p role="alert" className="mt-3 rounded-field border border-danger/30 bg-danger/5 px-3.5 py-2.5 text-note font-bold text-danger">
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="h-10 rounded-field border border-border px-4 text-meta font-bold text-fg hover:border-accent disabled:opacity-50"
          >
            Keep it
          </button>
          <button
            type="button"
            disabled={!ready || pending}
            aria-busy={pending}
            onClick={() => void reject()}
            className="h-10 rounded-field bg-danger px-4 text-meta font-bold text-white disabled:opacity-40"
          >
            {pending ? "Rejecting…" : "Reject request"}
          </button>
        </div>
      </div>
    </div>
  );
}

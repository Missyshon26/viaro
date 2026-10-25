"use client";

import { useEffect, useRef, useState } from "react";
import { assignDriverToBooking, listDrivers, type RosterDriver } from "@/lib/api/admin";
import { errorText } from "@/lib/api/client";
import { Avatar, StatusBadge } from "@/components/ui/Dashboard";
import { IconCheck, IconClose, IconStar } from "@/components/ui/Icons";

/**
 * UML «Assign Driver to Booking» — the admin's manual override on a pooled booking.
 *
 * Dispatch runs itself: a booking is broadcast to nearby chauffeurs the moment it is
 * created, and normally a chauffeur claims it. This is for when operations needs a
 * particular person on a particular job.
 *
 * Only `available` chauffeurs are offered. The API enforces that too — this list is a
 * convenience, not the guard — and a 409 comes back if someone goes busy between the
 * list loading and the click.
 */
export function AssignDriver({
  bookingId,
  reference,
  onAssigned,
}: {
  bookingId: string;
  reference: string;
  onAssigned: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-8 items-center rounded-field border border-border bg-surface-raised px-3 text-label font-bold text-fg-body transition-colors hover:border-accent hover:text-fg"
      >
        Assign
      </button>
      {open ? (
        <AssignDialog
          bookingId={bookingId}
          reference={reference}
          onClose={() => setOpen(false)}
          onAssigned={() => {
            setOpen(false);
            onAssigned();
          }}
        />
      ) : null}
    </>
  );
}

function AssignDialog({
  bookingId,
  reference,
  onClose,
  onAssigned,
}: {
  bookingId: string;
  reference: string;
  onClose: () => void;
  onAssigned: () => void;
}) {
  const [drivers, setDrivers] = useState<RosterDriver[] | null>(null);
  const [chosen, setChosen] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    listDrivers(1, 100)
      .then((result) => {
        if (cancelled) return;
        const items = Array.isArray(result) ? result : (result.items ?? []);
        setDrivers(items.filter((d) => d.status === "available"));
      })
      .catch(() => {
        if (!cancelled) {
          setDrivers([]);
          setError("Could not load the chauffeur list.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit() {
    if (!chosen || saving) return;
    setSaving(true);
    setError(null);
    try {
      await assignDriverToBooking(bookingId, chosen);
      onAssigned();
    } catch (err) {
      setError(
        errorText(err, "The assignment did not go through."),
      );
    } finally {
      setSaving(false);
    }
  }

  const nameOf = (driver: RosterDriver) =>
    driver.userId && typeof driver.userId === "object" ? driver.userId.name : "Chauffeur";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Assign a chauffeur to ${reference}`}
      className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-panel/50 backdrop-blur-[2px]"
      />

      <div className="relative flex max-h-[85dvh] w-full max-w-md flex-col overflow-hidden rounded-card border border-border bg-surface-raised shadow-[var(--shadow-raised)]">
        <div className="flex items-start gap-3 border-b border-border-subtle px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-action font-bold text-fg">Assign a chauffeur</h2>
            <p className="mt-1 text-note text-fg-muted">
              {reference} · only chauffeurs who are online right now
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-auto inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-fg-muted hover:bg-surface hover:text-fg"
          >
            <IconClose size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {error ? (
            <p className="mb-3 rounded-field border border-danger/30 bg-danger/5 px-3.5 py-2.5 text-note font-bold text-danger">
              {error}
            </p>
          ) : null}

          {drivers === null ? (
            <p className="py-6 text-note text-fg-muted">Loading chauffeurs…</p>
          ) : drivers.length === 0 ? (
            <p className="py-6 text-note leading-relaxed text-fg-muted">
              Nobody is online. A chauffeur has to be <strong>available</strong> to take
              an assignment — the API rejects anyone busy or offline, so that a driver
              mid-trip is never pulled onto a second job.
            </p>
          ) : (
            <ul className="space-y-2">
              {drivers.map((driver) => (
                <li key={driver._id}>
                  <button
                    type="button"
                    onClick={() => setChosen(driver._id)}
                    aria-pressed={chosen === driver._id}
                    className={`flex w-full items-center gap-3 rounded-field border p-3 text-left transition-colors ${
                      chosen === driver._id
                        ? "border-accent bg-accent-soft"
                        : "border-border hover:border-accent/50"
                    }`}
                  >
                    <Avatar name={nameOf(driver)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-meta font-bold text-fg">
                        {nameOf(driver)}
                      </span>
                      <span className="block truncate text-label capitalize text-fg-muted">
                        {driver.vehicleClass}
                        {driver.penaltyCount > 0
                          ? ` · ${driver.penaltyCount} penalties`
                          : ""}
                      </span>
                    </span>
                    {driver.ratingCount > 0 ? (
                      <span className="flex shrink-0 items-center gap-1 text-label font-bold text-fg">
                        <IconStar size={12} className="text-chart-warn" />
                        {driver.rating.toFixed(1)}
                      </span>
                    ) : (
                      <StatusBadge status={driver.status} />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex gap-2.5 border-t border-border-subtle px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="h-10 flex-1 rounded-field border border-border bg-surface-raised text-meta font-bold text-fg-body transition-colors hover:text-fg"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!chosen || saving}
            className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-field bg-primary text-meta font-bold text-primary-fg transition-opacity disabled:opacity-40"
          >
            <IconCheck size={15} />
            {saving ? "Assigning…" : "Assign"}
          </button>
        </div>
      </div>
    </div>
  );
}

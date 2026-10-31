"use client";

import { useEffect, useState } from "react";
import { errorText } from "@/lib/api/client";
import { setTripStatus, type AdminTripStatus } from "@/lib/api/admin";
import { IconCheck, IconClose } from "@/components/ui/Icons";

/**
 * Moving a trip by hand.
 *
 * The lifecycle belongs to the chauffeur; this is for when the record and reality
 * disagree — someone finished the job and never pressed Complete, or a journey has to be
 * called off from the office.
 *
 * It is deliberately not a dropdown that saves on change. Completing a trip settles the
 * fare and pays the driver, and cancelling ends the journey; both are one-way, so each
 * asks for confirmation and cancelling asks why. A select that fires on blur would make
 * an irreversible money operation a mis-click away.
 */
const ACTIONS: Record<
  AdminTripStatus,
  { label: string; blurb: string; danger?: boolean; from: string[] }
> = {
  confirmed: {
    label: "Confirm this trip",
    blurb: "Tells the passenger the trip is confirmed, with the driver, vehicle and pickup details. The passenger is emailed.",
    from: ["accepted"],
  },
  enroute: {
    label: "Mark as on the way",
    blurb: "Records that the driver is heading to the pickup. The passenger is emailed.",
    from: ["accepted"],
  },
  arrived: {
    label: "Mark as arrived",
    blurb: "Records that the driver is at the pickup. The passenger is emailed.",
    from: ["accepted"],
  },
  started: {
    label: "Mark as started",
    blurb: "Records the trip as under way. The passenger is told it has started.",
    from: ["accepted"],
  },
  completed: {
    label: "Mark as completed",
    blurb:
      "Settles the fare — the 60/40 revenue split runs and the driver is paid — and frees them for the next job. This cannot be undone.",
    from: ["accepted", "started"],
  },
  cancelled: {
    label: "Cancel this trip",
    blurb:
      "Ends the trip and frees the driver. The driver is NOT penalised: that penalty is for abandoning an accepted ride, not for an office cancellation.",
    danger: true,
    from: ["accepted", "started"],
  },
};

export function TripStatusControl({
  tripId,
  currentStatus,
  onChanged,
  compact,
  autoOpen,
  onClose,
  reached,
}: {
  /** Which pickup steps are already recorded, so a step that is done is not offered again. */
  reached?: { confirmed?: boolean; enroute?: boolean; arrived?: boolean };
  tripId: string;
  currentStatus: string;
  onChanged: () => void | Promise<void>;
  /** List rows get buttons only; the detail page gets the explanatory panel. */
  compact?: boolean;
  /**
   * Render as a dialog straight away, with no trigger of its own.
   *
   * Used when something else is the trigger — the stage badge in the trips table — so
   * the control does not need to duplicate a button that already exists on the row.
   */
  autoOpen?: boolean;
  onClose?: () => void;
}) {
  const [pending, setPending] = useState<AdminTripStatus | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dismiss = () => {
    setPending(null);
    onClose?.();
  };

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setPending(null);
        onClose?.();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const available = (Object.keys(ACTIONS) as AdminTripStatus[]).filter((key) => {
    if (!ACTIONS[key].from.includes(currentStatus)) return false;
    // The two pickup steps are for the trip page; a table row keeps to start, complete, cancel.
    if (compact && !autoOpen && (key === "confirmed" || key === "enroute" || key === "arrived")) return false;
    if (key === "confirmed" && reached?.confirmed) return false;
    if (key === "enroute" && (reached?.enroute || reached?.arrived)) return false;
    if (key === "arrived" && reached?.arrived) return false;
    return true;
  });

  // A completed or cancelled trip is terminal — the API refuses either way, so offering
  // the buttons would only produce a 409.
  if (available.length === 0) {
    if (autoOpen) {
      onClose?.();
      return null;
    }
    return compact ? null : (
      <p className="text-note leading-relaxed text-fg-muted">
        This trip is {currentStatus}. Terminal states cannot be changed — the API refuses
        it, so the money and the driver&rsquo;s availability stay consistent.
      </p>
    );
  }

  async function apply(status: AdminTripStatus) {
    setSaving(true);
    setError(null);
    try {
      await setTripStatus(tripId, status, reason.trim() || undefined);
      setPending(null);
      setReason("");
      await onChanged();
    } catch (err) {
      setError(errorText(err, "That did not go through."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {autoOpen ? null : (
      <div className={compact ? "flex flex-wrap justify-end gap-2" : "flex flex-wrap gap-2"}>
        {available.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              setPending(key);
              setError(null);
            }}
            className={`min-h-10 whitespace-nowrap rounded-field border px-3 text-label font-bold transition-colors ${
              ACTIONS[key].danger
                ? "border-danger/40 bg-surface-raised text-danger hover:bg-danger/5"
                : "border-border bg-surface-raised text-fg-body hover:border-accent hover:text-fg"
            }`}
          >
            {compact ? { cancelled: "Cancel", started: "Start", completed: "Complete", confirmed: "Confirm", enroute: "On the way", arrived: "Arrived" }[key] : ACTIONS[key].label}
          </button>
        ))}
      </div>
      )}

      {/* Opened from elsewhere and no action chosen yet: pick one. */}
      {autoOpen && !pending ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Move this trip"
          className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
        >
          <button
            type="button"
            aria-label="Close"
            onClick={dismiss}
            className="absolute inset-0 cursor-default bg-panel/50 backdrop-blur-[2px]"
          />
          <div className="relative w-full max-w-sm overflow-hidden rounded-card border border-border bg-surface-raised shadow-[var(--shadow-raised)]">
            <div className="flex items-center gap-3 border-b border-border-subtle px-5 py-4">
              <h2 className="text-action font-bold text-fg">Move this trip</h2>
              <button
                type="button"
                onClick={dismiss}
                aria-label="Close"
                className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-full text-fg-muted hover:bg-surface hover:text-fg"
              >
                <IconClose size={16} />
              </button>
            </div>
            <div className="space-y-2 p-4">
              <p className="pb-1 text-note text-fg-muted">
                Currently <span className="font-bold capitalize text-fg">{currentStatus}</span>.
              </p>
              {available.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setPending(key)}
                  className={`block w-full rounded-field border px-3.5 py-3 text-left transition-colors ${
                    ACTIONS[key].danger
                      ? "border-danger/40 hover:bg-danger/5"
                      : "border-border hover:border-accent"
                  }`}
                >
                  <span
                    className={`block text-meta font-bold ${
                      ACTIONS[key].danger ? "text-danger" : "text-fg"
                    }`}
                  >
                    {ACTIONS[key].label}
                  </span>
                  <span className="mt-1 block text-note leading-relaxed text-fg-muted">
                    {ACTIONS[key].blurb}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {pending ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={ACTIONS[pending].label}
          className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
        >
          <button
            type="button"
            aria-label="Close"
            onClick={() => (autoOpen ? dismiss() : setPending(null))}
            className="absolute inset-0 cursor-default bg-panel/50 backdrop-blur-[2px]"
          />

          <div className="relative w-full max-w-md overflow-hidden rounded-card border border-border bg-surface-raised shadow-[var(--shadow-raised)]">
            <div className="flex items-center gap-3 border-b border-border-subtle px-5 py-4">
              <h2 className="text-action font-bold text-fg">{ACTIONS[pending].label}</h2>
              <button
                type="button"
                onClick={() => (autoOpen ? dismiss() : setPending(null))}
                aria-label="Close"
                className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-full text-fg-muted hover:bg-surface hover:text-fg"
              >
                <IconClose size={16} />
              </button>
            </div>

            <div className="space-y-4 px-5 py-4">
              <p
                className={`rounded-field border px-3.5 py-3 text-note leading-relaxed ${
                  ACTIONS[pending].danger
                    ? "border-danger/30 bg-danger/5 text-danger"
                    : "border-border bg-surface text-fg-body"
                }`}
              >
                {ACTIONS[pending].blurb}
              </p>

              {pending === "cancelled" ? (
                <div>
                  <label
                    htmlFor="cancel-reason"
                    className="block text-note font-medium uppercase tracking-wider text-fg-muted"
                  >
                    Reason
                  </label>
                  <input
                    id="cancel-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Why is operations cancelling this?"
                    className="mt-1.5 h-10 w-full rounded-field border border-border bg-surface px-3 text-meta text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none"
                  />
                  <p className="mt-1.5 text-note text-fg-faint">
                    Stored on the trip and shown to the passenger.
                  </p>
                </div>
              ) : null}

              {error ? (
                <p className="rounded-field border border-danger/30 bg-danger/5 px-3.5 py-2.5 text-note font-bold text-danger">
                  {error}
                </p>
              ) : null}
            </div>

            <div className="flex gap-2.5 border-t border-border-subtle px-5 py-4">
              <button
                type="button"
                onClick={() => (autoOpen ? dismiss() : setPending(null))}
                className="h-10 flex-1 rounded-field border border-border bg-surface-raised text-meta font-bold text-fg-body hover:text-fg"
              >
                Keep as is
              </button>
              <button
                type="button"
                onClick={() => apply(pending)}
                disabled={saving}
                className={`inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-field text-meta font-bold transition-opacity disabled:opacity-40 ${
                  ACTIONS[pending].danger
                    ? "bg-danger text-white"
                    : "bg-primary text-primary-fg"
                }`}
              >
                <IconCheck size={15} />
                {saving ? "Working…" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

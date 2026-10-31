"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { errorText } from "@/lib/api/client";
import { markNoShow, revertNoShow } from "@/lib/api/admin";

/**
 * The passenger never appeared. For a trip the chauffeur has accepted but not started.
 *
 * It is a closing action, so it asks first and says what it does: the trip ends but is still
 * charged, the chauffeur is paid and freed, and the passenger is emailed (with a copy to
 * operations). It is not a cancellation — nothing is refunded.
 */
export function NoShowButton({
  tripId,
  tripStatus,
  noShow,
  clientName,
  onChanged,
}: {
  tripId: string;
  tripStatus: string;
  noShow?: boolean;
  clientName?: string;
  onChanged: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!noShow && tripStatus !== "accepted") return null;

  async function confirm() {
    setPending(true);
    setError(null);
    try {
      if (noShow) await revertNoShow(tripId);
      else await markNoShow(tripId);
      setOpen(false);
      await onChanged();
    } catch (err) {
      setError(errorText(err, noShow ? "Could not undo the no-show" : "Could not mark this trip as a no-show"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      {noShow ? (
        <p className="text-note font-bold text-danger">Marked as a no-show. The passenger was emailed.</p>
      ) : null}
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className={`min-h-10 whitespace-nowrap rounded-field border bg-surface-raised px-3 text-label font-bold ${
          noShow
            ? "border-border text-fg-body hover:border-accent hover:text-fg"
            : "border-danger/40 text-danger hover:bg-danger/5"
        }`}
      >
        {noShow ? "Undo no-show" : "Mark as no-show"}
      </button>
      <ConfirmDialog
        open={open}
        title={noShow ? "Undo this no-show?" : "Mark this trip as a no-show?"}
        confirmLabel={noShow ? "Undo no-show" : "Mark no-show"}
        pendingLabel="Saving…"
        danger={!noShow}
        pending={pending}
        error={error}
        onConfirm={() => void confirm()}
        onCancel={() => setOpen(false)}
      >
        {noShow ? (
          <>
            <p>
              The trip goes back to accepted and the driver is on it again. The payment made to the driver
              and the business&rsquo;s shares are taken back. A driver who has already withdrawn that money is
              left with a negative balance.
            </p>
            <p>
              {clientName ?? "The passenger"} sees in the app that the reservation is active again; no email is
              sent. The no-show email they already received is not recalled.
            </p>
          </>
        ) : (
          <>
            <p>
              The trip closes and is still charged: the driver is paid and freed, and nothing is refunded.{" "}
              {clientName ?? "The passenger"} is emailed that the reservation was marked a no-show, and operations
              get a copy.
            </p>
            <p>Only do this if the driver waited at the pickup and could not reach the passenger. It can be undone.</p>
          </>
        )}
      </ConfirmDialog>
    </div>
  );
}

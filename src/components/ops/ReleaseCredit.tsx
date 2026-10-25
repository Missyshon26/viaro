"use client";

import { useState, useTransition } from "react";
import { errorText } from "@/lib/api/client";
import { releaseTripCredit } from "@/lib/api/admin";
import { money } from "@/components/ui/DataTable";

/**
 * Returns applied wallet credit to the passenger's balance.
 *
 * Confirms first. This moves real money — the credit goes back to the passenger and the
 * outstanding fare rises by the same amount — and it sits inches from read-only fields,
 * so a mis-click here should not be able to change anyone's balance.
 *
 * The API refuses once the fare has been charged. That message is surfaced verbatim
 * rather than softened, because "already billed at the discounted figure" tells an
 * operator exactly what happened and what to do instead.
 */
export function ReleaseCredit({
  tripId,
  applied,
  onReleased,
}: {
  tripId: string;
  applied: number;
  onReleased: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="mt-1.5 text-label font-bold uppercase tracking-wider text-fg-muted underline underline-offset-4 transition-colors hover:text-fg"
      >
        Remove credit
      </button>
    );
  }

  return (
    <div className="mt-2 space-y-2">
      {error ? <p className="text-note font-bold text-danger">{error}</p> : null}

      <p className="text-note text-fg-muted">
        Return {money(applied)} to the passenger&apos;s wallet? The outstanding fare goes
        back up by the same amount.
      </p>

      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => setConfirming(false)}
          className="rounded-md border border-line px-3 py-1.5 text-note font-bold text-fg transition-colors hover:bg-surface-2 disabled:opacity-60"
        >
          Keep it
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              try {
                await releaseTripCredit(tripId);
                setConfirming(false);
                onReleased();
              } catch (err) {
                setError(
                  errorText(err, "Could not release the credit"),
                );
              }
            })
          }
          className="rounded-md bg-danger px-3 py-1.5 text-note font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Removing…" : "Remove"}
        </button>
      </div>
    </div>
  );
}

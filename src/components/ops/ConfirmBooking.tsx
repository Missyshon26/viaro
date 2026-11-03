"use client";

import { useState } from "react";
import { errorText } from "@/lib/api/client";
import { confirmBookingRequest } from "@/lib/api/admin";

/**
 * The first step on a new request: confirm it, and the customer is told "your trip is
 * confirmed". Assigning a driver comes after, so until this is pressed the trip offers
 * Confirm instead of Assign.
 *
 * One press, no dialog: it is not money and not irreversible-by-surprise, and the API keeps
 * a double press from telling the customer twice. A failure is shown beside the button.
 */
export function ConfirmBooking({
  bookingId,
  onConfirmed,
}: {
  bookingId: string;
  onConfirmed: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setSaving(true);
    setError(null);
    try {
      await confirmBookingRequest(bookingId);
      onConfirmed();
    } catch (err) {
      setError(errorText(err, "Could not confirm this trip"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={saving}
        onClick={() => void confirm()}
        className="inline-flex h-8 items-center rounded-field bg-primary px-3 text-label font-bold text-primary-fg transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {saving ? "Confirming…" : "Confirm"}
      </button>
      {error ? (
        <span role="alert" className="text-note text-danger">
          {error}
        </span>
      ) : null}
    </span>
  );
}

"use client";

import { useEffect, useId, useRef, useState } from "react";
import { money } from "@/components/ui/DataTable";
import { errorText } from "@/lib/api/client";
import { refundBooking } from "@/lib/api/admin";
import { newRequestId, parseRefundAmount } from "@/lib/refund";

/**
 * Refund all or part of a card payment, back to the client's card.
 *
 * Two steps on purpose — choose the amount, then read it back and confirm — because a refund
 * cannot be taken back. Refunding does not cancel the trip; that is a separate action.
 *
 * The request id is made once when the dialog opens, so pressing the button twice, or a retry
 * after a dropped connection, refunds once. A second, deliberate refund means opening the
 * dialog again.
 */
export function RefundDialog({
  bookingId,
  remaining,
  paid,
  cardLabel,
  onClose,
  onDone,
}: {
  bookingId: string;
  /** Dollars still refundable. */
  remaining: number;
  /** Dollars originally paid. */
  paid: number;
  /** "visa ending 4242", or "card". */
  cardLabel: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const titleId = useId();
  const [requestId] = useState(newRequestId);
  const [mode, setMode] = useState<"full" | "part">("full");
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [step, setStep] = useState<"choose" | "confirm">("choose");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstFocus = useRef<HTMLInputElement>(null);

  const typed = parseRefundAmount(text, remaining);
  const amount = mode === "full" ? remaining : typed.amount;
  const ready = amount !== null && amount > 0;

  useEffect(() => {
    firstFocus.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, pending]);

  async function refund() {
    if (!ready || amount === null) return;
    setPending(true);
    setError(null);
    try {
      await refundBooking(bookingId, { amount, requestId, ...(note.trim() ? { note: note.trim() } : {}) });
      onDone();
      onClose();
    } catch (err) {
      setError(errorText(err, "Could not refund this payment"));
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
          {step === "choose" ? "Refund this payment" : "Confirm the refund"}
        </h2>

        {step === "choose" ? (
          <div className="mt-3 space-y-4">
            <p className="text-meta text-fg-body">
              {money(paid)} was paid by {cardLabel}. {money(remaining)} can still be refunded to that card.
            </p>

            <fieldset className="space-y-2">
              <legend className="sr-only">How much to refund</legend>
              <label className="flex cursor-pointer items-center gap-2.5 rounded-field border border-border px-3.5 py-3">
                <input
                  ref={firstFocus}
                  type="radio"
                  name="refund-mode"
                  checked={mode === "full"}
                  onChange={() => setMode("full")}
                  className="h-4 w-4 accent-[var(--accent)]"
                />
                <span className="text-meta font-bold text-fg">Everything left ({money(remaining)})</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2.5 rounded-field border border-border px-3.5 py-3">
                <input
                  type="radio"
                  name="refund-mode"
                  checked={mode === "part"}
                  onChange={() => setMode("part")}
                  className="h-4 w-4 accent-[var(--accent)]"
                />
                <span className="text-meta font-bold text-fg">Part of it</span>
              </label>
            </fieldset>

            {mode === "part" ? (
              <div>
                <label htmlFor="refund-amount" className="block text-label font-bold text-fg-muted">
                  Amount to refund ($)
                </label>
                <input
                  id="refund-amount"
                  inputMode="decimal"
                  autoComplete="off"
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  placeholder={`Up to ${remaining.toFixed(2)}`}
                  aria-invalid={Boolean(typed.error)}
                  className="mt-1 h-11 w-full rounded-field border border-border bg-surface-raised px-3 text-body text-fg outline-none focus:border-accent"
                />
                {typed.error ? <p className="mt-1.5 text-note font-bold text-danger">{typed.error}</p> : null}
              </div>
            ) : null}

            <div>
              <label htmlFor="refund-note" className="block text-label font-bold text-fg-muted">
                Reason (optional, kept with the refund in Stripe)
              </label>
              <input
                id="refund-note"
                value={note}
                maxLength={200}
                onChange={(event) => setNote(event.target.value)}
                className="mt-1 h-11 w-full rounded-field border border-border bg-surface-raised px-3 text-body text-fg outline-none focus:border-accent"
              />
            </div>
          </div>
        ) : (
          <div className="mt-3 space-y-2 text-meta leading-relaxed text-fg-body">
            <p>
              <span className="font-bold text-fg">{money(amount ?? 0)}</span> will go back to the {cardLabel}.
              The client is told by notification. It usually shows on their statement in 5–10 business days.
            </p>
            <p>This cannot be undone. The trip itself stays booked — cancel it separately if needed.</p>
          </div>
        )}

        {error ? (
          <p role="alert" className="mt-3 rounded-field border border-danger/30 bg-danger/5 px-3.5 py-2.5 text-note font-bold text-danger">
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => (step === "confirm" && !pending ? (setStep("choose"), setError(null)) : onClose())}
            disabled={pending}
            className="h-10 rounded-field border border-border px-4 text-meta font-bold text-fg hover:border-accent disabled:opacity-50"
          >
            {step === "confirm" ? "Back" : "Cancel"}
          </button>
          {step === "choose" ? (
            <button
              type="button"
              disabled={!ready}
              onClick={() => setStep("confirm")}
              className="h-10 rounded-field bg-primary px-4 text-meta font-bold text-primary-fg disabled:opacity-40"
            >
              Review refund
            </button>
          ) : (
            <button
              type="button"
              disabled={pending}
              aria-busy={pending}
              onClick={() => void refund()}
              className="h-10 rounded-field bg-danger px-4 text-meta font-bold text-white disabled:opacity-60"
            >
              {pending ? "Refunding…" : `Refund ${money(amount ?? 0)}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

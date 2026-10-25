"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

/**
 * "Are you sure?" for the console actions that spend money, change a rule that applies to
 * everyone, or lock someone out.
 *
 * A real dialog, not a `window.confirm`: it names what is about to happen in the page's own
 * words, keeps keyboard focus inside while open (Tab cycles, Escape cancels), starts on
 * Cancel so Enter alone cannot confirm, and hands focus back to whatever opened it.
 *
 * It stays open while the action runs and shows a failure inside itself, so an operator who
 * pressed Confirm and got an error is looking at the error — not at a dialog that vanished
 * and a page that looks unchanged.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  pendingLabel = "Working…",
  danger = false,
  pending = false,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  pendingLabel?: string;
  /** Styles the confirm button as a warning (locking someone out, switching something off). */
  danger?: boolean;
  pending?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const bodyId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) {
        event.stopPropagation();
        onCancel();
        return;
      }
      if (event.key !== "Tab") return;
      // Keep focus on the two buttons: nothing behind the dialog should be reachable.
      const first = cancelRef.current;
      const last = confirmRef.current;
      if (!first || !last) return;
      const active = document.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (active !== first && active !== last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      opener.current?.focus?.();
    };
  }, [open, pending, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center p-4 sm:items-center">
      <button
        type="button"
        aria-label="Cancel"
        tabIndex={-1}
        disabled={pending}
        onClick={onCancel}
        className="absolute inset-0 cursor-default bg-panel/60 backdrop-blur-[2px]"
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className="relative w-full max-w-md rounded-card border border-border bg-surface-raised p-5 shadow-[var(--shadow-raised)]"
      >
        <h2 id={titleId} className="text-action font-bold text-fg">
          {title}
        </h2>
        <div id={bodyId} className="mt-2 space-y-2 text-meta leading-relaxed text-fg-body">
          {children}
        </div>

        {error ? (
          <p role="alert" className="mt-3 rounded-field border border-danger/30 bg-danger/5 px-3.5 py-2.5 text-note font-bold text-danger">
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="h-10 rounded-field border border-border px-4 text-meta font-bold text-fg hover:border-accent disabled:opacity-50"
          >
            Keep as it is
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={pending}
            aria-busy={pending}
            className={`h-10 rounded-field px-4 text-meta font-bold text-primary-fg hover:brightness-110 disabled:opacity-60 ${
              danger ? "bg-danger" : "bg-primary"
            }`}
          >
            {pending ? pendingLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

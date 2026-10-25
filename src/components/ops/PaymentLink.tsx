"use client";

import { useState } from "react";
import { formatDateTime, money } from "@/components/ui/DataTable";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { StatusBadge } from "@/components/ui/Dashboard";
import { RefundDialog } from "@/components/ops/RefundDialog";
import { refundable } from "@/lib/refund";
import { fareLines } from "@/lib/fareLines";
import { errorText } from "@/lib/api/client";
import { sendPaymentLink } from "@/lib/api/admin";
import type { Booking } from "@/lib/api/types";

/**
 * Whether a booking is paid, and — when it is not — the way to ask for the money: email the
 * client a secure payment page. The booking marks itself paid when the payment arrives (the
 * page refreshes on its own), so there is nothing to tick by hand.
 *
 * Sending again replaces the old link: the server ends it first, so a client cannot end up
 * paying twice.
 */
function FareLines({ booking }: { booking: Booking }) {
  const lines = fareLines(booking.fareBreakdown, booking.estimatedFare);
  if (lines.length === 0) return null;
  return (
    <dl className="mb-4 space-y-1 border-b border-border-subtle pb-4 text-note">
      {lines.map((line) => (
        <div key={line.label} className={`flex gap-4 ${line.total ? "pt-1 text-meta font-bold text-fg" : "text-fg-body"}`}>
          <dt>{line.label}</dt>
          <dd className="ml-auto">{line.amount < 0 ? `-${money(-line.amount)}` : money(line.amount)}</dd>
        </div>
      ))}
    </dl>
  );
}

function PaymentLinkBody({
  booking,
  clientName,
  clientEmail,
  onChanged,
}: {
  booking: Booking;
  clientName?: string;
  clientEmail?: string;
  onChanged: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [refunding, setRefunding] = useState(false);
  const [refunded, setRefunded] = useState<string | null>(null);
  // When the page was opened: a link is shown as live or expired relative to this.
  const [openedAt] = useState(() => Date.now());

  const { payment, paymentLink } = booking;
  const fare = booking.estimatedFare ?? 0;

  if (payment) {
    const card = payment.brand ? `${payment.brand} ending ${payment.last4}` : "card";
    const left = refundable(payment);
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge tone={payment.status === "paid" ? "good" : "warn"}>
            {payment.status === "refunded" ? "Refunded" : payment.status === "partially_refunded" ? "Partly refunded" : "Paid"}
          </StatusBadge>
          <p className="text-note text-fg-body">
            {money(payment.amount)} by {card} on {formatDateTime(payment.paidAt)}
            {payment.refundedAmount > 0 ? ` · ${money(payment.refundedAmount)} refunded` : ""}
          </p>
        </div>

        {refunded ? <p className="text-note font-bold text-fg">{refunded}</p> : null}

        {left > 0 ? (
          <button
            type="button"
            onClick={() => {
              setRefunded(null);
              setRefunding(true);
            }}
            className="rounded-field border border-border px-3.5 py-2 text-note font-bold text-fg hover:border-danger hover:text-danger"
          >
            Refund…
          </button>
        ) : null}

        {refunding ? (
          <RefundDialog
            bookingId={booking._id}
            remaining={left}
            paid={payment.amount}
            cardLabel={card}
            onClose={() => setRefunding(false)}
            onDone={() => {
              setRefunded("Refund sent to the card.");
              onChanged();
            }}
          />
        ) : null}
      </div>
    );
  }

  if (booking.status === "cancelled") {
    return <p className="text-note text-fg-muted">This booking is cancelled, so there is nothing to pay.</p>;
  }

  const live = paymentLink && new Date(paymentLink.expiresAt).getTime() > openedAt;

  async function send() {
    setSending(true);
    setError(null);
    try {
      const result = await sendPaymentLink(booking._id);
      setConfirming(false);
      setNotice(
        result.emailed
          ? `Link emailed to ${result.sentTo}.`
          : "The email could not be sent, but the link works. Copy it and send it another way.",
      );
      onChanged();
    } catch (err) {
      setError(errorText(err, "Could not send the payment link"));
    } finally {
      setSending(false);
    }
  }

  async function copy() {
    if (!paymentLink) return;
    try {
      await navigator.clipboard.writeText(paymentLink.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Your browser would not copy it. Select the link and copy it by hand.");
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge tone="warn">Unpaid</StatusBadge>
        <p className="text-note text-fg-body">{fare > 0 ? `${money(fare)} due` : "No fare to charge yet"}</p>
      </div>

      {paymentLink ? (
        <p className="text-note text-fg-muted">
          {live
            ? `Link sent ${formatDateTime(paymentLink.sentAt)}${paymentLink.emailed ? "" : " (the email did not go out)"}; it works until ${formatDateTime(paymentLink.expiresAt)}.`
            : `The link sent ${formatDateTime(paymentLink.sentAt)} has expired.`}
        </p>
      ) : null}

      {notice ? <p className="text-note font-bold text-fg">{notice}</p> : null}
      {error && !confirming ? <p className="text-note font-bold text-danger">{error}</p> : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={fare <= 0}
          onClick={() => {
            setNotice(null);
            setError(null);
            setConfirming(true);
          }}
          className="rounded-field bg-primary px-3.5 py-2 text-note font-bold text-primary-fg disabled:opacity-50"
        >
          {paymentLink ? "Send a new payment link" : "Send payment link"}
        </button>
        {live ? (
          <button
            type="button"
            onClick={() => void copy()}
            className="rounded-field border border-border px-3.5 py-2 text-note font-bold text-fg hover:border-accent"
          >
            {copied ? "Copied" : "Copy link"}
          </button>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirming}
        title={paymentLink ? "Send a new payment link?" : "Send a payment link?"}
        confirmLabel="Send link"
        pendingLabel="Sending…"
        pending={sending}
        error={error}
        onConfirm={() => void send()}
        onCancel={() => setConfirming(false)}
      >
        <p>
          {clientName ?? "The client"}
          {clientEmail ? ` (${clientEmail})` : ""} will be emailed a secure page to pay {money(fare)} by card.
          {paymentLink ? " The link sent before stops working." : ""}
        </p>
      </ConfirmDialog>
    </div>
  );
}

/** The fare as it was priced, then whether it is paid and how to ask for the money. */
export function PaymentLink(props: Parameters<typeof PaymentLinkBody>[0]) {
  return (
    <div>
      <FareLines booking={props.booking} />
      <PaymentLinkBody {...props} />
    </div>
  );
}

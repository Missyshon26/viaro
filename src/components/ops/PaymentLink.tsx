"use client";

import { useState } from "react";
import { formatDateTime, money } from "@/components/ui/DataTable";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { StatusBadge } from "@/components/ui/Dashboard";
import { RefundDialog } from "@/components/ops/RefundDialog";
import { balanceOf, paidTotal, refundableTotal, refundedTotal } from "@/lib/balance";
import { fareLines } from "@/lib/fareLines";
import { errorText } from "@/lib/api/client";
import { sendPaymentLink, sendUpgradeLink } from "@/lib/api/admin";
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
  // Upgrading a paid trip: ask the client for the difference; downgrading: refund the overpayment.
  const [refundPrefill, setRefundPrefill] = useState<number | undefined>(undefined);
  const [confirmingUpgrade, setConfirmingUpgrade] = useState(false);
  const [sendingUpgrade, setSendingUpgrade] = useState(false);
  // When the page was opened: a link is shown as live or expired relative to this.
  const [openedAt] = useState(() => Date.now());

  const { payment, paymentLink } = booking;
  const fare = booking.estimatedFare ?? 0;

  if (payment) {
    const card = payment.brand ? `${payment.brand} ending ${payment.last4}` : "card";
    const left = refundableTotal(booking);
    const balance = balanceOf(booking);
    const upgradeLink = booking.upgradeLink;
    const upgradeLive = upgradeLink && new Date(upgradeLink.expiresAt).getTime() > openedAt;

    async function sendUpgrade() {
      setSendingUpgrade(true);
      setError(null);
      try {
        const result = await sendUpgradeLink(booking._id);
        setConfirmingUpgrade(false);
        setNotice(
          result.emailed
            ? `Link for ${money(result.amount)} emailed to ${result.sentTo}.`
            : "The email could not be sent, but the link works. Copy it and send it another way.",
        );
        onChanged();
      } catch (err) {
        setError(errorText(err, "Could not send the payment link"));
      } finally {
        setSendingUpgrade(false);
      }
    }

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

        {(booking.extraPayments ?? []).map((extra, i) => (
          <p key={i} className="text-note text-fg-body">
            Upgrade payment: {money(extra.amount)} by {extra.brand ? `${extra.brand} ending ${extra.last4}` : "card"} on {formatDateTime(extra.paidAt)}
            {extra.refundedAmount > 0 ? ` · ${money(extra.refundedAmount)} refunded` : ""}
          </p>
        ))}

        {/* The vehicle changed after payment: the fare no longer equals what was paid. */}
        {balance > 0 ? (
          <div className="rounded-field border border-chart-warn/40 bg-chart-warn/5 p-3.5">
            <p className="text-note font-bold text-fg">{money(balance)} more to collect</p>
            <p className="mt-1 text-note text-fg-body">
              The fare is now {money(booking.estimatedFare ?? 0)} and {money(paidTotal(booking) - refundedTotal(booking))} has been paid.
              {upgradeLink
                ? upgradeLive
                  ? ` A link for ${money(upgradeLink.amount)} was sent ${formatDateTime(upgradeLink.sentAt)}${upgradeLink.emailed ? "" : " (the email did not go out)"}; it works until ${formatDateTime(upgradeLink.expiresAt)}.`
                  : ` The link sent ${formatDateTime(upgradeLink.sentAt)} has expired.`
                : ""}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setNotice(null);
                  setError(null);
                  setConfirmingUpgrade(true);
                }}
                className="rounded-field bg-primary px-3.5 py-2 text-note font-bold text-primary-fg"
              >
                {upgradeLink ? `Send a new link for ${money(balance)}` : `Email payment link for ${money(balance)}`}
              </button>
              {upgradeLive ? (
                <button
                  type="button"
                  onClick={() => void navigator.clipboard.writeText(upgradeLink.url).then(() => setCopied(true), () => setError("Your browser would not copy it."))}
                  className="rounded-field border border-border px-3.5 py-2 text-note font-bold text-fg hover:border-accent"
                >
                  {copied ? "Copied" : "Copy link"}
                </button>
              ) : null}
            </div>
          </div>
        ) : balance < 0 ? (
          <div className="rounded-field border border-chart-warn/40 bg-chart-warn/5 p-3.5">
            <p className="text-note font-bold text-fg">{money(-balance)} overpaid</p>
            <p className="mt-1 text-note text-fg-body">
              The fare is now {money(booking.estimatedFare ?? 0)}, less than was paid. Refund the difference to the card when you are ready.
            </p>
            <button
              type="button"
              disabled={left <= 0}
              onClick={() => {
                setRefunded(null);
                setRefundPrefill(Math.min(-balance, left));
                setRefunding(true);
              }}
              className="mt-3 rounded-field border border-border px-3.5 py-2 text-note font-bold text-fg hover:border-danger hover:text-danger disabled:opacity-50"
            >
              Refund {money(Math.min(-balance, left))}…
            </button>
          </div>
        ) : null}

        {notice ? <p className="text-note font-bold text-fg">{notice}</p> : null}
        {error && !confirmingUpgrade ? <p className="text-note font-bold text-danger">{error}</p> : null}
        {refunded ? <p className="text-note font-bold text-fg">{refunded}</p> : null}

        {left > 0 ? (
          <button
            type="button"
            onClick={() => {
              setRefunded(null);
              setRefundPrefill(undefined);
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
            paid={paidTotal(booking)}
            cardLabel={card}
            initialAmount={refundPrefill}
            onClose={() => setRefunding(false)}
            onDone={() => {
              setRefunded("Refund sent to the card.");
              onChanged();
            }}
          />
        ) : null}

        <ConfirmDialog
          open={confirmingUpgrade}
          title="Send a payment link for the upgrade?"
          confirmLabel="Send link"
          pendingLabel="Sending…"
          pending={sendingUpgrade}
          error={error}
          onConfirm={() => void sendUpgrade()}
          onCancel={() => setConfirmingUpgrade(false)}
        >
          <p>
            {clientName ?? "The client"}
            {clientEmail ? ` (${clientEmail})` : ""} will be emailed a secure page to pay the extra {money(balance)} by card.
            {upgradeLink ? " The link sent before stops working." : ""}
          </p>
        </ConfirmDialog>
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

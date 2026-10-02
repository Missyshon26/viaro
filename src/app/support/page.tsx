"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Card, Kicker } from "@/components/ui/Surfaces";
import { Button } from "@/components/ui/Button";
import { ConsolePage, formatDateTime } from "@/components/ui/DataTable";
import {
  listTickets,
  replyToTicket,
  setTicketStatus,
  type Ticket,
  type TicketQueue,
  type TicketSource,
} from "@/lib/api/admin";
import { errorText } from "@/lib/api/client";

/** Triage queue. Only an admin may move a ticket's state — the PATCH is admin-guarded. */
const STATUSES = ["open", "pending", "resolved", "closed"] as const;
const FILTERS = ["all", ...STATUSES] as const;

/**
 * Who opened the case. Passengers and chauffeurs raise different things (fare disputes vs
 * penalty appeals) and are answered differently, so the queue splits on it.
 */
const SOURCES = [
  { value: "all", label: "All" },
  { value: "customer", label: "Clients" },
  { value: "driver", label: "Drivers" },
] as const;

const SOURCE_LABEL: Record<string, string> = {
  customer: "Client",
  driver: "Driver",
  admin: "Staff",
};

const CATEGORY_LABEL: Record<string, string> = {
  trip_dispute: "Trip dispute",
  penalty_appeal: "Penalty appeal",
  payment: "Payment",
  account: "Account",
  other: "Other",
};

const inputClass =
  "w-full rounded-field border border-border bg-surface-raised px-3 py-2 text-note text-fg outline-none";

export default function SupportPage() {
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [counts, setCounts] = useState<TicketQueue["counts"]>();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [source, setSource] = useState<(typeof SOURCES)[number]["value"]>("all");
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const page = await listTickets({
        source: source === "all" ? undefined : (source as TicketSource),
        status: filter === "all" ? undefined : filter,
      });
      setTickets(page.items ?? []);
      setCounts(page.counts);
      setError(null);
    } catch (err) {
      setError(errorText(err, "Could not load the queue"));
      setTickets([]);
    }
  }, [source, filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = tickets ?? [];

  return (
    <ConsolePage
      title="Support queue"
      description="Disputes and appeals from passengers and chauffeurs."
      action={
        <div className="flex gap-1 rounded-field bg-accent-soft p-1">
          {FILTERS.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              aria-pressed={filter === value}
              /*
               * Both this filter chip and the "move this case to…" action below render a
               * bare status word, so "resolved" was the accessible name of two different
               * controls on the same screen — indistinguishable to anyone navigating by
               * a list of buttons.
               */
              aria-label={value === "all" ? "Show all cases" : `Filter: ${value}`}
              className={`rounded-[0.5rem] px-3 py-1.5 text-label font-bold capitalize transition-colors ${
                filter === value
                  ? "bg-surface-raised text-fg"
                  : "text-accent-strong hover:text-fg"
              }`}
            >
              {value}
            </button>
          ))}
        </div>
      }
    >
      {error ? <p className="mb-4 text-note font-bold text-danger">{error}</p> : null}

      <div role="tablist" aria-label="Who opened the case" className="mb-4 flex flex-wrap gap-2">
        {SOURCES.map((option) => {
          const active = source === option.value;
          const count = counts?.[option.value];
          return (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setSource(option.value)}
              className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-note font-bold transition-colors ${
                active
                  ? "border-accent bg-accent-soft text-fg"
                  : "border-border text-fg-muted hover:border-accent hover:text-fg"
              }`}
            >
              {option.label}
              {typeof count === "number" ? (
                <span className="rounded-full bg-surface-raised px-2 py-0.5 text-label text-fg-muted">
                  {count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <Card className="p-0">
        {tickets === null ? (
          <p className="p-6 text-note text-fg-muted">Loading…</p>
        ) : visible.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-card font-bold text-fg">Nothing to triage</p>
            <p className="mt-2 text-note text-fg-muted">No cases match that filter.</p>
          </div>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {visible.map((ticket) => (
              <li key={ticket._id}>
                <button
                  type="button"
                  onClick={() => setOpen(open === ticket._id ? null : ticket._id)}
                  className="flex w-full flex-wrap items-center gap-4 px-6 py-4 text-left transition-colors hover:bg-surface"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-meta font-bold text-fg">{ticket.subject}</p>
                    <p className="mt-0.5 text-note text-fg-muted">
                      {CATEGORY_LABEL[ticket.category] ?? ticket.category}
                      {ticket.userId && typeof ticket.userId === "object"
                        ? ` · ${ticket.userId.name}`
                        : ""}{" "}
                      · {formatDateTime(ticket.createdAt)}
                    </p>
                  </div>
                  {ticket.requesterRole ? (
                    <Badge tone="panel">{SOURCE_LABEL[ticket.requesterRole] ?? ticket.requesterRole}</Badge>
                  ) : null}
                  <Badge>{ticket.status}</Badge>
                </button>

                {open === ticket._id ? (
                  <div className="border-t border-border-subtle bg-surface px-6 py-5">
                    <ul className="space-y-4">
                      {(ticket.messages ?? []).map((message, index) => (
                        <li key={index}>
                          <p className="text-label font-bold uppercase text-accent">
                            {message.senderRole}
                          </p>
                          <p className="mt-1 whitespace-pre-wrap text-note leading-relaxed text-fg">
                            {message.message}
                          </p>
                        </li>
                      ))}
                    </ul>

                    <div className="mt-5 space-y-4">
                      <ReplyForm ticketId={ticket._id} onDone={load} />
                      <StatusControl
                        ticketId={ticket._id}
                        current={ticket.status}
                        onDone={load}
                      />
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </ConsolePage>
  );
}

function ReplyForm({ ticketId, onDone }: { ticketId: string; onDone: () => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setPending(true);
        try {
          await replyToTicket(ticketId, String(form.get("message")));
          (event.target as HTMLFormElement).reset();
          setError(null);
          onDone();
        } catch (err) {
          setError(errorText(err, "Could not send"));
        } finally {
          setPending(false);
        }
      }}
      className="space-y-3"
    >
      {error ? <p className="text-label text-danger">{error}</p> : null}
      <textarea
        name="message"
        rows={3}
        required
        maxLength={4000}
        placeholder="Reply to this case…"
        className={inputClass}
      />
      <Button type="submit" variant="accent" block={false} disabled={pending}>
        {pending ? "Sending…" : "Send reply"}
      </Button>
    </form>
  );
}

function StatusControl({
  ticketId,
  current,
  onDone,
}: {
  ticketId: string;
  current: string;
  onDone: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="border-t border-border-subtle pt-4">
      <Kicker>Move this case</Kicker>
      {error ? <p className="mt-2 text-label text-danger">{error}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {STATUSES.filter((status) => status !== current).map((status) => (
          <Button
            key={status}
            variant="secondary"
            block={false}
            disabled={pending}
            className="capitalize"
            aria-label={`Move this case to ${status}`}
            onClick={async () => {
              setPending(true);
              try {
                await setTicketStatus(ticketId, status);
                setError(null);
                onDone();
              } catch (err) {
                setError(errorText(err, "Could not update"));
              } finally {
                setPending(false);
              }
            }}
          >
            {status}
          </Button>
        ))}
      </div>
    </div>
  );
}

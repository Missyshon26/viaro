import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, FileWarning, Mail, MessageSquareText, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageShell, Panel, EmptyState, SectionTitle, formatDateTime } from "@/components/app/shell";
import { TicketStatusBadge } from "@/components/app/status-badge";
import { listTickets } from "@/lib/api/account";
import type { Paginated, SupportTicket } from "@/lib/api/types";
import {
  SUPPORT_EMAIL,
  SUPPORT_HOURS,
  SUPPORT_PHONE,
  SUPPORT_PHONE_HREF,
} from "@/lib/constants";

export const metadata: Metadata = {
  title: "Support | Viaro",
  robots: { index: false, follow: false },
};

function toItems(payload: Paginated<SupportTicket> | SupportTicket[]): SupportTicket[] {
  return Array.isArray(payload) ? payload : (payload.items ?? []);
}

const CATEGORY_LABEL: Record<string, string> = {
  trip_dispute: "Trip dispute",
  penalty_appeal: "Penalty appeal",
  payment: "Payment",
  account: "Account",
  other: "Other",
};

/** Cases that need someone's attention come first; finished ones sink. */
const STATUS_ORDER: Record<string, number> = { open: 0, pending: 1, resolved: 2, closed: 3 };

export default async function SupportPage() {
  const tickets = toItems(await listTickets(1, 100)).sort(
    (a, b) =>
      (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) ||
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
  const active = tickets.filter((t) => t.status === "open" || t.status === "pending");
  const finished = tickets.filter((t) => t.status !== "open" && t.status !== "pending");

  return (
    <PageShell title="Support" description="Help right now, or a formal case our team follows through.">
      {/*
        Two different needs, kept apart. Someone whose chauffeur has not arrived needs a
        person now — a phone number, not a form. A dispute over a charge needs a written
        record that is tracked to a resolution.
      */}
      <div className="grid gap-4 md:grid-cols-2">
        <Panel className="flex flex-col">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-azure/10 text-azure">
              <Phone className="h-5 w-5" />
            </span>
            <div>
              <p className="font-medium text-cloud">Need help right now?</p>
              <p className="text-sm text-muted-foreground">{SUPPORT_HOURS}</p>
            </div>
          </div>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            A late chauffeur, a changed flight, a pickup today — call and a dispatcher picks up.
            For a ride in progress you can also message your chauffeur from the trip.
          </p>
          <div className="mt-auto flex flex-wrap gap-3 pt-5">
            <Button asChild>
              <a href={SUPPORT_PHONE_HREF}>
                <Phone className="mr-2 h-4 w-4" />
                Call {SUPPORT_PHONE}
              </a>
            </Button>
            <Button asChild variant="outline">
              <a href={`mailto:${SUPPORT_EMAIL}`}>
                <Mail className="mr-2 h-4 w-4" />
                Email us
              </a>
            </Button>
          </div>
        </Panel>

        <Panel className="flex flex-col">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-midnight/25 text-cloud">
              <FileWarning className="h-5 w-5" />
            </span>
            <div>
              <p className="font-medium text-cloud">Open a formal case</p>
              <p className="text-sm text-muted-foreground">Answered in writing, usually within a day</p>
            </div>
          </div>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            A charge you disagree with, a no-show, a lost item or a complaint. Every case is read
            by a person and kept on record here until it is resolved.
          </p>
          <div className="mt-auto pt-5">
            <Button asChild variant="outline">
              <Link href="/support/new">
                <MessageSquareText className="mr-2 h-4 w-4" />
                Open a case
              </Link>
            </Button>
          </div>
        </Panel>
      </div>

      <div className="mt-10">
        <SectionTitle>Your cases</SectionTitle>
        <div className="mt-4">
          {tickets.length === 0 ? (
            <EmptyState
              title="No cases"
              description="If something goes wrong on a trip, open a case and a person will pick it up."
            />
          ) : (
            <div className="space-y-6">
              <CaseList tickets={active} emptyText="Nothing waiting — all your cases are resolved." />
              {finished.length > 0 ? (
                <div>
                  <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">Resolved &amp; closed</p>
                  <CaseList tickets={finished} muted />
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </PageShell>
  );
}

function CaseList({
  tickets,
  muted,
  emptyText,
}: {
  tickets: SupportTicket[];
  muted?: boolean;
  emptyText?: string;
}) {
  if (tickets.length === 0) {
    return emptyText ? <p className="text-sm text-muted-foreground">{emptyText}</p> : null;
  }
  return (
    <Panel className={`p-0 ${muted ? "opacity-80" : ""}`}>
      <ul className="divide-y divide-border">
        {tickets.map((ticket) => {
          const count = ticket.messages?.length ?? 0;
          const last = ticket.messages?.[count - 1];
          return (
            <li key={ticket._id}>
              <Link
                href={`/support/${ticket._id}`}
                className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-white/[0.03]"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-cloud group-hover:text-azure">{ticket.subject}</p>
                  <p className="mt-1 truncate text-sm text-muted-foreground">
                    {CATEGORY_LABEL[ticket.category] ?? "Other"} · updated {formatDateTime(ticket.updatedAt, { zone: false })}
                    {last?.senderRole === "admin" ? " · Viaro replied" : ""}
                  </p>
                </div>
                <TicketStatusBadge status={ticket.status} />
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

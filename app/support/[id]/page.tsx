import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageShell, Panel, SectionTitle, formatDateTime } from "@/components/app/shell";
import { TicketStatusBadge } from "@/components/app/status-badge";
import { ReplyForm } from "@/components/app/support-forms";
import { apiOptional } from "@/lib/api/client";
import type { SupportTicket } from "@/lib/api/types";
import { SUPPORT_PHONE, SUPPORT_PHONE_HREF } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Case | Viaro",
  robots: { index: false, follow: false },
};

const CATEGORY_LABEL: Record<string, string> = {
  trip_dispute: "Trip dispute",
  penalty_appeal: "Penalty appeal",
  payment: "Payment",
  account: "Account",
  other: "Other",
};

/**
 * A support case, shown as a conversation.
 *
 * It used to be a table of rows headed "CUSTOMER" and "ADMIN" — accurate, and nothing
 * like talking to someone. Now: the passenger's messages on the right in Midnight Route,
 * Viaro's on the left, each with a readable time, in the order they were sent.
 */
export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ticket = await apiOptional<SupportTicket>(`/support/tickets/${id}`);

  if (!ticket) notFound();

  const closed = ticket.status === "closed" || ticket.status === "resolved";
  const messages = ticket.messages ?? [];

  return (
    <PageShell
      title={ticket.subject}
      description={`${CATEGORY_LABEL[ticket.category] ?? "Other"} · opened ${formatDateTime(ticket.createdAt, { zone: false })}`}
      action={
        <Button asChild variant="outline">
          <Link href="/support">
            <ArrowLeft className="mr-2 h-4 w-4" />
            All cases
          </Link>
        </Button>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] lg:items-start">
        <Panel className="p-0">
          <ol className="space-y-5 px-4 py-6 sm:px-6" aria-label="Conversation">
            {messages.map((message, index) => {
              const mine = message.senderRole !== "admin";
              return (
                <li key={index} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                  <div className={`flex max-w-[85%] flex-col ${mine ? "items-end" : "items-start"}`}>
                    <p className="mb-1.5 px-1 text-xs text-muted-foreground">
                      <span className={mine ? "text-cloud/80" : "font-medium text-azure"}>
                        {mine ? "You" : "Viaro Support"}
                      </span>
                      {" · "}
                      {formatDateTime(message.createdAt, { zone: false })}
                    </p>
                    <div
                      className={`whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-[0.95rem] leading-relaxed ${
                        mine
                          ? "rounded-br-md bg-midnight text-cloud"
                          : "rounded-bl-md border border-border bg-secondary text-cloud"
                      }`}
                    >
                      {message.message}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>

          <div className="border-t border-border px-4 py-5 sm:px-6">
            {closed ? (
              <p className="text-sm text-muted-foreground">
                This case is {ticket.status === "resolved" ? "resolved" : "closed"}.{" "}
                <Link href="/support/new" className="text-azure underline underline-offset-4">
                  Open a new case
                </Link>{" "}
                if you need anything else.
              </p>
            ) : (
              <ReplyForm ticketId={ticket._id} />
            )}
          </div>
        </Panel>

        <div className="space-y-6 lg:sticky lg:top-24">
          <Panel>
            <SectionTitle>Status</SectionTitle>
            <div className="mt-4">
              <TicketStatusBadge status={ticket.status} />
            </div>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              {ticket.status === "open"
                ? "With our team. You'll get a notification here when we reply."
                : ticket.status === "pending"
                  ? "We've replied — answer below and it goes straight back to the team."
                  : "No further action is needed on this case."}
            </p>
          </Panel>
          <Panel>
            <SectionTitle>Urgent?</SectionTitle>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              For anything about a ride today, call{" "}
              <a href={SUPPORT_PHONE_HREF} className="text-cloud underline underline-offset-4">
                {SUPPORT_PHONE}
              </a>
              .
            </p>
          </Panel>
        </div>
      </div>
    </PageShell>
  );
}

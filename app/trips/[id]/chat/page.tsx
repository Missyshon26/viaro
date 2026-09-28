import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PageShell, Panel, SectionTitle, EmptyState } from "@/components/app/shell";
import { ChatThread } from "@/components/app/chat-thread";
import { ChatComposer } from "@/components/app/chat-composer";
import { LiveRefresh } from "@/components/app/live-refresh";
import { apiOptional, ApiError } from "@/lib/api/client";
import { getBooking } from "@/lib/api/bookings";
import { getCurrentUser } from "@/lib/auth/current-user";
import type { ChatMessage } from "@/lib/api/trips";
import type { Booking, Paginated, Receipt, Trip } from "@/lib/api/types";

export const metadata: Metadata = {
  title: "Chat | Viaro",
  robots: { index: false, follow: false },
};

function toMessages(payload: ChatMessage[] | Paginated<ChatMessage> | null): ChatMessage[] {
  if (!payload) return [];
  return Array.isArray(payload) ? payload : (payload.items ?? []);
}

/**
 * Customer to chauffeur chat.
 *
 * History comes from `GET /trips/:id/chat/history`; messages are sent with
 * `POST /trips/:id/chat/messages`. New messages from the chauffeur arrive over the events
 * stream (LiveRefresh, topic "chat"), which re-reads the thread.
 */
export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();

  let booking: Booking | null = null;
  try {
    booking = await getBooking(id);
  } catch (err) {
    if (!(err instanceof ApiError) || !(err.isNotFound || err.isForbidden)) throw err;
  }

  const receipt = booking
    ? await apiOptional<Receipt>(`/users/me/rides/${booking._id}/receipt`)
    : null;
  const tripId = receipt?.tripId ?? id;

  const [trip, history] = await Promise.all([
    apiOptional<Trip>(`/trips/${tripId}`),
    apiOptional<ChatMessage[] | Paginated<ChatMessage>>(`/trips/${tripId}/chat/history`),
  ]);

  if (!booking && !trip) notFound();

  const messages = toMessages(history);
  const driverName = trip?.driver?.name ?? null;

  return (
    <PageShell
      title={driverName ? `Chat with ${driverName}` : "Chat"}
      description="Messages go through Viaro, so neither of you sees the other's number."
      action={
        <Button asChild variant="outline">
          <Link href={`/trips/${id}`}>Trip details</Link>
        </Button>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <Panel className="p-0">
          {messages.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No messages yet"
                description={
                  trip
                    ? "Anything you send appears here, and in your chauffeur's app."
                    : "Chat opens once a chauffeur accepts your booking."
                }
              />
            </div>
          ) : (
            <ChatThread messages={messages} currentUserId={user?._id ?? ""} otherName={driverName} />
          )}

          <div className="border-t border-border p-6">
            <ChatComposer
              tripId={trip?._id ?? null}
              bookingId={booking?._id ?? id}
              disabled={trip?.status === "completed" || trip?.status === "cancelled"}
            />
          </div>
        </Panel>

        <Panel>
          <SectionTitle>How chat works</SectionTitle>
          <ul className="mt-5 space-y-3 text-sm leading-relaxed text-muted-foreground">
            <li>Your number stays private — the chauffeur never sees it.</li>
            <li>The thread stays with the trip, so you can refer back to it later.</li>
            <li>Dispatch can review a conversation if you raise a dispute.</li>
          </ul>
        </Panel>
      </div>
      {/* A message from the chauffeur shows up without a reload. */}
      <LiveRefresh topics={["chat", "trip"]} />
    </PageShell>
  );
}

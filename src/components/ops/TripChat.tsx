"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, Kicker } from "@/components/ui/Surfaces";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getChatHistory, sendChatMessage, type ChatMessage } from "@/lib/api/driver";
import { ApiError } from "@/lib/api/client";
import { useLiveChanges } from "@/lib/live/useLiveChanges";

/**
 * Chauffeur ↔ passenger chat for one trip.
 *
 * The chauffeur portal had no chat at all, and the passenger site could only read. Both
 * now send over REST (POST /trips/:id/chat/messages) and hear about new messages on the
 * events stream (topic "chat"), which re-reads the history. Numbers stay private: the
 * conversation goes through Viaro.
 */
export function TripChat({
  tripId,
  passengerName,
  closed,
}: {
  tripId: string;
  passengerName: string | null;
  closed: boolean;
}) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const history = await getChatHistory(tripId);
      setMessages(Array.isArray(history) ? history : []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load messages");
      setMessages([]);
    }
  }, [tripId]);

  useEffect(() => {
    void load();
  }, [load]);

  useLiveChanges(["chat"], (event) => {
    if (!event.id || event.id === tripId) void load();
  });

  const last = messages?.[messages.length - 1]?._id;
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [last]);

  async function send() {
    const message = text.trim();
    if (!message || sending) return;
    setSending(true);
    setError(null);
    try {
      await sendChatMessage(tripId, message);
      setText("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send");
    } finally {
      setSending(false);
    }
  }

  return (
    <Card className="p-0">
      <div className="px-5 pt-5">
        <Kicker>Chat with {passengerName ?? "the passenger"}</Kicker>
      </div>

      <div className="mt-3 max-h-80 overflow-y-auto px-5">
        {messages === null ? (
          <p className="py-4 text-note text-fg-muted">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="py-4 text-note text-fg-muted">
            No messages yet. Let the passenger know you&apos;re on the way.
          </p>
        ) : (
          <ul className="space-y-3 py-2">
            {messages.map((m) => {
              const senderId = typeof m.senderId === "object" ? m.senderId._id : m.senderId;
              const mine = senderId === user?._id;
              return (
                <li key={m._id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                  <div className={`flex max-w-[85%] flex-col ${mine ? "items-end" : "items-start"}`}>
                    <p className="mb-0.5 px-1 text-label text-fg-muted">
                      {mine ? "You" : (passengerName ?? "Passenger")} ·{" "}
                      {/* Pacific, like the passenger's view and every trip time. */}
                      {new Date(m.createdAt).toLocaleTimeString("en-US", {
                        timeZone: "America/Los_Angeles",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </p>
                    <p
                      className={`whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-meta ${
                        mine ? "rounded-br-md bg-accent text-white" : "rounded-bl-md bg-surface text-fg"
                      }`}
                    >
                      {m.message}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div ref={end} />
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
        className="flex items-end gap-2 border-t border-border p-4"
      >
        <textarea
          rows={1}
          value={text}
          maxLength={2000}
          disabled={closed || sending}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
          placeholder={closed ? "This trip has ended — chat is closed" : "Type a message…"}
          aria-label="Message"
          className="max-h-32 min-h-10 flex-1 resize-none rounded-field border border-border bg-surface px-3 py-2 text-meta text-fg outline-none focus:border-accent disabled:opacity-60"
        />
        <Button
          type="submit"
          variant="accent"
          block={false}
          className="h-10 shrink-0 px-5"
          disabled={closed || sending || !text.trim()}
        >
          {sending ? "Sending…" : "Send"}
        </Button>
      </form>
      {error ? <p className="px-4 pb-3 text-label font-bold text-danger">{error}</p> : null}
    </Card>
  );
}

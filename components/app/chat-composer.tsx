"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SendHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { sendChatMessageAction } from "@/lib/actions/trip";

/**
 * The message box under a trip's chat.
 *
 * Sends over REST (POST /trips/:id/chat/messages); the chauffeur's screen hears about it
 * on the events stream and refreshes, as does this one. Enter sends, Shift+Enter adds a
 * line. It used to be a disabled box with a note about socket namespaces.
 */
export function ChatComposer({
  tripId,
  bookingId,
  disabled,
}: {
  /** Null until a chauffeur accepts — there is no trip to talk about before that. */
  tripId: string | null;
  bookingId: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const box = useRef<HTMLTextAreaElement>(null);
  const closed = disabled || !tripId;

  function send() {
    const message = text.trim();
    if (!message || !tripId || pending) return;
    start(async () => {
      const result = await sendChatMessageAction(tripId, bookingId, message);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      setText("");
      router.refresh();
      box.current?.focus();
    });
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
      className="flex items-end gap-3"
    >
      <label htmlFor="chat-message" className="sr-only">
        Message
      </label>
      <textarea
        id="chat-message"
        ref={box}
        rows={1}
        value={text}
        maxLength={2000}
        disabled={closed || pending}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            send();
          }
        }}
        placeholder={
          !tripId
            ? "Chat opens when a chauffeur accepts your booking"
            : disabled
              ? "This trip has ended — chat is closed"
              : "Type a message…"
        }
        className="max-h-40 min-h-11 flex-1 resize-none rounded-xl border border-input bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-azure focus:outline-none disabled:opacity-60"
      />
      <Button type="submit" size="lg" disabled={closed || pending || !text.trim()} className="h-11 gap-2">
        <SendHorizontal className="h-4 w-4" />
        {pending ? "Sending…" : "Send"}
      </Button>
    </form>
  );
}

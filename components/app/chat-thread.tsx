"use client";

import { useEffect, useRef } from "react";
import { formatDateTime } from "@/components/app/shell";
import type { ChatMessage } from "@/lib/api/trips";
import { cn } from "@/lib/utils";

const ROLE_LABEL: Record<string, string> = {
  driver: "Chauffeur",
  customer: "Passenger",
  admin: "Viaro",
};

/**
 * The transcript from GET /trips/:id/chat/history, newest at the bottom. It scrolls to the
 * latest message on open and whenever a new one arrives.
 */
export function ChatThread({
  messages,
  currentUserId,
  otherName,
}: {
  messages: ChatMessage[];
  currentUserId: string;
  /** The chauffeur's name, shown above their messages. */
  otherName?: string | null;
}) {
  const end = useRef<HTMLDivElement>(null);
  const last = messages[messages.length - 1]?._id;

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [last]);

  return (
    <div className="max-h-[32rem] overflow-y-auto p-6">
      <ul className="space-y-4">
        {messages.map((message) => {
          const sender = typeof message.senderId === "object" ? message.senderId : null;
          const senderId = sender ? sender._id : (message.senderId as string);
          const mine = senderId === currentUserId;
          const name = mine
            ? "You"
            : (sender?.name ?? otherName ?? ROLE_LABEL[message.senderRole] ?? "Chauffeur");

          return (
            <li key={message._id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
              <div className={cn("flex max-w-[80%] flex-col", mine ? "items-end" : "items-start")}>
                <p className="mb-1 px-1 text-xs text-muted-foreground">
                  <span className={mine ? "" : "font-medium text-azure"}>{name}</span> ·{" "}
                  {formatDateTime(message.createdAt, { zone: false })}
                </p>
                <p
                  className={cn(
                    "whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                    mine
                      ? "rounded-br-md bg-primary text-primary-foreground"
                      : "rounded-bl-md border border-border bg-secondary text-cloud",
                  )}
                >
                  {message.message}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
      <div ref={end} />
    </div>
  );
}

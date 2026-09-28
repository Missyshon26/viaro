"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-renders the page it sits on when the API says something relevant changed.
 *
 * These pages are Server Components, so there is no client-side fetch to repeat —
 * `router.refresh()` re-runs the server render and React reconciles the result, which
 * keeps every access decision on the server where it belongs. Nothing in this file ever
 * touches booking data.
 *
 * Plain EventSource, unlike the consoles: the stream is proxied through /api/events on
 * this same origin, so the browser sends the httpOnly session cookie automatically and
 * no token has to be handed to JavaScript. EventSource also reconnects on its own,
 * which is why there is no retry logic here.
 */

/** Mirrors CHANGE_TOPICS in the API. */
export type ChangeTopic =
  | "booking"
  | "trip"
  | "dispatch"
  | "driver"
  | "user"
  | "vehicle"
  | "wallet"
  | "notification"
  | "chat";

export function LiveRefresh({
  topics = ["booking", "trip", "dispatch"],
}: {
  topics?: ChangeTopic[];
}) {
  const router = useRouter();
  const wanted = topics.join(",");

  useEffect(() => {
    const interesting = new Set(wanted.split(",").filter(Boolean));
    const source = new EventSource("/api/events");

    const onChange = (event: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(event.data) as { topic?: string };
        if (parsed.topic && interesting.has(parsed.topic)) router.refresh();
      } catch {
        /* A malformed frame is not worth reloading the page over. */
      }
    };

    source.addEventListener("change", onChange as EventListener);

    /*
     * Returning to the tab is the other moment a page is reliably stale: EventSource is
     * throttled or suspended in a backgrounded tab, so a change can land unheard.
     */
    const onVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      source.removeEventListener("change", onChange as EventListener);
      source.close();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [wanted, router]);

  return null;
}

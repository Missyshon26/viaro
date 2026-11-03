"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { API_BASE_URL, getAccessToken } from "@/lib/api/client";
import { createLiveStream, type ChangeEvent, type ChangeTopic, type LiveStatus } from "./liveStream";

export type { ChangeEvent, ChangeTopic, LiveStatus };

/**
 * Keeps an open screen current when somebody else changes something.
 *
 * The server announces changes on GET /events/stream as Server-Sent Events. The payload is only a
 * topic, an action and an id — never domain data — so this does not update any state itself. It
 * calls back, and the screen re-runs the same fetch it already uses, which means role-based
 * response shaping keeps applying and there is no second code path that could show a field the API
 * would have withheld.
 *
 * Why Server-Sent Events, and not a webhook or a socket:
 *   - a webhook is one server calling another; a browser has no address to call, so it cannot
 *     receive one;
 *   - SSE is one-way server → browser, which is all "your list is stale" needs, passes through
 *     Cloudflare and nginx like ordinary HTTP, and has no client library to ship.
 *
 * ONE stream per browser tab, however many components listen (the dashboard, the sidebar badges
 * and the notification bell used to hold three or four open at once). See liveStream.ts.
 *
 * Read with fetch rather than EventSource because EventSource cannot set headers and the access
 * token is deliberately held in memory, not in a cookie or localStorage; putting it in the query
 * string would write a live credential into every proxy and access log on the way.
 *
 * Falls back to polling on its own if the stream will not hold, so a screen is never *less* fresh
 * than it was before.
 */
const stream = createLiveStream({
  url: () => `${API_BASE_URL}/events/stream`,
  getToken: getAccessToken,
  isVisible: () => typeof document === "undefined" || document.visibilityState === "visible",
  onVisible: (fn) => {
    const handler = () => fn();
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  },
});

/** The connection's state, for a small indicator. */
export function useLiveStatus(): LiveStatus {
  return useSyncExternalStore(stream.onStatus, stream.getStatus, () => "connecting" as LiveStatus);
}

/** A burst of events (one booking touches booking, trip and notification at once) is one reload. */
const DEFAULT_DEBOUNCE_MS = 800;

export function useLiveChanges(
  topics: ChangeTopic[],
  onChange: (event: ChangeEvent) => void,
  /** How long to wait for the burst to finish before calling `onChange` once, with the last event. */
  debounceMs: number = DEFAULT_DEBOUNCE_MS,
): void {
  // Held in a ref so a caller passing an inline arrow does not tear the subscription down on
  // every render — the effect depends on the topic list only.
  const latest = useRef(onChange);
  useEffect(() => {
    latest.current = onChange;
  });

  const wanted = topics.join(",");

  useEffect(() => {
    const list = wanted.split(",").filter(Boolean) as ChangeTopic[];
    let timer: ReturnType<typeof setTimeout> | undefined;
    // What the stream calls: it waits for quiet, then hands the newest event to the screen.
    const handler = {
      current: (event: ChangeEvent) => {
        if (debounceMs <= 0) return latest.current(event);
        clearTimeout(timer);
        timer = setTimeout(() => latest.current(event), debounceMs);
      },
    };
    const unsubscribe = stream.subscribe({ topics: new Set(list), primary: list[0] ?? "booking", handler });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [wanted, debounceMs]);
}

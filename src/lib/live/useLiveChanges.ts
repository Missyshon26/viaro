"use client";

import { useEffect, useRef } from "react";
import { API_BASE_URL, getAccessToken } from "@/lib/api/client";

/**
 * Keeps an open screen current when somebody else changes something.
 *
 * The server announces changes on GET /events/stream as Server-Sent Events. The payload
 * is only a topic, an action and an id — never domain data — so this hook does not
 * update any state itself. It calls back, and the screen re-runs the same fetch it
 * already uses, which means role-based response shaping keeps applying and there is no
 * second code path that could show a field the API would have withheld.
 *
 * Read with fetch rather than EventSource because EventSource cannot set headers and
 * the access token is deliberately held in memory, not in a cookie or localStorage.
 * Putting it in the query string instead would write a live credential into every proxy
 * and access log on the way.
 *
 * Falls back to polling on its own if the stream will not hold — an old proxy, a
 * corporate filter — so a screen is never *less* fresh than it was before.
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
  | "notification";

export interface ChangeEvent {
  topic: ChangeTopic;
  action: string;
  id?: string;
  at: string;
}

/** How long to wait before the first reconnect, doubling to RECONNECT_MAX_MS. */
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

/**
 * Used only once the stream has failed repeatedly. Slower than the stream by design:
 * this is the safety net, not the mechanism.
 */
const FALLBACK_POLL_MS = 20_000;

/** Consecutive failures before giving up on the stream and polling instead. */
const GIVE_UP_AFTER = 4;

export function useLiveChanges(
  topics: ChangeTopic[],
  onChange: (event: ChangeEvent) => void,
): void {
  // Held in refs so a caller passing an inline arrow does not tear down the stream on
  // every render — the effect depends on the topic list only.
  const handler = useRef(onChange);
  handler.current = onChange;

  const wanted = topics.join(",");

  useEffect(() => {
    const interesting = new Set(wanted.split(",").filter(Boolean));
    const primary = ((wanted.split(",")[0] || "booking") as ChangeTopic);
    const controller = new AbortController();

    let stopped = false;
    let failures = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let pollTimer: ReturnType<typeof setInterval> | undefined;

    /** A real server event: delivered only if the caller asked for that topic. */
    const notify = (event: ChangeEvent) => {
      if (interesting.has(event.topic)) handler.current(event);
    };

    /**
     * A locally generated "you are probably stale" nudge — a reconnect, a tab regaining
     * focus, or the polling fallback. These bypass the topic filter on purpose: the
     * hook does not know what changed while it was not listening, so the honest thing
     * is to let the screen refetch.
     */
    const nudge = (action: string) =>
      handler.current({ topic: primary, action, at: new Date().toISOString() });

    /** The net: pretend a change arrived so the screen refetches anyway. */
    const startPolling = () => {
      if (pollTimer) return;
      pollTimer = setInterval(() => {
        if (document.visibilityState !== "visible") return;
        nudge("poll");
      }, FALLBACK_POLL_MS);
    };

    const stopPolling = () => {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = undefined;
    };

    async function connect(): Promise<void> {
      if (stopped) return;

      const token = getAccessToken();
      if (!token) {
        // Signed out, or the session is still being restored on a fresh load. Retry
        // rather than treating it as a stream failure.
        reconnectTimer = setTimeout(() => void connect(), RECONNECT_MIN_MS);
        return;
      }

      try {
        const response = await fetch(`${API_BASE_URL}/events/stream`, {
          headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream" },
          signal: controller.signal,
          cache: "no-store",
        });

        if (!response.ok || !response.body) {
          throw new Error(`Stream refused with ${response.status}`);
        }

        // Connected: the fallback is no longer needed, and one refresh here catches
        // anything that changed while the stream was down.
        failures = 0;
        stopPolling();
        nudge("reconnected");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Frames are separated by a blank line. The tail is kept because a chunk
          // boundary can land in the middle of one.
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";

          for (const frame of frames) {
            for (const line of frame.split("\n")) {
              // ':' prefixed lines are comments — the server's heartbeat.
              if (!line.startsWith("data:")) continue;
              try {
                notify(JSON.parse(line.slice(5).trim()) as ChangeEvent);
              } catch {
                /* A malformed frame is not worth taking the stream down for. */
              }
            }
          }
        }

        throw new Error("Stream closed by the server");
      } catch (err) {
        if (stopped || controller.signal.aborted) return;

        failures += 1;
        /*
         * Previously discarded entirely, so a stream that could never connect — a wrong
         * API URL, an expired session, a proxy dropping SSE — looked identical to a quiet
         * one, and the app silently degraded to polling with nothing to diagnose from.
         */
        console.warn(
          `[live] connection attempt ${failures} failed; ` +
            (failures >= GIVE_UP_AFTER ? "falling back to polling" : "retrying"),
          err,
        );
        if (failures >= GIVE_UP_AFTER) startPolling();

        const wait = Math.min(RECONNECT_MIN_MS * 2 ** (failures - 1), RECONNECT_MAX_MS);
        reconnectTimer = setTimeout(() => void connect(), wait);
      }
    }

    /**
     * Coming back to the tab is the other moment a screen is reliably stale — the stream
     * may have been dropped while the tab was in the background.
     */
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      nudge("focus");
    };

    document.addEventListener("visibilitychange", onVisible);
    void connect();

    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisible);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      stopPolling();
      controller.abort();
    };
  }, [wanted]);
}

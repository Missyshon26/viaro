/**
 * The one connection to the API's change stream (Server-Sent Events), shared by every screen in
 * a browser tab. React-free and dependency-free on purpose: the address, the token and the clock
 * are handed in, so it can be tested on its own. useLiveChanges.ts wires it to the app.
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

/** What the connection is doing, for the "Live" light in the top bar. */
export type LiveStatus = "connecting" | "live" | "polling";

export interface Listener {
  topics: Set<string>;
  /** The topic a "you are probably stale" nudge is delivered as. */
  primary: ChangeTopic;
  handler: { current: (event: ChangeEvent) => void };
}

export interface LiveStreamOptions {
  /** Where the stream is (GET, Server-Sent Events). */
  url: () => string;
  /** The access token, or null while signed out / still being restored. */
  getToken: () => string | null;
  /** The page's visibility, so polling and "welcome back" refreshes skip a hidden tab. */
  isVisible?: () => boolean;
  /** Called to be told when the tab becomes visible again (returns the unsubscribe). */
  onVisible?: (fn: () => void) => () => void;
  /** Tunables, for tests. */
  reconnectMinMs?: number;
  reconnectMaxMs?: number;
  pollMs?: number;
  giveUpAfter?: number;
  closeGraceMs?: number;
  fetchImpl?: typeof fetch;
}

export function createLiveStream(options: LiveStreamOptions) {
  const {
    reconnectMinMs = 1_000,
    reconnectMaxMs = 30_000,
    // Used only once the stream has failed repeatedly: the safety net, not the mechanism — but
    // quick enough that a screen is never long behind.
    pollMs = 10_000,
    giveUpAfter = 3,
    // After the last listener leaves, wait before closing, so a page change does not reconnect.
    closeGraceMs = 3_000,
    isVisible = () => true,
    onVisible,
  } = options;

  let status: LiveStatus = "connecting";
  const statusListeners = new Set<() => void>();
  const listeners = new Set<Listener>();

  let controller: AbortController | null = null;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let failures = 0;
  let running = false;
  let stopVisibility: (() => void) | undefined;

  const setStatus = (next: LiveStatus) => {
    if (status === next) return;
    status = next;
    statusListeners.forEach((fn) => fn());
  };

  /** A real server event: delivered only to listeners that asked for that topic. */
  const deliver = (event: ChangeEvent) => {
    for (const l of listeners) if (l.topics.has(event.topic)) l.handler.current(event);
  };

  /**
   * A locally generated "you are probably stale" nudge — a reconnect, a tab regaining focus, or
   * the polling fallback. These bypass the topic filter on purpose: nothing here knows what
   * changed while it was not listening, so the honest thing is to let every screen refetch.
   */
  const nudge = (action: string) => {
    const at = new Date().toISOString();
    for (const l of listeners) l.handler.current({ topic: l.primary, action, at });
  };

  const stopPolling = () => {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = undefined;
  };

  const startPolling = () => {
    if (pollTimer) return;
    pollTimer = setInterval(() => {
      if (isVisible()) nudge("poll");
    }, pollMs);
  };

  async function connect(): Promise<void> {
    if (!running || !controller) return;
    const signal = controller.signal;

    const token = options.getToken();
    if (!token) {
      // Signed out, or the session is still being restored on a fresh load. Retry rather than
      // treating it as a stream failure.
      reconnectTimer = setTimeout(() => void connect(), reconnectMinMs);
      return;
    }

    try {
      const response = await (options.fetchImpl ?? fetch)(options.url(), {
        headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream" },
        signal,
        cache: "no-store",
      });

      if (!response.ok || !response.body) {
        throw new Error(`Stream refused with ${response.status}`);
      }

      // Connected: the fallback is no longer needed, and one refresh here catches anything that
      // changed while the stream was down.
      failures = 0;
      stopPolling();
      setStatus("live");
      nudge("reconnected");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Frames are separated by a blank line. The tail is kept because a chunk boundary can
        // land in the middle of one.
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";

        for (const frame of frames) {
          for (const line of frame.split("\n")) {
            // ':' prefixed lines are comments — the server's heartbeat.
            if (!line.startsWith("data:")) continue;
            try {
              deliver(JSON.parse(line.slice(5).trim()) as ChangeEvent);
            } catch {
              /* A malformed frame is not worth taking the stream down for. */
            }
          }
        }
      }

      throw new Error("Stream closed by the server");
    } catch (err) {
      if (!running || signal.aborted) return;

      failures += 1;
      /*
       * Not discarded: a stream that could never connect — a wrong API URL, an expired session,
       * a proxy dropping SSE — would otherwise look identical to a quiet one, and the app would
       * silently degrade to polling with nothing to diagnose from.
       */
      console.warn(
        `[live] connection attempt ${failures} failed; ` + (failures >= giveUpAfter ? "polling meanwhile" : "retrying"),
        err,
      );
      if (failures >= giveUpAfter) {
        setStatus("polling");
        startPolling();
      }

      // Keep trying to get the stream back, even while polling.
      const wait = Math.min(reconnectMinMs * 2 ** (failures - 1), reconnectMaxMs);
      reconnectTimer = setTimeout(() => void connect(), wait);
    }
  }

  function open() {
    if (running) return;
    running = true;
    failures = 0;
    controller = new AbortController();
    setStatus("connecting");
    // Coming back to the tab is the other moment a screen is reliably stale.
    stopVisibility = onVisible?.(() => {
      if (isVisible() && listeners.size > 0) nudge("focus");
    });
    void connect();
  }

  function close() {
    running = false;
    controller?.abort();
    controller = null;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
    stopPolling();
    stopVisibility?.();
    stopVisibility = undefined;
    setStatus("connecting");
  }

  return {
    /** Listen for changes. The stream opens with the first listener and closes after the last. */
    subscribe(listener: Listener): () => void {
      listeners.add(listener);
      if (closeTimer) clearTimeout(closeTimer);
      closeTimer = undefined;
      open();

      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          closeTimer = setTimeout(() => {
            if (listeners.size === 0) close();
          }, closeGraceMs);
        }
      };
    },
    getStatus: () => status,
    onStatus(fn: () => void): () => void {
      statusListeners.add(fn);
      return () => statusListeners.delete(fn);
    },
  };
}

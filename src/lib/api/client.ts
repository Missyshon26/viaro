import type { ApiEnvelope, ApiErrorBody } from "./types";

export const API_BASE_URL =
  typeof window !== "undefined" && process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_DEV_API_PROXY === "1"
    ? `${window.location.origin}/backend`
    : process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000";

/** What an operator reads when the browser cannot reach the API at all (offline, server down, blocked). */
export const CONNECTION_MESSAGE = "We couldn't reach the server. Check your connection and try again.";

/**
 * fetch, but a network failure becomes an ApiError with a readable message (status 0) instead of
 * the browser's own "Failed to fetch". Every call to the API goes through this.
 */
export async function reach(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (err) {
    // An aborted request is somebody cancelling it, not a lost connection.
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(0, CONNECTION_MESSAGE);
  }
}

/** Thrown for any non-2xx response so callers can branch on status and message. */
export class ApiError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }

  /** The backend uses these two for business-rule rejections. */
  get isConflict() {
    return this.status === 409;
  }
  get isForbidden() {
    return this.status === 403;
  }
}

/**
 * The access token lives in memory only.
 *
 * Not localStorage: anything that can run script on the page can read it there.
 * The refresh token is held in an httpOnly cookie by our own /api/auth routes, so a
 * page reload recovers the session without ever exposing a long-lived token to JS.
 */
let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}
export function getAccessToken() {
  return accessToken;
}

interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  /** Set false for the refresh call itself, to avoid an infinite retry loop. */
  retryOnUnauthorized?: boolean;
  query?: Record<string, string | number | boolean | undefined>;
}

/**
 * A page can paint, and start asking for its data, before the access token (memory only) has
 * been restored from the refresh cookie. The first request that finds no token waits for that
 * one restore instead of going out unauthenticated, getting a 401 and retrying — and every
 * other request in flight shares the same wait.
 */
let restoreAttempted = false;

async function waitForSession(): Promise<void> {
  if (accessToken) return;
  if (!restoreAttempted) {
    restoreAttempted = true;
    await refreshSession();
  } else if (refreshInFlight) {
    await refreshInFlight;
  }
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, query, retryOnUnauthorized = true, headers, ...init } = options;

  // The refresh route itself must not wait on itself.
  if (retryOnUnauthorized) await waitForSession();

  const url = new URL(path.startsWith("http") ? path : `${API_BASE_URL}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
    }
  }

  // A file upload is sent as-is: the browser writes the multipart Content-Type itself,
  // boundary included, and setting one by hand would break the upload.
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;

  const response = await reach(url.toString(), {
    ...init,
    headers: {
      ...(body && !isForm ? { "Content-Type": "application/json" } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
    body: isForm ? (body as FormData) : body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });

  // Access tokens are short-lived (15m). One transparent refresh, then give up.
  if (response.status === 401 && retryOnUnauthorized) {
    const refreshed = await refreshSession();
    if (refreshed) return request<T>(path, { ...options, retryOnUnauthorized: false });
  }

  const payload = (await response.json().catch(() => null)) as
    | ApiEnvelope<T>
    | ApiErrorBody
    | null;

  if (!response.ok || !payload || payload.success === false) {
    const err = payload as ApiErrorBody | null;
    throw new ApiError(
      response.status,
      err?.message ?? `Request failed with ${response.status}`,
      err?.details,
    );
  }

  return payload.data;
}

/**
 * Asks our own route handler to mint a new access token from the httpOnly cookie.
 *
 * Concurrent callers share one in-flight request. A refresh token can be spent exactly
 * once — the backend rotates it and treats a second use as a stolen token, ending every
 * session — so two refreshes racing at mount (the provider's restore plus a 401 retry, or
 * StrictMode's double effect) must not each present the same token.
 */
let refreshInFlight: Promise<boolean> | null = null;

export function refreshSession(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const res = await fetch("/api/auth/refresh", { method: "POST" });
      if (!res.ok) return false;
      const data = (await res.json()) as { accessToken?: string };
      if (!data.accessToken) return false;
      setAccessToken(data.accessToken);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

/**
 * The message to actually show a user for a failed request.
 *
 * The backend already explains itself — "A percentage payout cannot exceed 100", "Enter a
 * valid phone number" — but it puts field-level reasons in `details` and leaves the
 * top-level `message` as a flat "Validation failed". Rendering only `message` meant every
 * rejected form said the same useless thing while the real reason sat unread on the
 * error object.
 */
export function errorText(error: unknown, fallback = "Something went wrong"): string {
  if (!(error instanceof ApiError)) {
    return error instanceof Error && error.message ? error.message : fallback;
  }

  const { details } = error;

  if (Array.isArray(details)) {
    const parts = details
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          const { path, message } = item as { path?: unknown; message?: unknown };
          if (typeof message === "string") {
            return typeof path === "string" && path ? `${path}: ${message}` : message;
          }
        }
        return null;
      })
      .filter((part): part is string => Boolean(part));

    if (parts.length > 0) return parts.join(" · ");
  }

  if (typeof details === "string" && details) return details;

  return error.message || fallback;
}

/**
 * Downloads a protected file without ever putting the token in a URL.
 *
 * A plain `<a href={apiUrl}>` cannot carry an Authorization header — a browser navigation
 * simply does not send one — so the report download links landed on the backend's raw
 * `{"success":false,"message":"Missing Authorization bearer token"}` instead of a file.
 * Fetching with the header and handing the browser an object URL keeps the token in
 * memory, where this app deliberately keeps it, and keeps the user inside the console.
 *
 * The 401-refresh-retry below mirrors `request()`: an export polled to "Ready" can easily
 * outlive a 15-minute access token, which is exactly when a download is attempted.
 */
export async function downloadFile(
  path: string,
  fallbackFilename: string,
  retryOnUnauthorized = true,
): Promise<void> {
  const url = path.startsWith("http") ? path : `${API_BASE_URL}${path}`;

  const response = await reach(url, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    cache: "no-store",
  });

  if (response.status === 401 && retryOnUnauthorized) {
    const refreshed = await refreshSession();
    if (refreshed) return downloadFile(path, fallbackFilename, false);
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(
      response.status,
      body?.message ?? `Download failed with ${response.status}`,
      body?.details,
    );
  }

  // Prefer the server's own filename when it sends one.
  const disposition = response.headers.get("content-disposition") ?? "";
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  const filename = match?.[1] ? decodeURIComponent(match[1]) : fallbackFilename;

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);

  try {
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Revoking immediately can cancel the download in some browsers; one tick is enough.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
  }
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "GET" }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "POST", body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "PATCH", body }),
  delete: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "DELETE" }),
};

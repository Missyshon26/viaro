import type { ApiEnvelope, ApiErrorBody } from "./types";

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000";

/** Thrown for any non-2xx response so callers can branch on status and message. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
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

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, query, retryOnUnauthorized = true, headers, ...init } = options;

  const url = new URL(path.startsWith("http") ? path : `${API_BASE_URL}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url.toString(), {
    ...init,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
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
 * Sends a file as the raw request body (its own Content-Type), for the document upload
 * endpoint — no JSON, no base64. Same bearer token and one-refresh retry as request().
 */
async function uploadRaw<T>(
  path: string,
  file: Blob,
  query: Record<string, string | undefined>,
  retry = true,
): Promise<T> {
  const url = new URL(`${API_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value) url.searchParams.set(key, value);
  }
  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: file,
    cache: "no-store",
  });
  if (response.status === 401 && retry && (await refreshSession())) {
    return uploadRaw<T>(path, file, query, false);
  }
  const payload = (await response.json().catch(() => null)) as ApiEnvelope<T> | ApiErrorBody | null;
  if (!response.ok || !payload || payload.success === false) {
    const err = payload as ApiErrorBody | null;
    throw new ApiError(
      response.status,
      response.status === 413
        ? "That file is too large — the limit is 10 MB."
        : (err?.message ?? `Upload failed with ${response.status}`),
      err?.details,
    );
  }
  return payload.data;
}

/** Fetches a protected file (a stored document) as a Blob, with the bearer token. */
async function fetchBlob(path: string, retry = true): Promise<Blob> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    cache: "no-store",
  });
  if (response.status === 401 && retry && (await refreshSession())) return fetchBlob(path, false);
  if (!response.ok) throw new ApiError(response.status, "Could not open that document");
  return response.blob();
}

export const api = {
  upload: uploadRaw,
  blob: fetchBlob,
  get: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "GET" }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "POST", body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "PATCH", body }),
  delete: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "DELETE" }),
};

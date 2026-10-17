import "server-only";
import { cookies } from "next/headers";
import type { UserRole } from "@/lib/api/types";

/**
 * Token storage.
 *
 * The backend is a stateless Bearer API: it returns an access token (15m) and a
 * refresh token (7d), and expects the refresh token in the *body* of
 * POST /auth/refresh. None of that can be exposed to the browser safely, so both
 * tokens live in httpOnly cookies that only Server Components, Server Actions and
 * Route Handlers can read. No token ever reaches client JavaScript.
 */
export const ACCESS_COOKIE = "viaro_access";
export const REFRESH_COOKIE = "viaro_refresh";
export const ROLE_COOKIE = "viaro_role";

const isProd = process.env.NODE_ENV === "production";

/** Mirrors the backend's JWT_ACCESS_EXPIRES_IN (15m), with a little headroom. */
const ACCESS_MAX_AGE = 60 * 20;
/** Mirrors the backend's REFRESH_TOKEN_TTL (7d, renewed on every refresh). */
const REFRESH_MAX_AGE = 60 * 60 * 24 * 7;

const base = {
  httpOnly: true,
  secure: isProd,
  // Strict: the cookie is never sent on a request started by another site (checklist §4).
  sameSite: "strict" as const,
  path: "/",
};

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  role: UserRole;
}

export async function writeSession({ accessToken, refreshToken, role }: SessionTokens) {
  const jar = await cookies();
  jar.set(ACCESS_COOKIE, accessToken, { ...base, maxAge: ACCESS_MAX_AGE });
  jar.set(REFRESH_COOKIE, refreshToken, { ...base, maxAge: REFRESH_MAX_AGE });
  /**
   * Readable by middleware for routing decisions only. It is NOT a trust boundary —
   * every protected endpoint is authorised by the backend against the signed access
   * token, so forging this cookie changes which page renders, never what data returns.
   */
  jar.set(ROLE_COOKIE, role, { ...base, httpOnly: false, maxAge: REFRESH_MAX_AGE });
}

export async function clearSession() {
  const jar = await cookies();
  for (const name of [ACCESS_COOKIE, REFRESH_COOKIE, ROLE_COOKIE]) {
    jar.set(name, "", { ...base, httpOnly: name !== ROLE_COOKIE, maxAge: 0 });
  }
}

export async function readTokens() {
  const jar = await cookies();
  return {
    accessToken: jar.get(ACCESS_COOKIE)?.value ?? null,
    refreshToken: jar.get(REFRESH_COOKIE)?.value ?? null,
    role: (jar.get(ROLE_COOKIE)?.value as UserRole | undefined) ?? null,
  };
}

export async function isAuthenticated() {
  const { accessToken, refreshToken } = await readTokens();
  return Boolean(accessToken || refreshToken);
}

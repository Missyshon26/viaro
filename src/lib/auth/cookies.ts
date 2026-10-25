import type { NextResponse } from "next/server";

// Local portals share a hostname but use different roles. Keep their sessions separate.
export const REFRESH_COOKIE = process.env.NODE_ENV === "development" ? "abl_admin_refresh" : "abl_refresh";

/** Mirrors the backend's REFRESH_TOKEN_TTL (7d, renewed on every refresh). */
const SEVEN_DAYS_SECONDS = 60 * 60 * 24 * 7;

export function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // Strict: the cookie is never sent on a request started by another site (checklist §4).
    sameSite: "strict" as const,
    path: "/",
    maxAge: SEVEN_DAYS_SECONDS,
  };
}

export function clearRefreshCookie(response: NextResponse) {
  response.cookies.set(REFRESH_COOKIE, "", { ...refreshCookieOptions(), maxAge: 0 });
}

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { API_BASE_URL } from "@/lib/api/client";
import { REFRESH_COOKIE, clearRefreshCookie, refreshCookieOptions } from "@/lib/auth/cookies";

/** Exchanges the httpOnly refresh cookie for a fresh access token. */
export async function POST() {
  const store = await cookies();
  const refreshToken = store.get(REFRESH_COOKIE)?.value;

  if (!refreshToken) {
    return NextResponse.json({ message: "No session" }, { status: 401 });
  }

  const upstream = await fetch(`${API_BASE_URL}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
    cache: "no-store",
  });

  const payload = await upstream.json().catch(() => null);

  if (!upstream.ok || !payload?.success) {
    // Expired or revoked (the backend blacklists it on logout) — drop the cookie
    // so the client stops retrying with a token that will never work again.
    const response = NextResponse.json(
      { message: payload?.message ?? "Session expired" },
      { status: 401 },
    );
    clearRefreshCookie(response);
    return response;
  }

  const response = NextResponse.json({
    accessToken: payload.data.accessToken,
    role: payload.data.role,
  });
  // The backend rotates the refresh token on every use and treats a replay of the old
  // one as theft, revoking every session. Keeping the spent token in the cookie made
  // the very next refresh look like exactly that.
  response.cookies.set(REFRESH_COOKIE, payload.data.refreshToken, refreshCookieOptions());
  return response;
}

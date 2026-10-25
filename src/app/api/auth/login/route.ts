import { NextResponse } from "next/server";
import { API_BASE_URL } from "@/lib/api/client";
import { REFRESH_COOKIE, refreshCookieOptions } from "@/lib/auth/cookies";

/**
 * Login proxy.
 *
 * The browser never sees the refresh token: the backend returns it here, on the
 * server, and we hand back only the short-lived access token while storing the
 * refresh token in an httpOnly cookie. That way an XSS bug cannot walk off with a
 * 30-day credential.
 */
export async function POST(request: Request) {
  const body = await request.json();

  const upstream = await fetch(`${API_BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const payload = await upstream.json().catch(() => null);

  if (!upstream.ok || !payload?.success) {
    return NextResponse.json(
      { message: payload?.message ?? "Login failed" },
      { status: upstream.status || 500 },
    );
  }

  const { accessToken, refreshToken, user, role } = payload.data;

  const response = NextResponse.json({ accessToken, user, role });
  response.cookies.set(REFRESH_COOKIE, refreshToken, refreshCookieOptions());
  return response;
}

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
  const body = (await request.json().catch(() => null)) as { email?: unknown; password?: unknown } | null;

  // Only the two credentials go upstream, and only as strings: nothing else a caller
  // puts in the body is relayed to the API.
  if (typeof body?.email !== "string" || typeof body?.password !== "string") {
    return NextResponse.json({ message: "Enter your email and password" }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${API_BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: body.email, password: body.password }),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ message: "Could not reach the server" }, { status: 503 });
  }

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

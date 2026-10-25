import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { API_BASE_URL } from "@/lib/api/client";
import { REFRESH_COOKIE, clearRefreshCookie } from "@/lib/auth/cookies";

/**
 * Logout. The backend blacklists the refresh token's jti in Redis, so it stays dead
 * even if a copy leaked; we then clear the cookie locally.
 */
export async function POST(request: Request) {
  const store = await cookies();
  const refreshToken = store.get(REFRESH_COOKIE)?.value;
  const accessToken = request.headers.get("authorization");

  if (refreshToken && accessToken) {
    await fetch(`${API_BASE_URL}/auth/logout`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: accessToken },
      body: JSON.stringify({ refreshToken }),
      cache: "no-store",
    }).catch(() => {
      // Never block the user from logging out of this device because the API is down.
    });
  }

  const response = NextResponse.json({ success: true });
  clearRefreshCookie(response);
  return response;
}

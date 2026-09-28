import { NextResponse, type NextRequest } from "next/server";
import type { UserRole } from "@/lib/api/types";

/**
 * Route protection + token refresh.
 *
 * Refreshing here rather than in the API client is deliberate: middleware runs before
 * render and owns the response, so it can write the rotated cookies. A Server
 * Component cannot — calling cookies().set() during render throws — so a refresh
 * attempted there would be silently lost.
 *
 * This is a *routing* guard, not a security boundary. Every endpoint is authorised by
 * the backend against the signed access token; forging the role cookie changes which
 * page renders, never which data comes back.
 */
const ACCESS_COOKIE = "viaro_access";
const REFRESH_COOKIE = "viaro_refresh";
const ROLE_COOKIE = "viaro_role";

/**
 * This site is the PASSENGER product only. Chauffeurs, the platform admin and fleet
 * operators each have their own application, so every signed-in area here is
 * customer-only — a driver or admin who signs in is sent to /portal, which points
 * them at the right one rather than showing them a half-usable customer screen.
 */
const CUSTOMER_ONLY = [
  "/account",
  "/trips",
  "/wallet",
  "/subscription",
  "/support",
  "/notifications",
  "/book",
  "/favorites",
];

/** Not guarded by role, but still private — never indexed. */
const PRIVATE_ONLY = ["/portal", "/verify-phone"];

/** Signed-in users get bounced away from these. */
const AUTH_PAGES = ["/login", "/register", "/forgot-password", "/reset-password"];

/**
 * Where a signed-in user lands when they open a sign-in page. A passenger goes back to
 * the website, not into the account area — "My account" in the navbar is how they get
 * there. Other roles have no home on this site and are sent to /portal.
 */
const homeFor = (role: UserRole | null) => (role === "customer" ? "/" : "/portal");

/**
 * Seconds of headroom before expiry at which a token is already treated as spent.
 *
 * Covers the request still in flight and any clock skew between this process and the
 * API, so a token cannot pass the check here and be rejected there moments later.
 */
const EXPIRY_SKEW_SECONDS = 60;

/**
 * Is this access token still usable?
 *
 * The signature is deliberately NOT checked. Middleware is a routing guard — the API
 * verifies every token against its own secret, and forging one here changes which page
 * renders, never which data comes back. All that is needed is the expiry claim.
 *
 * Presence of the cookie is not enough on its own: the cookie outlived the token it
 * carried, so for the last minutes of its life the browser sent a cookie holding a dead
 * token. Middleware saw "signed in", skipped the refresh, and every API call the page
 * made came back 401 — a signed-in user staring at empty panels for no visible reason.
 */
function isUsable(token: string | null): boolean {
  if (!token) return false;

  try {
    const payload = token.split(".")[1];
    if (!payload) return false;

    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const { exp } = JSON.parse(json) as { exp?: number };

    // No expiry claim: nothing to judge it by, so let the API be the authority.
    if (typeof exp !== "number") return true;

    return exp - EXPIRY_SKEW_SECONDS > Date.now() / 1000;
  } catch {
    // Unparseable — treat as spent so the refresh path runs rather than rendering
    // a page whose every request is going to fail.
    return false;
  }
}

async function refresh(token: string) {
  try {
    const res = await fetch(`${process.env.API_URL ?? "http://localhost:5001"}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: token }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const payload = await res.json();
    return payload?.data ?? null;
  } catch {
    return null;
  }
}

/*
 * Renamed from `middleware` to `proxy` (and middleware.ts -> proxy.ts) for the Next 16
 * file convention; the dev server warned the old one is deprecated. Behaviour is
 * unchanged — same guard, same matcher, same cookie handling.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  let access = request.cookies.get(ACCESS_COOKIE)?.value ?? null;
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value ?? null;
  let role = (request.cookies.get(ROLE_COOKIE)?.value as UserRole | undefined) ?? null;

  const isProd = process.env.NODE_ENV === "production";
  const base = { httpOnly: true, secure: isProd, sameSite: "lax" as const, path: "/" };

  let rotated: Awaited<ReturnType<typeof refresh>> = null;
  let cleared = false;

  // Expired or about to be, and the refresh token is still good — rotate silently.
  if (!isUsable(access) && refreshToken) {
    rotated = await refresh(refreshToken);
    if (rotated) {
      access = rotated.accessToken;
      role = rotated.role;

      /*
       * ⚠ The new token must go onto the REQUEST as well as the response.
       *
       * Setting it only on the response stores it in the browser but leaves this render
       * blind: a Server Component reads cookies() from the incoming request, sees no
       * access token, and getCurrentUser() returns null — so /account rendered a header
       * and footer with nothing between them, and only worked on the *next* navigation
       * once the browser replayed the stored cookie.
       *
       * request.cookies.set() + NextResponse.next({ request }) is the documented way to
       * make the current pass see it.
       */
      request.cookies.set(ACCESS_COOKIE, rotated.accessToken);
      request.cookies.set(REFRESH_COOKIE, rotated.refreshToken);
      request.cookies.set(ROLE_COOKIE, rotated.role);
    } else {
      cleared = true;
      // Refresh token is dead — drop them here too, so the render agrees with the browser.
      request.cookies.delete(ACCESS_COOKIE);
      request.cookies.delete(REFRESH_COOKIE);
      request.cookies.delete(ROLE_COOKIE);
    }
  }

  const response = NextResponse.next({ request: { headers: request.headers } });

  if (rotated) {
    /*
     * Matches JWT_ACCESS_EXPIRES_IN (15m) rather than outliving it. The two used to
     * disagree — a 20-minute cookie holding a 15-minute token — which is what created
     * the dead-token window in the first place. isUsable() above is the real guard;
     * this just stops the browser hoarding a cookie that cannot work.
     */
    response.cookies.set(ACCESS_COOKIE, rotated.accessToken, { ...base, maxAge: 60 * 15 });
    response.cookies.set(REFRESH_COOKIE, rotated.refreshToken, {
      ...base,
      maxAge: 60 * 60 * 24 * 30,
    });
    response.cookies.set(ROLE_COOKIE, rotated.role, {
      ...base,
      httpOnly: false,
      maxAge: 60 * 60 * 24 * 30,
    });
  } else if (cleared) {
    for (const name of [ACCESS_COOKIE, REFRESH_COOKIE, ROLE_COOKIE]) {
      response.cookies.set(name, "", { ...base, httpOnly: name !== ROLE_COOKIE, maxAge: 0 });
    }
  }

  // `access` is the rotated token when a refresh just happened, so this is "we have a
  // token that will still be alive when the page makes its calls".
  const signedIn = isUsable(access);
  const guarded = CUSTOMER_ONLY.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (guarded && !signedIn) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  // Signed in, but not as a passenger: their product is elsewhere.
  if (guarded && signedIn && role && role !== "customer") {
    const url = request.nextUrl.clone();
    url.pathname = "/portal";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (signedIn && AUTH_PAGES.includes(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = homeFor(role);
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Account pages, and the auth screens around them, have nothing a search engine
  // should index or follow. The header covers every response on these paths, including
  // ones a crawler reaches without the metadata of a rendered page.
  if (guarded || PRIVATE_ONLY.some((p) => pathname === p || pathname.startsWith(`${p}/`)) || AUTH_PAGES.includes(pathname)) {
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
  }

  return response;
}

export const config = {
  matcher: [
    /**
     * Everything except static assets and image files. Auth pages are included so a
     * signed-in user gets redirected away from them, and public marketing pages pass
     * through untouched — they still hit middleware so an expiring token refreshes
     * while the visitor browses.
     */
    "/((?!_next/static|_next/image|favicon.ico|images|Demo_Fonts|.*\.(?:png|jpg|jpeg|gif|svg|webp|ico|otf|ttf|woff|woff2)$).*)",
  ],
};

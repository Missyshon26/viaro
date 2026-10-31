import type { NextConfig } from "next";

/**
 * Security headers on every response (pre-deployment checklist §5). Clickjacking:
 * SAMEORIGIN keeps the console out of anyone else's frame. nosniff stops a browser
 * guessing a file is script. The X-Powered-By banner is dropped so the response does
 * not advertise the framework.
 */
const isProd = process.env.NODE_ENV === "production";

/** The API the console talks to straight from the browser (and its live-update stream). */
const apiOrigin = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_API_URL ?? "").origin;
  } catch {
    return "";
  }
})();

/**
 * Content-Security-Policy: the console loads code and styles from itself only, and may talk to
 * itself and the API. Pictures may come from any https address (the API serves the uploaded
 * ones) or be inline (data:/blob:). Inline scripts and styles are allowed because Next.js
 * writes its own into every page; 'unsafe-eval' is added in development only.
 */
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' ${apiOrigin} https://*.allblacklimoseattle.com${isProd ? "" : " http://localhost:* ws://localhost:*"}`.trim(),
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Content-Security-Policy", value: CSP },
  // Browsers that have seen this over https keep using https for a year. (No includeSubDomains:
  // other hosts under this domain are not ours to decide for.)
  ...(isProd ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }] : []),
];

const nextConfig: NextConfig = {
  // A self-contained server (`node server.js`) with only the files it needs, so a release
  // is a small upload instead of the whole node_modules tree.
  output: "standalone",
  poweredByHeader: false,
  async rewrites() {
    if (process.env.NODE_ENV !== "development" || process.env.NEXT_PUBLIC_DEV_API_PROXY !== "1") return [];
    const upstream = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000";
    return [{ source: "/backend/:path*", destination: `${upstream}/:path*` }];
  },
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      /*
       * The pages are signed-in screens: nothing for a CDN or a shared cache to keep. Next marks
       * pages it could prerender "s-maxage=31536000" (a year), and Cloudflare obeys it — so a
       * deploy, or a change of who is signed in, stayed hidden behind a stale copy. Files under
       * /_next/static keep their own long cache, which is safe because their names change.
       */
      {
        source: "/((?!_next/static|_next/image|.*\\..*).*)",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
    ];
  },
  /**
   * Next's dev-mode build-activity badge defaults to the bottom-left corner, which is
   * exactly where the collapsed sidebar rail puts its own expand/collapse button. The
   * badge sits on top and swallows the click, so "Expand the sidebar" did nothing in dev
   * until the page was scrolled or the badge dismissed. Production builds never render
   * the badge, so this only affects developers — which is precisely who it blocks.
   */
  devIndicators: {
    position: "bottom-right",
  },
};

export default nextConfig;

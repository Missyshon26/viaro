import type { NextConfig } from "next";

/**
 * Security headers on every response (pre-deployment checklist §5). Clickjacking:
 * SAMEORIGIN keeps the console out of anyone else's frame. nosniff stops a browser
 * guessing a file is script. The X-Powered-By banner is dropped so the response does
 * not advertise the framework.
 */
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
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

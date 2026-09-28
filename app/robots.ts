import type { MetadataRoute } from "next";

/**
 * Crawlers get the brochure site only. The account area also sends
 * `X-Robots-Tag: noindex, nofollow` (see proxy.ts), which covers a page that is linked
 * from elsewhere — robots.txt alone only stops crawling, not indexing.
 */
const PRIVATE = [
  "/account",
  "/trips",
  "/wallet",
  "/subscription",
  "/support",
  "/notifications",
  "/favorites",
  "/book",
  "/portal",
  "/verify-phone",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/api/",
];

export default function robots(): MetadataRoute.Robots {
  const site = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: PRIVATE }],
    ...(site ? { host: site } : {}),
  };
}

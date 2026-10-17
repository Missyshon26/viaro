/**
 * Security headers on every response (pre-deployment checklist §5). Clickjacking:
 * SAMEORIGIN keeps the booking pages out of anyone else's frame. nosniff stops a browser
 * guessing a file is script. The X-Powered-By banner is dropped so the response does not
 * advertise the framework.
 */
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  async rewrites() {
    return [
      {
        source: "/service-area/long-beach",
        destination: "/service-area/los-angeles-lax",
      },
      {
        source: "/service-area/orange-county",
        destination: "/service-area/los-angeles-lax",
      },
      {
        source: "/service-area/oakland",
        destination: "/service-area/san-francisco-sfo",
      },
    ];
  },
};

export default nextConfig;
"use client";

import { usePathname } from "next/navigation";
import { AppShell } from "@/components/app/app-shell";

/**
 * Chooses the frame around a page: the marketing site (navbar, footer, quote bubble) or,
 * for the signed-in product, the AppShell.
 *
 * Decided by path, not by who is looking — a signed-in customer browsing the fleet page
 * is still on the brochure site and should see it that way.
 */
export const APP_ROUTES = [
  "/account",
  "/trips",
  "/wallet",
  "/subscription",
  "/support",
  "/notifications",
  "/favorites",
  "/book",
  "/verify-phone",
];

export const isAppRoute = (pathname: string) =>
  APP_ROUTES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

export function SiteChrome({
  signedIn,
  userName,
  navbar,
  footer,
  marketingExtras,
  children,
}: {
  signedIn: boolean;
  userName?: string | null;
  navbar: React.ReactNode;
  footer: React.ReactNode;
  /** The floating quote button — brochure pages only. */
  marketingExtras?: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  if (signedIn && isAppRoute(pathname)) {
    return <AppShell userName={userName}>{children}</AppShell>;
  }

  return (
    <>
      {navbar}
      {children}
      {marketingExtras}
      {footer}
    </>
  );
}

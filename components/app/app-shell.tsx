"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeft,
  Bell,
  Home,
  CalendarClock,
  CircleUserRound,
  Crown,
  LifeBuoy,
  LogOut,
  Menu,
  Plus,
  Star,
  Wallet,
  X,
} from "lucide-react";
import { Toaster } from "sonner";
import { BrandLogo } from "@/components/brand-logo";
import { logoutAction } from "@/lib/actions/auth";
import { cn } from "@/lib/utils";

/**
 * The signed-in product's frame: a minimal header and a sidebar, instead of the marketing
 * navbar and footer.
 *
 * The account used to live inside the brochure site — a five-link marketing nav with a
 * phone number on top, a Get Quote bubble, a footer of service pages — with the actual
 * account sections as a tab row half-way down each page. Here the sections ARE the
 * navigation, and "Book a ride" stays in the header on every screen.
 *
 * Order per product feedback: journeys and money first, settings (Profile) last.
 */
const NAV = [
  { href: "/trips", label: "Trips", icon: CalendarClock },
  { href: "/wallet", label: "Wallet", icon: Wallet },
  { href: "/subscription", label: "Plan", icon: Crown },
  { href: "/favorites", label: "Chauffeurs", icon: Star },
  { href: "/support", label: "Support", icon: LifeBuoy },
  { href: "/account", label: "Profile", icon: CircleUserRound },
] as const;

const isActive = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(`${href}/`);

export function AppShell({
  userName,
  children,
}: {
  userName?: string | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, startSignOut] = useTransition();
  const onBook = pathname === "/book";

  // A tap on a link inside the drawer navigates; the drawer should not stay open over
  // the page it just opened.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- closing on route change
    setMenuOpen(false);
  }, [pathname]);

  const navList = (
    <ul className="space-y-1">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <li key={href}>
            <Link
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-[0.95rem] font-medium transition-colors",
                active
                  ? "bg-midnight/25 text-cloud"
                  : "text-muted-foreground hover:bg-white/[0.04] hover:text-cloud",
              )}
            >
              <Icon className={cn("h-[18px] w-[18px]", active ? "text-azure" : "")} />
              {label}
              {active ? <span aria-hidden className="ml-auto h-5 w-0.5 rounded-full bg-azure" /> : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );

  const backToSite = (
    <Link
      href="/"
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[0.95rem] text-muted-foreground transition-colors hover:bg-white/[0.04] hover:text-cloud"
    >
      <Home className="h-[18px] w-[18px]" />
      Back to website
    </Link>
  );

  const signOut = (
    <button
      type="button"
      onClick={() => startSignOut(() => void logoutAction())}
      disabled={signingOut}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[0.95rem] text-muted-foreground transition-colors hover:bg-white/[0.04] hover:text-cloud disabled:opacity-60"
    >
      <LogOut className="h-[18px] w-[18px]" />
      {signingOut ? "Signing out…" : "Sign out"}
    </button>
  );

  return (
    <div data-app-shell className="min-h-screen bg-background text-foreground">
      {/* ── Header ── */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur-md">
        <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            className="-ml-1 flex h-10 w-10 items-center justify-center rounded-lg text-cloud hover:bg-white/5 lg:hidden"
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>

          {/* The logo leads back to the website, as it does everywhere else. */}
          <Link href="/" aria-label="Viaro home" className="flex items-center">
            <BrandLogo height={30} />
          </Link>

          <Link
            href="/"
            className="ml-2 hidden items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-white/5 hover:text-cloud sm:inline-flex"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to website
          </Link>

          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <Link
              href="/notifications"
              aria-label="Notifications"
              className={cn(
                "flex h-10 w-10 items-center justify-center rounded-lg transition-colors hover:bg-white/5",
                isActive(pathname, "/notifications") ? "text-azure" : "text-muted-foreground hover:text-cloud",
              )}
            >
              <Bell className="h-5 w-5" />
            </Link>

            {userName ? (
              <span className="hidden max-w-[12rem] truncate px-2 text-sm text-muted-foreground md:inline">
                {userName}
              </span>
            ) : null}

            {/* Persistent: the one thing someone in their account most often came to do. */}
            {!onBook ? (
              <Link
                href="/book"
                className="inline-flex h-10 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-brand2"
              >
                <Plus className="h-4 w-4" />
                <span>Book a ride</span>
              </Link>
            ) : null}
          </div>
        </div>
      </header>

      <div className="flex">
        {/* ── Sidebar (desktop) ── */}
        <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-60 shrink-0 flex-col border-r border-border px-3 py-6 lg:flex">
          <nav aria-label="Account">{navList}</nav>
          <div className="mt-auto space-y-1 border-t border-border pt-4">
            {backToSite}
            {signOut}
          </div>
        </aside>

        {/* ── Drawer (mobile) ── */}
        {menuOpen ? (
          <div className="fixed inset-0 top-16 z-30 lg:hidden">
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setMenuOpen(false)}
              className="absolute inset-0 bg-black/60"
            />
            <div className="relative flex h-full w-72 max-w-[85vw] flex-col border-r border-border bg-background px-3 py-5">
              {userName ? (
                <p className="mb-4 truncate px-3 text-sm text-muted-foreground">{userName}</p>
              ) : null}
              <nav aria-label="Account">{navList}</nav>
              <div className="mt-auto space-y-1 border-t border-border pt-4">
            {backToSite}
            {signOut}
          </div>
            </div>
          </div>
        ) : null}

        <div className="min-w-0 flex-1">{children}</div>
      </div>

      <Toaster
        theme="dark"
        position="top-center"
        toastOptions={{
          classNames: {
            toast: "!bg-card !text-cloud !border-border font-sans",
            description: "!text-muted-foreground",
          },
        }}
      />
    </div>
  );
}

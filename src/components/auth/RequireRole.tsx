"use client";

import type { ReactNode } from "react";
import { AuthWelcome } from "./AuthWelcome";
import { useAuth } from "@/lib/auth/AuthProvider";
import { Logo } from "@/components/brand/Logo";

/**
 * Role gate for the whole console. Every endpoint behind it is guarded server-side, so
 * this only decides what renders — but signing in with the wrong role would otherwise
 * land on a dashboard where every request 403s, which is worse than saying so.
 */
const ALLOWED = ["admin"];

export function RequireRole({ children }: { children: ReactNode }) {
  const { user, loading, logout } = useAuth();

  if (loading) {
    // Blank on purpose: someone already signed in gets the console itself from the cache
    // straight away, and a text screen here only showed for a moment on every reload.
    return <div className="min-h-dvh bg-bg" aria-busy="true" />;
  }

  if (!user) return <AuthWelcome />;

  if (!ALLOWED.includes(user.role)) {
    const where =
      user.role === "company"
        ? "Fleet operators use the company console."
        : user.role === "driver"
          ? "Drivers use the driver app."
          : "Passengers book and manage rides on the booking site.";
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg px-5 py-12">
        <div className="w-full max-w-md overflow-hidden rounded-card border border-border bg-surface-raised text-center shadow-[var(--shadow-raised)]">
          <div className="bg-panel px-6 pb-7 pt-8">
            <Logo width={72} onDark className="mx-auto" />
            <span
              aria-hidden
              className="mx-auto mt-6 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-fg"
            >
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="11" width="16" height="10" rx="2" />
                <path d="M8 11V7a4 4 0 0 1 8 0v4" />
              </svg>
            </span>
          </div>
          <div className="px-6 pb-7 pt-6">
            <h1 className="text-card font-bold text-fg">Admins only</h1>
            <p className="mt-3 text-note leading-relaxed text-fg-muted">
              This console is for ABL operations staff. {where}
            </p>
            <p className="mt-4 rounded-field bg-surface px-3.5 py-2.5 text-note text-fg-body">
              Signed in as <strong className="text-fg">{user.email ?? user.name}</strong>{" "}
              <span className="capitalize">({user.role})</span>
            </p>
            <button
              type="button"
              onClick={logout}
              className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-field bg-primary px-6 text-action font-bold text-primary-fg transition-opacity hover:opacity-90"
            >
              Sign out and use an admin account
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

"use client";

import type { ReactNode } from "react";
import { AuthWelcome } from "./AuthWelcome";
import { useAuth } from "@/lib/auth/AuthProvider";
import { Card } from "@/components/ui/Surfaces";

/**
 * Role gate for the whole console. Every endpoint behind it is guarded server-side, so
 * this only decides what renders — but signing in with the wrong role would otherwise
 * land on a dashboard where every request 403s, which is worse than saying so.
 */
const ALLOWED = ["admin"];

export function RequireRole({ children }: { children: ReactNode }) {
  const { user, loading, logout } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <p className="text-note text-fg-muted">Checking your session…</p>
      </div>
    );
  }

  if (!user) return <AuthWelcome />;

  if (!ALLOWED.includes(user.role)) {
    return (
      <div className="flex min-h-dvh items-center justify-center px-5 py-12">
        <Card className="w-full max-w-[26rem] p-6 text-center">
          <h1 className="text-card font-bold text-fg">This console is for the platform admin</h1>
          <p className="mt-3 text-note leading-relaxed text-fg-muted">
            You are signed in as a {user.role}. Fleet operators use the company
            console; chauffeurs use the driver portal.
          </p>
          <button
            type="button"
            onClick={logout}
            className="mt-5 text-note font-bold text-accent hover:opacity-80"
          >
            Sign out
          </button>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Shared furniture for the signed-in app screens, built on the same brand tokens the
 * marketing pages use (Executive Black, Midnight Route, Azure Drive, Cloud Leather) so
 * the two halves of the site read as one product.
 */

export function PageShell({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <main className="min-h-[70vh] bg-background">
      {/*
       * Under the marketing navbar (fixed, 5rem) the title needs clearing with pt-28;
       * inside the AppShell the header is in flow, so only normal spacing is needed.
       */}
      <div
        className={cn(
          "mx-auto max-w-6xl px-4 pb-12 pt-28 sm:px-6 sm:pb-16 sm:pt-32",
          "[[data-app-shell]_&]:pt-6 sm:[[data-app-shell]_&]:pt-10 lg:[[data-app-shell]_&]:px-10",
          className,
        )}
      >
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <div>
            <h1 className="font-sans text-[1.75rem] font-semibold leading-tight tracking-tight text-foreground sm:text-4xl">
              {title}
            </h1>
            {description ? (
              <p className="mt-2 max-w-2xl text-[0.95rem] leading-relaxed text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          {action ? <div className="sm:ml-auto sm:shrink-0">{action}</div> : null}
        </header>

        <div className="mt-8">{children}</div>
      </div>
    </main>
  );
}

export function Panel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card/60 p-6 backdrop-blur-sm",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-brand">
      {children}
    </h2>
  );
}

/** Consistent empty state so every list degrades the same way. */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/30 px-6 py-14 text-center">
      <p className="font-sans text-lg font-semibold text-foreground">{title}</p>
      {description ? (
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground"
    >
      {children}
    </p>
  );
}

export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label
        htmlFor={htmlFor}
        className="block text-xs font-medium uppercase tracking-wider text-muted-foreground"
      >
        {label}
      </label>
      {children}
      {hint && !error ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

const MONEY = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
export const money = (amount: number | undefined | null) =>
  typeof amount === "number" ? MONEY.format(amount) : "—";

/**
 * "Fri, Sep 25 · 9:45 PM" — the year only when it is not this one.
 *
 * Always in Pacific time, the zone every pickup is scheduled in (the API's
 * `scheduledAtLocal` is "2026-09-25 21:45 PDT", which is what the lists used to print
 * verbatim). Pinning the zone also keeps the server render and the browser in agreement.
 */
const RIDE_ZONE = "America/Los_Angeles";

export function formatDateTime(value?: string | null, { zone = true }: { zone?: boolean } = {}) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  const thisYear = new Date().toLocaleString("en-US", { timeZone: RIDE_ZONE, year: "numeric" });
  const itsYear = date.toLocaleString("en-US", { timeZone: RIDE_ZONE, year: "numeric" });

  const day = date.toLocaleDateString("en-US", {
    timeZone: RIDE_ZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(itsYear !== thisYear ? { year: "numeric" } : {}),
  });
  const time = date.toLocaleTimeString("en-US", {
    timeZone: RIDE_ZONE,
    hour: "numeric",
    minute: "2-digit",
  });
  return `${day} · ${time}${zone ? " PT" : ""}`;
}

/** "Sep 25, 2026" — for statements and records where the time does not matter. */
export function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", {
    timeZone: RIDE_ZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * The short form of an address for a list: the first part ("Seattle-Tacoma International
 * Airport") without the street, city and country that follow. The full string stays in
 * the trip's detail view and in the row's tooltip.
 */
export function shortAddress(address?: string | null) {
  if (!address) return "—";
  const first = address.split(",")[0]?.trim() ?? address;
  // A bare house number ("1600") is not a place name — keep the street with it.
  if (/^\d+[a-z]?$/i.test(first)) return address.split(",").slice(0, 2).join(",").trim();
  return first.length > 42 ? `${first.slice(0, 40).trimEnd()}…` : first;
}

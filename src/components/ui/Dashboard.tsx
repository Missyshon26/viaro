import Link from "next/link";
import type { ReactNode } from "react";
import { IconTrendDown, IconTrendUp } from "@/components/ui/Icons";

/**
 * Dashboard primitives shared by the three consoles.
 *
 * These are deliberately small and unopinionated about data: every one takes already
 * formatted values, so the page decides what a number means and this file only decides
 * how it looks. That keeps the same StatCard usable for a count, a currency total and
 * a rating without growing a `kind` prop.
 */

/* --------------------------------- stat card ------------------------------- */

export function StatCard({
  label,
  value,
  hint,
  icon,
  href,
  trend,
  tone = "default",
  loading,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  href?: string;
  /** Only pass this when a real comparison exists — never a decorative number. */
  trend?: { direction: "up" | "down"; label: string; good?: boolean };
  /** `feature` promotes the card for the one or two metrics that matter most. */
  tone?: "default" | "feature";
  loading?: boolean;
}) {
  const featured = tone === "feature";

  const body = (
    <>
      <div className="flex items-start gap-3">
        {icon ? (
          <span
            aria-hidden
            className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-field ${
              featured ? "bg-white/10 text-panel-fg" : "bg-accent-soft text-accent-strong"
            }`}
          >
            {icon}
          </span>
        ) : null}
        <p
          className={`min-w-0 pt-1.5 text-label font-bold uppercase tracking-wider ${
            featured ? "text-panel-muted" : "text-fg-muted"
          }`}
        >
          {label}
        </p>
      </div>

      {loading ? (
        <div className="mt-4 h-8 w-24 animate-pulse rounded bg-surface" aria-hidden />
      ) : (
        <p
          className={`metric-value mt-4 text-[2rem] font-bold leading-none tracking-tight ${
            featured ? "text-panel-fg" : "text-fg"
          }`}
        >
          {value}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        {trend ? (
          <span
            className={`inline-flex items-center gap-1 text-label font-bold ${
              (trend.good ?? trend.direction === "up")
                ? "text-chart-good"
                : "text-chart-bad"
            }`}
          >
            {trend.direction === "up" ? (
              <IconTrendUp size={13} />
            ) : (
              <IconTrendDown size={13} />
            )}
            {trend.label}
          </span>
        ) : null}
        {hint ? (
          <span className={`text-note ${featured ? "text-panel-muted" : "text-fg-muted"}`}>
            {hint}
          </span>
        ) : null}
      </div>
    </>
  );

  const shell = `metric-card rounded-card border p-6 shadow-[var(--shadow-card)] transition-all ${
    featured
      ? "border-transparent bg-panel"
      : "border-border bg-surface-raised"
  } ${href ? "hover:border-accent/40 hover:shadow-[var(--shadow-raised)]" : ""}`;

  if (href) {
    return (
      <Link href={href} className={`block ${shell}`}>
        {body}
      </Link>
    );
  }
  return <div className={shell}>{body}</div>;
}

/* -------------------------------- status badge ----------------------------- */

export type BadgeTone = "neutral" | "good" | "info" | "warn" | "bad";

const TONE_CLASS: Record<BadgeTone, string> = {
  neutral: "bg-surface text-fg-muted ring-border",
  good: "bg-chart-good/10 text-chart-good ring-chart-good/25",
  info: "bg-accent-soft text-accent-strong ring-accent/20",
  warn: "bg-chart-warn/10 text-chart-warn ring-chart-warn/25",
  bad: "bg-chart-bad/10 text-chart-bad ring-chart-bad/25",
};

/**
 * Every status word in the product maps to a tone here, in one place, so "completed"
 * is the same green in the admin trips table and the driver's history.
 */
const STATUS_TONE: Record<string, BadgeTone> = {
  // driver
  available: "good",
  online: "good",
  busy: "warn",
  offline: "neutral",
  suspended: "bad",
  // user
  active: "good",
  pending_documents: "warn",
  // booking
  pending: "warn",
  dispatched: "info",
  assigned: "info",
  // trip
  accepted: "info",
  started: "info",
  in_progress: "info",
  completed: "good",
  cancelled: "bad",
  // support
  open: "warn",
  resolved: "good",
  closed: "neutral",
};

const STATUS_LABEL: Record<string, string> = {
  available: "Online",
  pending_documents: "Documents pending",
  point2point: "Point to point",
  in_progress: "In progress",
};

export function StatusBadge({
  status,
  tone,
  children,
}: {
  status?: string;
  tone?: BadgeTone;
  children?: ReactNode;
}) {
  const key = (status ?? "").toLowerCase();
  const resolved = tone ?? STATUS_TONE[key] ?? "neutral";
  const text =
    children ??
    STATUS_LABEL[key] ??
    (status ? status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, " ") : "—");

  return (
    <span
      className={`inline-flex shrink-0 whitespace-nowrap items-center gap-1.5 rounded-full px-2.5 py-1 text-label font-bold ring-1 ring-inset ${TONE_CLASS[resolved]}`}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
      {text}
    </span>
  );
}

/* ----------------------------------- avatar -------------------------------- */

export const initialsOf = (name?: string | null) =>
  (name ?? "")
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase() || "—";

export function Avatar({
  name,
  size = 32,
  tone = "soft",
}: {
  name?: string | null;
  size?: number;
  tone?: "soft" | "solid";
}) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold ${
        tone === "solid"
          ? "bg-primary text-primary-fg"
          : "bg-accent-soft text-accent-strong"
      }`}
    >
      {initialsOf(name)}
    </span>
  );
}

/** Avatar + name + secondary line, the identity cell used in every table. */
export function PersonCell({
  name,
  meta,
  href,
}: {
  name: string;
  meta?: ReactNode;
  href?: string;
}) {
  const inner = (
    <span className="flex min-w-0 items-center gap-2.5">
      <Avatar name={name} />
      <span className="min-w-0">
        <span className="block truncate font-bold text-fg">{name}</span>
        {meta ? (
          <span className="block truncate text-label text-fg-muted">{meta}</span>
        ) : null}
      </span>
    </span>
  );
  return href ? (
    <Link href={href} className="hover:text-accent">
      {inner}
    </Link>
  ) : (
    inner
  );
}

/* ------------------------------- empty / error ----------------------------- */

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      {icon ? (
        <span
          aria-hidden
          className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-full bg-surface text-fg-muted"
        >
          {icon}
        </span>
      ) : null}
      <p className="text-card font-bold text-fg">{title}</p>
      {description ? (
        <p className="mx-auto mt-2 max-w-sm text-note leading-relaxed text-fg-muted">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/**
 * Shown where a section is real and wanted but the API cannot answer it yet. It is
 * deliberately distinct from EmptyState: "there is no data" and "there is no endpoint"
 * are different facts and must not look the same to whoever is reading the dashboard.
 */
export function NotAvailable({ title, reason }: { title: string; reason: string }) {
  return (
    <div className="rounded-field border border-dashed border-border px-5 py-8 text-center">
      <p className="text-note font-bold text-fg">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-note leading-relaxed text-fg-muted">
        {reason}
      </p>
    </div>
  );
}

/* --------------------------------- skeletons ------------------------------- */

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded bg-surface ${className}`} />;
}

export function StatCardSkeleton() {
  return (
    <div className="rounded-card border border-border bg-surface-raised p-5">
      <div className="flex items-center gap-3">
        <Skeleton className="h-9 w-9 rounded-field" />
        <Skeleton className="h-3 w-20" />
      </div>
      <Skeleton className="mt-4 h-8 w-24" />
      <Skeleton className="mt-3 h-3 w-28" />
    </div>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="divide-y divide-border-subtle">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-5 py-3.5">
          <Skeleton className="h-8 w-8 rounded-full" />
          <Skeleton className="h-3 w-1/4" />
          <Skeleton className="ml-auto h-3 w-16" />
        </div>
      ))}
    </div>
  );
}

/* --------------------------------- section --------------------------------- */

/** A plain card with a heading — for tables and lists that are not charts. */
export function SectionCard({
  title,
  subtitle,
  action,
  children,
  bodyClassName = "",
  className = "",
}: {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  bodyClassName?: string;
  className?: string;
}) {
  return (
    <section
      className={`overflow-hidden rounded-card border border-border bg-surface-raised shadow-[var(--shadow-card)] ${className}`}
    >
      <div className="flex flex-wrap items-start gap-3 px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-action font-bold tracking-tight text-fg">{title}</h2>
          {subtitle ? <p className="mt-1 text-note text-fg-muted">{subtitle}</p> : null}
        </div>
        {action ? <div className="ml-auto shrink-0">{action}</div> : null}
      </div>
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

/* ---------------------------------- format --------------------------------- */

export const money = (amount: number | undefined | null) =>
  typeof amount === "number"
    ? amount.toLocaleString("en-US", { style: "currency", currency: "USD" })
    : "—";

export const compactMoney = (amount: number | undefined | null) =>
  typeof amount === "number"
    ? amount.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        notation: amount >= 10_000 ? "compact" : "standard",
        maximumFractionDigits: amount >= 10_000 ? 1 : 2,
      })
    : "—";

export const count = (n: number | undefined | null) =>
  typeof n === "number" ? n.toLocaleString("en-US") : "—";

export const reference = (id?: string | null) =>
  id ? `ABL-${id.slice(-6).toUpperCase()}` : "—";

/** A failed request is not an empty dataset. Keep the recovery action in context. */
export function LoadError({ onRetry, title = "We couldn’t load this overview" }: { onRetry: () => void; title?: string }) {
  return <section role="alert" className="rounded-card border border-danger/25 bg-surface-raised p-6 sm:p-8">
    <p className="text-card font-bold text-fg">{title}</p>
    <p className="mt-2 max-w-xl text-body leading-relaxed text-fg-muted">Some information is unavailable right now. Try again to see the latest figures.</p>
    <button type="button" onClick={onRetry} className="mt-5 inline-flex min-h-11 items-center rounded-field bg-primary px-5 text-action font-bold text-primary-fg">Try again</button>
  </section>;
}

export function NextSteps({ items }: { items: { title: string; description: string; href: string; urgent?: boolean }[] }) {
  return <section aria-label="Your next steps" className="mb-6 rounded-card border border-border bg-surface-raised p-5">
    <h2 className="mb-4 text-action font-bold text-fg">Your next steps</h2>
    <div className="grid gap-3 md:grid-cols-3">{items.map((item) => <Link key={item.href} href={item.href} className="group flex min-w-0 items-start gap-3 rounded-field border border-border-subtle bg-surface/50 p-4 transition-colors hover:border-accent/40 hover:bg-accent-soft">
      <div className="min-w-0 flex-1"><p className={`text-meta font-bold ${item.urgent ? "text-danger" : "text-fg"}`}>{item.title}</p><p className="mt-1 hidden text-note leading-relaxed text-fg-muted sm:block">{item.description}</p></div><span aria-hidden className="text-accent">↗</span>
    </Link>)}</div>
  </section>;
}

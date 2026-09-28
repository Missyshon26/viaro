import { cn } from "@/lib/utils";
import { RIDE_STATUS_LABEL, type RideStatusKey } from "@/lib/ride-status";

/**
 * Status pill with a colour that means something.
 *
 * Every status used to render as the same grey Badge, so "Cancelled" and "Chauffeur
 * assigned" looked identical at a glance. Tones are semantic, and quiet — tinted fill,
 * brighter text, thin border — so they sit on the black UI without shouting:
 *   info     (Azure Drive)     in motion, nothing needed from you
 *   brand    (Midnight Route)  a person is attached to it
 *   success  (green)           done
 *   warning  (amber)           waiting on someone / money coming back
 *   danger   (red)             stopped
 *   neutral  (grey)            archived
 */
export type StatusTone = "info" | "brand" | "success" | "warning" | "danger" | "neutral";

const TONE: Record<StatusTone, string> = {
  info: "border-azure/40 bg-azure/10 text-azure",
  brand: "border-midnight/60 bg-midnight/20 text-cloud",
  success: "border-emerald-500/35 bg-emerald-500/10 text-emerald-300",
  warning: "border-amber-400/35 bg-amber-400/10 text-amber-200",
  danger: "border-red-500/35 bg-red-500/10 text-red-300",
  neutral: "border-border bg-secondary text-muted-foreground",
};

const DOT: Record<StatusTone, string> = {
  info: "bg-azure",
  brand: "bg-cloud",
  success: "bg-emerald-400",
  warning: "bg-amber-300",
  danger: "bg-red-400",
  neutral: "bg-muted-foreground",
};

export function StatusBadge({
  tone,
  children,
  className,
  pulse,
}: {
  tone: StatusTone;
  children: React.ReactNode;
  className?: string;
  /** For live states (a ride in progress). */
  pulse?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-xs font-medium",
        TONE[tone],
        className,
      )}
    >
      <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", DOT[tone], pulse && "animate-pulse")} />
      {children}
    </span>
  );
}

const RIDE_TONE: Record<RideStatusKey, StatusTone> = {
  confirmed: "info",
  assigned: "brand",
  in_progress: "info",
  completed: "success",
  cancelled: "danger",
  refunded: "warning",
};

export function RideStatusBadge({ status, className }: { status: RideStatusKey; className?: string }) {
  return (
    <StatusBadge tone={RIDE_TONE[status]} pulse={status === "in_progress"} className={className}>
      {RIDE_STATUS_LABEL[status]}
    </StatusBadge>
  );
}

/** Support case status. "Pending" on a ticket means support replied and awaits you. */
const TICKET: Record<string, { label: string; tone: StatusTone }> = {
  open: { label: "Open", tone: "warning" },
  pending: { label: "Awaiting your reply", tone: "info" },
  resolved: { label: "Resolved", tone: "success" },
  closed: { label: "Closed", tone: "neutral" },
};

export function TicketStatusBadge({ status }: { status: string }) {
  const entry = TICKET[status] ?? { label: status, tone: "neutral" as const };
  return <StatusBadge tone={entry.tone}>{entry.label}</StatusBadge>;
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Card, Kicker, WarnBox } from "@/components/ui/Surfaces";
import { ConsolePage, formatDateTime } from "@/components/ui/DataTable";
import { listPenalties, type PenaltiesReport } from "@/lib/api/admin";
import { ApiError } from "@/lib/api/client";

/**
 * Penalties, by chauffeur.
 *
 * This page used to be "Penalties and cancellations": two unrelated things on one screen,
 * with penalties reduced to a count per driver. A penalty is something a specific
 * chauffeur did (let a ride alert time out), so each one is listed under the chauffeur
 * who incurred it, with when it happened and on which booking. Cancellations have their
 * own page.
 */
export default function PenaltiesPage() {
  const [report, setReport] = useState<PenaltiesReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listPenalties()
      .then((value) => {
        if (cancelled) return;
        setReport(value);
        // Open the worst offender by default.
        setOpen(value.drivers[0]?.driverId ?? null);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not load penalties");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const drivers = [...(report?.drivers ?? [])].sort((a, b) => b.penaltyCount - a.penaltyCount);

  return (
    <ConsolePage
      title="Penalties"
      description="Each penalty, under the chauffeur who incurred it."
      action={
        <Link href="/cancellations" className="text-note font-bold text-accent hover:underline">
          Cancellations →
        </Link>
      }
    >
      {error ? <p className="mb-4 text-note font-bold text-danger">{error}</p> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="p-5">
          <Kicker>Penalties</Kicker>
          <p className="mt-3 text-[1.75rem] font-bold tracking-tight text-fg">{report?.totalEvents ?? "—"}</p>
        </Card>
        <Card className="p-5">
          <Kicker>Chauffeurs with a penalty</Kicker>
          <p className="mt-3 text-[1.75rem] font-bold tracking-tight text-fg">{report?.totalDrivers ?? "—"}</p>
        </Card>
      </div>

      <div className="mt-6 space-y-3">
        <Kicker>By chauffeur</Kicker>
        {report && drivers.length === 0 ? (
          <Card className="p-6 text-note text-fg-muted">Nobody on your roster has a penalty.</Card>
        ) : null}

        {drivers.map((driver) => {
          const expanded = open === driver.driverId;
          const events = [...driver.events].sort(
            (a, b) => new Date(b.at ?? 0).getTime() - new Date(a.at ?? 0).getTime(),
          );
          return (
            <Card key={driver.driverId} className="p-0">
              <button
                type="button"
                onClick={() => setOpen(expanded ? null : driver.driverId)}
                aria-expanded={expanded}
                className="flex w-full flex-wrap items-center gap-3 px-5 py-4 text-left"
              >
                <span aria-hidden className={`text-fg-muted transition-transform ${expanded ? "rotate-90" : ""}`}>
                  ›
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-bold text-fg">{driver.user?.name ?? "Chauffeur"}</span>
                  <span className="block text-note text-fg-muted">
                    {[driver.user?.email, driver.user?.phone].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className="text-note capitalize text-fg-muted">{driver.vehicleClass}</span>
                <Badge>{driver.status}</Badge>
                <span className="rounded-full bg-danger/15 px-2.5 py-1 text-label font-bold text-danger">
                  {driver.penaltyCount} {driver.penaltyCount === 1 ? "penalty" : "penalties"}
                </span>
              </button>

              {expanded ? (
                <div className="border-t border-border px-5 py-3">
                  {events.length === 0 ? (
                    <p className="py-2 text-note text-fg-muted">
                      No itemised events on record for these penalties.
                    </p>
                  ) : (
                    <ul className="divide-y divide-border">
                      {events.map((event, index) => (
                        <li key={`${event.bookingId}-${index}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-note">
                          <span className="w-36 shrink-0 text-fg-muted">{formatDateTime(event.at)}</span>
                          <span className="min-w-0 flex-1 text-fg">{readableReason(event.reason)}</span>
                          <span className="text-fg-muted">Booking {event.bookingId.slice(-6).toUpperCase()}</span>
                          <span className="font-bold text-fg">+{event.alertDelayMinutes} min alert delay</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}
            </Card>
          );
        })}
      </div>

      <div className="mt-4">
        <WarnBox title="What a penalty does">
          A chauffeur who does not answer a ride alert within two minutes has their
          subsequent alerts delayed by two minutes. It is visible to you and to the
          platform admin.
        </WarnBox>
      </div>
    </ConsolePage>
  );
}

function readableReason(reason: string) {
  const text = reason.replace(/_/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

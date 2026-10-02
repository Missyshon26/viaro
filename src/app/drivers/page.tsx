"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Card, Kicker, WarnBox } from "@/components/ui/Surfaces";
import { Button } from "@/components/ui/Button";
import { ConsolePage, SearchInput, matchesQuery } from "@/components/ui/DataTable";
import {
  fetchAllPages,
  listDrivers,
  createDriver,
  updateDriver,
  type RosterDriver,
} from "@/lib/api/admin";
import { errorText } from "@/lib/api/client";
import { listVehicleClasses, type VehicleClass } from "@/lib/api/vehicles";
import { formatPhone } from "@/lib/format";

const inputClass =
  "w-full rounded-field border border-border bg-surface-raised px-3 py-2 text-note text-fg outline-none";

const nameOf = (driver: RosterDriver) =>
  driver.userId && typeof driver.userId === "object" ? driver.userId.name : "Chauffeur";

const searchFields = (driver: RosterDriver) => {
  const user = typeof driver.userId === "object" ? driver.userId : null;
  return [nameOf(driver), user?.email, user?.phone, formatPhone(user?.phone), driver.vehicleClass, driver.status];
};

/**
 * The roster.
 *
 * This is the one screen only a company has: `POST /admin/drivers` rejects an admin,
 * so adding a chauffeur to a fleet can only happen here.
 */
export default function CompanyDriversPage() {
  const [drivers, setDrivers] = useState<RosterDriver[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    try {
      // Every page, so the search covers the whole roster and not just the first 100.
      const { items } = await fetchAllPages<RosterDriver>((page, limit) => listDrivers(page, limit));
      setDrivers(items);
      setError(null);
    } catch (err) {
      setError(errorText(err, "Could not load your roster"));
      setDrivers([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = (drivers ?? []).filter((driver) => matchesQuery(query, searchFields(driver)));

  return (
    <ConsolePage
      title="Drivers"
      description="Your roster and what each chauffeur is paid per trip."
    >
      {error ? <p className="mb-4 text-note font-bold text-danger">{error}</p> : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] lg:items-start">
        <div className="space-y-4">
          <Card className="p-0">
            <div className="flex flex-wrap items-center gap-3 px-6 pt-6">
              <Kicker>Roster</Kicker>
              {drivers && drivers.length > 0 ? (
                <div className="flex min-w-0 flex-1 items-center justify-end gap-3">
                  <SearchInput
                    value={query}
                    onChange={setQuery}
                    placeholder="Search name, email, phone or class…"
                  />
                  <p className="shrink-0 text-label text-fg-muted">
                    {shown.length} {shown.length === 1 ? "result" : "results"}
                  </p>
                </div>
              ) : null}
            </div>

            {drivers === null ? (
              <p className="p-6 text-note text-fg-muted">Loading…</p>
            ) : drivers.length === 0 ? (
              <p className="p-6 text-note text-fg-muted">
                No chauffeurs yet. Add your first one to start receiving bookings.
              </p>
            ) : shown.length === 0 ? (
              <p className="p-6 text-note text-fg-muted">No chauffeur matches “{query}”.</p>
            ) : (
              <ul className="mt-4 divide-y divide-border-subtle">
                {shown.map((driver) => (
                  <li key={driver._id} className="px-6 py-5">
                    <div className="flex flex-wrap items-center gap-3">
                      <div>
                        <p className="text-meta font-bold text-fg">{nameOf(driver)}</p>
                        <p className="mt-0.5 text-note text-fg-muted">
                          {driver.vehicleClass}
                          {typeof driver.rating === "number"
                            ? ` · ${driver.rating.toFixed(2)} ★`
                            : ""}
                          {driver.penaltyCount
                            ? ` · ${driver.penaltyCount} penalties`
                            : ""}
                        </p>
                      </div>
                      <span className="ml-auto">
                        <Badge>{driver.status}</Badge>
                      </span>
                    </div>
                    <div className="mt-3">
                      <PayoutForm driver={driver} onDone={load} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <WarnBox title="Payout terms are yours to set">
            A percentage takes that share of your revenue for the trip; a flat amount pays
            the same regardless of the fare. Either way the chauffeur never sees what the
            passenger paid.
          </WarnBox>
        </div>

        <Card className="p-5">
          <Kicker>Add a chauffeur</Kicker>
          <div className="mt-4">
            <NewDriverForm onDone={load} />
          </div>
        </Card>
      </div>
    </ConsolePage>
  );
}

function PayoutForm({ driver, onDone }: { driver: RosterDriver; onDone: () => void }) {
  const [pending, setPending] = useState(false);
  const [state, setState] = useState<{ error?: string; saved?: boolean }>({});

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setPending(true);
        try {
          await updateDriver(driver._id, {
            payout: {
              mode: String(form.get("mode")) as "percentage" | "flat",
              value: Number(form.get("value")),
            },
          });
          setState({ saved: true });
          onDone();
        } catch (err) {
          setState({ error: errorText(err, "Could not save") });
        } finally {
          setPending(false);
        }
      }}
      className="flex flex-wrap items-end gap-3"
    >
      {state.error ? <p className="w-full text-label text-danger">{state.error}</p> : null}

      <label className="w-40">
        <span className="text-label font-bold text-fg-muted">Payout mode</span>
        <select
          name="mode"
          defaultValue={driver.payout?.mode ?? "flat"}
          className={`${inputClass} mt-1`}
        >
          <option value="percentage">Percentage</option>
          <option value="flat">Flat per trip</option>
        </select>
      </label>

      <label className="w-28">
        <span className="text-label font-bold text-fg-muted">Value</span>
        <input
          name="value"
          type="number"
          step="0.01"
          min={0}
          defaultValue={driver.payout?.value ?? 30}
          className={`${inputClass} mt-1`}
        />
      </label>

      <Button type="submit" variant="secondary" block={false} disabled={pending}>
        {pending ? "Saving…" : "Save terms"}
      </Button>
      {state.saved ? <span className="text-note text-success">Saved</span> : null}
    </form>
  );
}

function NewDriverForm({ onDone }: { onDone: () => void }) {
  const [pending, setPending] = useState(false);
  const [state, setState] = useState<{ error?: string; saved?: boolean }>({});
  /**
   * Two modes, both of which the backend has always supported: create a brand-new account
   * (with a temporary password) or link a chauffeur who already has one. The form only
   * ever offered the first, so the second was unreachable and attempting it by email
   * produced a bare 409.
   */
  const [linkExisting, setLinkExisting] = useState(false);
  const [classes, setClasses] = useState<VehicleClass[]>([]);

  // The catalogue is operator-managed, so it is read rather than hardcoded.
  useEffect(() => {
    let cancelled = false;
    listVehicleClasses()
      .then((rows) => {
        if (!cancelled) setClasses(rows);
      })
      .catch(() => {
        // A failed lookup must not block adding a chauffeur; the field falls back below.
        if (!cancelled) setClasses([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setPending(true);
        try {
          const password = String(form.get("password") ?? "");
          await createDriver({
            name: String(form.get("name")).trim(),
            email: String(form.get("email")).trim(),
            phone: String(form.get("phone")).trim(),
            // Omitted entirely when linking — that is what selects the backend's link mode.
            ...(linkExisting || !password ? {} : { password }),
            vehicleClass: String(form.get("vehicleClass")),
          });
          setState({ saved: true });
          (event.target as HTMLFormElement).reset();
          onDone();
        } catch (err) {
          setState({ error: errorText(err, "Could not add") });
        } finally {
          setPending(false);
        }
      }}
      className="space-y-4"
    >
      {state.error ? <p className="text-label text-danger">{state.error}</p> : null}

      <label className="block">
        <span className="text-label font-bold text-fg-muted">Name</span>
        <input name="name" required minLength={2} className={`${inputClass} mt-1`} />
      </label>

      <label className="block">
        <span className="text-label font-bold text-fg-muted">Email</span>
        <input name="email" type="email" required className={`${inputClass} mt-1`} />
      </label>

      <label className="block">
        <span className="text-label font-bold text-fg-muted">Phone</span>
        <input name="phone" type="tel" required className={`${inputClass} mt-1`} />
      </label>

      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={linkExisting}
          onChange={(event) => setLinkExisting(event.target.checked)}
          className="mt-1"
        />
        <span>
          <span className="text-label font-bold text-fg-muted">
            This chauffeur already has a Viaro account
          </span>
          <span className="mt-1 block text-note text-fg-muted">
            Links their existing account to your roster by email instead of creating a new
            one. They keep their current password.
          </span>
        </span>
      </label>

      {linkExisting ? null : (
        <label className="block">
          <span className="text-label font-bold text-fg-muted">Temporary password</span>
          <input
            name="password"
            type="password"
            required
            minLength={8}
            className={`${inputClass} mt-1`}
          />
          <span className="mt-1 block text-note text-fg-muted">
            At least 8 characters. They can change it after signing in.
          </span>
        </label>
      )}

      <label className="block">
        <span className="text-label font-bold text-fg-muted">Vehicle class</span>
        <select name="vehicleClass" defaultValue="sedan" className={`${inputClass} mt-1`}>
          {classes.length > 0 ? (
            classes.map((vehicleClass) => (
              <option key={vehicleClass._id} value={vehicleClass.value}>
                {vehicleClass.label}
              </option>
            ))
          ) : (
            /* Only until the catalogue loads — never the source of truth. */
            <option value="sedan">Sedan</option>
          )}
        </select>
      </label>

      <Button type="submit" variant="accent" disabled={pending}>
        {pending ? "Adding…" : "Add chauffeur"}
      </Button>
      {state.saved ? <p className="text-note text-success">Added to your roster.</p> : null}
    </form>
  );
}

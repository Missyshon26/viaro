"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Card, Kicker, WarnBox } from "@/components/ui/Surfaces";
import { Button } from "@/components/ui/Button";
import { ConsolePage } from "@/components/ui/DataTable";
import { ListSearch, matches } from "@/components/ui/ListSearch";
import {
  listDrivers,
  updateDriver,
  listPenalties,
  getPlatformSettings,
  updatePlatformSettings,
  type RosterDriver,
  type PenaltiesReport,
  type PlatformSettings,
} from "@/lib/api/admin";
import { errorText } from "@/lib/api/client";

const inputClass =
  "w-full rounded-field border border-border bg-surface-raised px-3 py-2 text-note text-fg outline-none";

const nameOf = (driver: RosterDriver) =>
  driver.userId && typeof driver.userId === "object" ? driver.userId.name : "Chauffeur";

/**
 * The platform roster and payout terms.
 *
 * An admin can review every driver and set terms, but **cannot create one** —
 * `POST /admin/drivers` is company-only, so no add form is offered here.
 */
export default function DriversPage() {
  const [drivers, setDrivers] = useState<RosterDriver[] | null>(null);
  const [penalties, setPenalties] = useState<PenaltiesReport | null>(null);
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    try {
      const [list, pen, conf] = await Promise.all([
        listDrivers(),
        listPenalties(),
        getPlatformSettings(),
      ]);
      setDrivers(Array.isArray(list) ? list : (list.items ?? []));
      setPenalties(pen);
      setSettings(conf);
      setError(null);
    } catch (err) {
      setError(errorText(err, "Could not load drivers"));
      setDrivers([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Name, email, phone, vehicle class or status.
  const shown = (drivers ?? []).filter((driver) =>
    matches(query, [
      nameOf(driver),
      typeof driver.userId === "object" ? driver.userId.email : null,
      typeof driver.userId === "object" ? driver.userId.phone : null,
      driver.vehicleClass,
      driver.status,
    ]),
  );

  return (
    <ConsolePage
      title="Drivers"
      description="Every chauffeur on the platform, their standing and what they are paid."
    >
      {error ? <p className="mb-4 text-note font-bold text-danger">{error}</p> : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] lg:items-start">
        <Card className="p-0">
          <div className="space-y-3 px-6 pt-6">
            <Kicker>Roster</Kicker>
            <ListSearch
              value={query}
              onChange={setQuery}
              placeholder="Search name, email, phone, class…"
              count={shown.length}
              total={drivers?.length ?? 0}
            />
          </div>

          {drivers === null ? (
            <p className="p-6 text-note text-fg-muted">Loading…</p>
          ) : drivers.length === 0 ? (
            <p className="p-6 text-note text-fg-muted">
              No chauffeurs yet. They appear here once they register or a company adds
              them.
            </p>
          ) : shown.length === 0 ? (
            <p className="p-6 text-note text-fg-muted">No chauffeur matches &ldquo;{query}&rdquo;.</p>
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
                        {driver.penaltyCount ? ` · ${driver.penaltyCount} penalties` : ""}
                      </p>
                    </div>
                    <span className="ml-auto">
                      <Badge>{driver.status}</Badge>
                    </span>
                  </div>
                  <div className="mt-3">
                    <PayoutForm driver={driver} fallback={settings?.driverPayout} onDone={load} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-4">
          <DefaultPayoutCard settings={settings} onSaved={setSettings} />

          <Card className="p-5">
            <Kicker>Penalties</Kicker>
            <p className="mt-3 text-[1.75rem] font-bold tracking-tight text-fg">
              {penalties?.totalEvents ?? "—"}
            </p>
            <p className="mt-1.5 text-note text-fg-muted">
              across {penalties?.totalDrivers ?? 0} chauffeurs
            </p>

            {penalties && penalties.drivers.length > 0 ? (
              <ul className="mt-4 divide-y divide-border-subtle">
                {penalties.drivers.slice(0, 8).map((row) => (
                  <li key={row.driverId} className="flex gap-3 py-2.5 text-note">
                    <span className="truncate text-fg">{row.user?.name ?? row.driverId}</span>
                    <span className="ml-auto shrink-0 font-bold text-fg-muted">
                      {row.penaltyCount}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>

          <WarnBox title="Admins cannot add a driver">
            Only a company account can create one, through the fleet console. An admin
            reviews and sets terms; a company owns its roster.
          </WarnBox>
        </div>
      </div>
    </ConsolePage>
  );
}

/**
 * Business settings that used to be .env values on the server — default payout,
 * revenue split, withdrawal fee, and the inbox enquiries go to. Saved here, applied from
 * the next request; no redeploy.
 */
function DefaultPayoutCard({
  settings,
  onSaved,
}: {
  settings: PlatformSettings | null;
  onSaved: (next: PlatformSettings) => void;
}) {
  const [pending, setPending] = useState(false);
  const [state, setState] = useState<{ error?: string; saved?: boolean }>({});

  if (!settings) {
    return (
      <Card className="p-5">
        <Kicker>Settings</Kicker>
        <p className="mt-4 text-note text-fg-muted">Loading…</p>
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <Kicker>Settings</Kicker>
      <p className="mt-2 text-note leading-relaxed text-fg-muted">
        Applied from the next trip or request. Rates set on a chauffeur or a company always
        win over these defaults.
      </p>
      <form
        key={settings.updatedAt ?? "initial"}
        className="mt-4 space-y-4"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          setPending(true);
          setState({});
          try {
            onSaved(
              await updatePlatformSettings({
                driverPayout: {
                  mode: String(form.get("mode")) as "percentage" | "flat",
                  value: Number(form.get("value")),
                },
                companyRevenuePct: Number(form.get("companyRevenuePct")),
                withdrawalFeePct: Number(form.get("withdrawalFeePct")),
                supportInboxEmail: String(form.get("supportInboxEmail")).trim(),
              }),
            );
            setState({ saved: true });
          } catch (err) {
            setState({ error: errorText(err, "Could not save the settings") });
          } finally {
            setPending(false);
          }
        }}
      >
        {state.error ? <p className="text-label text-danger">{state.error}</p> : null}

        <fieldset>
          <legend className="text-label font-bold text-fg">Default chauffeur payout</legend>
          <p className="text-note text-fg-muted">For chauffeurs with no rate of their own.</p>
          <div className="mt-2 flex flex-wrap gap-3">
            <select name="mode" defaultValue={settings.driverPayout.mode} className={`${inputClass} w-36`}>
              <option value="percentage">Percentage</option>
              <option value="flat">Flat per trip</option>
            </select>
            <input
              name="value"
              type="number"
              step="0.01"
              min={0}
              required
              defaultValue={settings.driverPayout.value}
              aria-label="Default payout value"
              className={`${inputClass} w-24`}
            />
          </div>
        </fieldset>

        <label className="block">
          <span className="text-label font-bold text-fg">Company share of each fare (%)</span>
          <span className="block text-note text-fg-muted">
            Default for fleet companies; the platform keeps the rest (now{" "}
            {settings.platformRevenuePct}%).
          </span>
          <input
            name="companyRevenuePct"
            type="number"
            min={0}
            max={100}
            step="1"
            required
            defaultValue={settings.companyRevenuePct}
            className={`${inputClass} mt-2 w-24`}
          />
        </label>

        <label className="block">
          <span className="text-label font-bold text-fg">Withdrawal fee (%)</span>
          <span className="block text-note text-fg-muted">
            On withdrawals to a bank only — never on refunds or ride credit.
          </span>
          <input
            name="withdrawalFeePct"
            type="number"
            min={0}
            max={50}
            step="0.5"
            required
            defaultValue={settings.withdrawalFeePct}
            className={`${inputClass} mt-2 w-24`}
          />
        </label>

        <label className="block">
          <span className="text-label font-bold text-fg">Support & enquiries inbox</span>
          <span className="block text-note text-fg-muted">
            Receives quote requests, contact messages and support-case alerts.
          </span>
          <input
            name="supportInboxEmail"
            type="email"
            required
            defaultValue={settings.supportInboxEmail}
            className={`${inputClass} mt-2`}
          />
        </label>

        <div className="flex items-center gap-3">
          <Button type="submit" variant="accent" disabled={pending}>
            {pending ? "Saving…" : "Save settings"}
          </Button>
          {state.saved ? <p className="text-note font-bold text-success">Saved.</p> : null}
        </div>
      </form>
    </Card>
  );
}

function PayoutForm({
  driver,
  fallback,
  onDone,
}: {
  driver: RosterDriver;
  /** The platform default, shown when this chauffeur has no rate of their own. */
  fallback?: { mode: "percentage" | "flat"; value: number };
  onDone: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [state, setState] = useState<{ error?: string; saved?: boolean }>({});
  const locked = driver.managedBy === "company";

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
      {locked ? (
        <p className="w-full text-note text-fg-muted">
          On a company roster — their terms are set in that company&apos;s fleet console.
        </p>
      ) : !driver.payout ? (
        <p className="w-full text-note text-fg-muted">
          Using the default payout. Save a rate here to give this chauffeur their own.
        </p>
      ) : null}

      <label className="w-40">
        <span className="text-label font-bold text-fg-muted">Payout mode</span>
        <select
          name="mode"
          disabled={locked}
          defaultValue={driver.payout?.mode ?? fallback?.mode ?? "percentage"}
          className={`${inputClass} mt-1 disabled:opacity-60`}
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
          disabled={locked}
          defaultValue={driver.payout?.value ?? fallback?.value ?? 70}
          className={`${inputClass} mt-1 disabled:opacity-60`}
        />
      </label>

      <Button type="submit" variant="secondary" block={false} disabled={pending || locked}>
        {pending ? "Saving…" : "Save terms"}
      </Button>
      {state.saved ? <span className="text-note text-success">Saved</span> : null}
    </form>
  );
}

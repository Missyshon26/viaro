"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, Kicker, WarnBox } from "@/components/ui/Surfaces";
import { Button } from "@/components/ui/Button";
import { ConsolePage, money } from "@/components/ui/DataTable";
import { ListSearch, matches } from "@/components/ui/ListSearch";
import {
  listPricingRules,
  createPricingRule,
  updatePricingRule,
  deletePricingRule,
  type PricingRule,
} from "@/lib/api/admin";
import { errorText } from "@/lib/api/client";

/**
 * City pricing.
 *
 * The highest-consequence screen in the console: `calculateFare` throws a 404 for any
 * city without a rule, so a missing row here means nobody can book there at all.
 */
const inputClass =
  "w-full rounded-field border border-border bg-surface-raised px-3 py-2 text-note text-fg outline-none";

export default function PricingPage() {
  const [rules, setRules] = useState<PricingRule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    try {
      setRules(await listPricingRules());
      setError(null);
    } catch (err) {
      setError(errorText(err, "Could not load pricing"));
      setRules([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = (rules ?? []).filter((rule) =>
    matches(query, [rule.city, rule.baseFare, rule.peakMultiplier]),
  );

  return (
    <ConsolePage
      title="City pricing"
      description="Base fare and peak multiplier per city. Stored lowercase, matched on the city a booking sends."
    >
      {error ? <p className="mb-4 text-note font-bold text-danger">{error}</p> : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] lg:items-start">
        <div className="space-y-4">
          <Card className="p-0">
            <div className="space-y-3 px-6 pt-6">
              <Kicker>Rules</Kicker>
              <ListSearch
                value={query}
                onChange={setQuery}
                placeholder="Search city…"
                count={shown.length}
                total={rules?.length ?? 0}
              />
            </div>

            {rules === null ? (
              <p className="p-6 text-note text-fg-muted">Loading…</p>
            ) : rules.length === 0 ? (
              <p className="p-6 text-note text-fg-muted">
                No cities priced. Until a city has a rule, quoting there returns 404 and
                booking is impossible.
              </p>
            ) : shown.length === 0 ? (
              <p className="p-6 text-note text-fg-muted">No city matches &ldquo;{query}&rdquo;.</p>
            ) : (
              <ul className="mt-4 divide-y divide-border-subtle">
                {shown.map((rule) => (
                  <li key={rule._id} className="px-6 py-5">
                    <div className="flex flex-wrap items-baseline gap-3">
                      <p className="text-meta font-bold capitalize text-fg">{rule.city}</p>
                      <p className="text-note text-fg-muted">
                        {money(rule.baseFare)} base · ×{rule.peakMultiplier} at peak
                      </p>
                    </div>
                    <div className="mt-3">
                      <RuleForm rule={rule} onDone={load} />
                    </div>
                    <div className="mt-3">
                      <RemoveRule rule={rule} onDone={load} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <WarnBox title="A city with no rule cannot be booked">
            The fare endpoint answers 404 rather than falling back to a default, so
            removing a city takes it off sale immediately.
          </WarnBox>
        </div>

        <Card className="p-5">
          <Kicker>Add a city</Kicker>
          <div className="mt-4">
            <NewRuleForm onDone={load} />
          </div>
        </Card>
      </div>
    </ConsolePage>
  );
}

function RuleForm({ rule, onDone }: { rule: PricingRule; onDone: () => void }) {
  const [pending, setPending] = useState(false);
  const [state, setState] = useState<{ error?: string; saved?: boolean }>({});

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setPending(true);
        try {
          await updatePricingRule(rule._id, {
            baseFare: Number(form.get("baseFare")),
            peakMultiplier: Number(form.get("peakMultiplier")),
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
      {state.error ? (
        <p className="w-full text-label text-danger">{state.error}</p>
      ) : null}

      <label className="w-32">
        <span className="text-label font-bold text-fg-muted">Base fare</span>
        {/*
          * `required` and a minimum above zero, matching the "Add a city" form.
          *
          * Without them, clearing this field submitted Number("") === 0 and silently
          * saved a live city's fare as $0.00 with no warning — and the base fare is what
          * makes a city bookable at all.
          */}
        <input
          name="baseFare"
          type="number"
          step="0.01"
          min={0.01}
          required
          defaultValue={rule.baseFare}
          className={`${inputClass} mt-1`}
        />
      </label>

      <label className="w-32">
        <span className="text-label font-bold text-fg-muted">Peak ×</span>
        <input
          name="peakMultiplier"
          type="number"
          step="0.01"
          min={1}
          max={10}
          defaultValue={rule.peakMultiplier}
          className={`${inputClass} mt-1`}
        />
      </label>

      <Button type="submit" variant="secondary" block={false} disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
      {state.saved ? <span className="text-note text-success">Saved</span> : null}
    </form>
  );
}

function RemoveRule({ rule, onDone }: { rule: PricingRule; onDone: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-note font-bold text-danger hover:underline"
      >
        Remove this city…
      </button>
    );
  }

  return (
    <div className="rounded-field border border-danger/30 bg-danger/5 p-3.5">
      <p className="text-note leading-relaxed text-danger">
        Removing <span className="font-bold capitalize">{rule.city}</span> takes it off
        sale immediately — quotes there answer 404 until a rule is added again.
      </p>
      {error ? <p className="mt-2 text-label text-danger">{error}</p> : null}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={async () => {
            setPending(true);
            setError(null);
            try {
              await deletePricingRule(rule._id);
              onDone();
            } catch (err) {
              setError(errorText(err, "Could not remove that city"));
              setPending(false);
            }
          }}
          className="h-9 rounded-field bg-danger px-3.5 text-label font-bold text-white disabled:opacity-50"
        >
          {pending ? "Removing…" : "Remove city"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="h-9 rounded-field border border-border bg-surface-raised px-3.5 text-label font-bold text-fg-body"
        >
          Keep it
        </button>
      </div>
    </div>
  );
}

function NewRuleForm({ onDone }: { onDone: () => void }) {
  const [pending, setPending] = useState(false);
  const [state, setState] = useState<{ error?: string; saved?: boolean }>({});

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setPending(true);
        try {
          await createPricingRule({
            city: String(form.get("city")).trim().toLowerCase(),
            baseFare: Number(form.get("baseFare")),
            peakMultiplier: Number(form.get("peakMultiplier")),
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
        <span className="text-label font-bold text-fg-muted">City</span>
        <input
          name="city"
          required
          minLength={2}
          placeholder="seattle"
          className={`${inputClass} mt-1`}
        />
        <span className="mt-1 block text-note text-fg-muted">
          Stored lowercase; must match what the booking sends.
        </span>
      </label>

      <label className="block">
        <span className="text-label font-bold text-fg-muted">Base fare</span>
        <input
          name="baseFare"
          type="number"
          step="0.01"
          min={0.01}
          defaultValue={129}
          required
          className={`${inputClass} mt-1`}
        />
      </label>

      <label className="block">
        <span className="text-label font-bold text-fg-muted">Peak multiplier</span>
        <input
          name="peakMultiplier"
          type="number"
          step="0.01"
          min={1}
          max={10}
          defaultValue={1.18}
          required
          className={`${inputClass} mt-1`}
        />
        <span className="mt-1 block text-note text-fg-muted">
          1.18 adds 18% during peak hours.
        </span>
      </label>

      <Button type="submit" variant="accent" disabled={pending}>
        {pending ? "Adding…" : "Add city"}
      </Button>
      {state.saved ? <p className="text-note text-success">Added.</p> : null}
    </form>
  );
}

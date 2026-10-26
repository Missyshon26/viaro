"use client";

import { useEffect, useState } from "react";
import { Card, Kicker } from "@/components/ui/Surfaces";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { errorText } from "@/lib/api/client";
import { getPlatformSettings, updatePlatformSettings, type PlatformSettings } from "@/lib/api/admin";
import { ordinal, parseExtras, type ExtrasForm, type ExtrasPayload } from "@/lib/pricingExtras";

/**
 * Tax and discounts, applied on top of every fare from the next quote.
 *
 *   tax            a percentage of the price plus any tip, after the discount comes off
 *   welcome        dollars off a customer's very first trip (a cancelled trip still uses it up)
 *   loyalty        dollars off every Nth trip after that, counting trips that were not cancelled
 *
 * Saving asks first: every future booking is priced by these, and changing them cannot
 * reach back — a booking already made keeps the tax and discount it was given.
 */
const inputClass =
  "w-full rounded-field border border-border bg-surface-raised px-3 py-2 text-note text-fg outline-none focus:border-accent";

const toForm = (s: PlatformSettings): ExtrasForm => ({
  fuelSurchargePct: String(s.fuelSurchargePct ?? 0),
  taxPct: String(s.taxPct),
  welcomeDiscount: String(s.welcomeDiscount),
  loyaltyDiscount: String(s.loyaltyDiscount),
  loyaltyEveryNth: String(s.loyaltyEveryNth),
});

export function PricingExtras() {
  const [loaded, setLoaded] = useState<PlatformSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<ExtrasForm | null>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof ExtrasForm, string>>>({});
  const [staged, setStaged] = useState<ExtrasPayload | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let live = true;
    getPlatformSettings()
      .then((s) => {
        if (!live) return;
        setLoaded(s);
        setForm(toForm(s));
      })
      .catch((err) => live && setLoadError(errorText(err, "Could not load the tax and discount settings")));
    return () => {
      live = false;
    };
  }, []);

  async function save() {
    if (!staged) return;
    setSaving(true);
    setSaveError(null);
    try {
      const next = await updatePlatformSettings(staged);
      setLoaded(next);
      setForm(toForm(next));
      setStaged(null);
      setSaved(true);
    } catch (err) {
      setSaveError(errorText(err, "Could not save these settings"));
    } finally {
      setSaving(false);
    }
  }

  const field = (key: keyof ExtrasForm, label: string, hint: string, suffix?: string) => (
    <div>
      <label className="block text-label font-bold text-fg-muted" htmlFor={`extras-${key}`}>
        {label}
      </label>
      <div className="mt-1 flex items-center gap-2">
        <input
          id={`extras-${key}`}
          inputMode="decimal"
          autoComplete="off"
          value={form?.[key] ?? ""}
          onChange={(e) => {
            setSaved(false);
            setForm((prev) => (prev ? { ...prev, [key]: e.target.value } : prev));
          }}
          aria-invalid={Boolean(errors[key])}
          className={inputClass}
        />
        {suffix ? <span className="text-note text-fg-muted">{suffix}</span> : null}
      </div>
      {errors[key] ? (
        <p className="mt-1 text-note font-bold text-danger">{errors[key]}</p>
      ) : (
        <p className="mt-1 text-note text-fg-muted">{hint}</p>
      )}
    </div>
  );

  if (loadError) {
    return (
      <Card className="p-5">
        <Kicker>Tax and discounts</Kicker>
        <p className="mt-3 text-note font-bold text-danger">{loadError}</p>
      </Card>
    );
  }
  if (!loaded || !form) {
    return (
      <Card className="p-5">
        <Kicker>Tax and discounts</Kicker>
        <p className="mt-3 text-note text-fg-muted">Loading…</p>
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <Kicker>Tax and discounts</Kicker>
      <p className="mt-2 text-note leading-relaxed text-fg-muted">
        Added to every fare from the next quote. Customers also choose their own tip. A booking
        already made keeps the tax and discount it was given.
      </p>

      <form
        className="mt-4 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          setSaved(false);
          const result = parseExtras(form);
          if (!result.ok) {
            setErrors(result.errors);
            return;
          }
          setErrors({});
          setStaged(result.payload);
        }}
      >
        {field("fuelSurchargePct", "Fuel surcharge", "Added automatically to every trip price (rounded up to a whole dollar) and shown as its own line. The old site used 8. 0 for none.", "%")}
        {field("taxPct", "Sales tax", "Charged on the price plus fuel surcharge, after any discount. 0 for no tax.", "%")}
        {field("welcomeDiscount", "Welcome discount", "Off a customer's first trip. 0 for none.", "$")}
        {field("loyaltyDiscount", "Loyalty discount", "Off every Nth trip after that. 0 for none.", "$")}
        {field(
          "loyaltyEveryNth",
          "Loyalty: every",
          `Trips that were not cancelled. 4 means the ${ordinal(4)}, ${ordinal(8)} and ${ordinal(12)} trip each earn it.`,
          "trip",
        )}

        {saved ? <p className="text-note font-bold text-fg">Saved. It applies from the next quote.</p> : null}

        <Button type="submit" block={false} className="h-10 px-4 text-meta">
          Save
        </Button>
      </form>

      <ConfirmDialog
        open={staged !== null}
        title="Change tax and discounts?"
        confirmLabel="Save"
        pendingLabel="Saving…"
        pending={saving}
        error={saveError}
        onConfirm={() => void save()}
        onCancel={() => {
          setStaged(null);
          setSaveError(null);
        }}
      >
        {staged ? (
          <>
            <p>Every new quote and booking is priced with these:</p>
            <ul className="list-disc pl-5">
              <li>Fuel surcharge: {staged.fuelSurchargePct}%</li>
              <li>Tax: {staged.taxPct}%</li>
              <li>Welcome discount: {staged.welcomeDiscount > 0 ? `$${staged.welcomeDiscount.toFixed(2)} off a first trip` : "none"}</li>
              <li>
                Loyalty discount:{" "}
                {staged.loyaltyDiscount > 0
                  ? `$${staged.loyaltyDiscount.toFixed(2)} off every ${ordinal(staged.loyaltyEveryNth)} trip`
                  : "none"}
              </li>
            </ul>
          </>
        ) : null}
      </ConfirmDialog>
    </Card>
  );
}

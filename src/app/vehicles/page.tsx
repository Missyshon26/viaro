"use client";

import { useCallback, useEffect, useState } from "react";
import { ConsolePage, DataTable, money, type Column } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/Dashboard";
import { IconCar, IconCheck, IconClose, IconMoney } from "@/components/ui/Icons";
import { errorText } from "@/lib/api/client";
import {
  createVehicleClass,
  deleteVehicleClass,
  listVehicleClasses,
  updateVehicleClass,
  USAGE_LABEL,
  type VehicleClass,
  type VehicleClassInput,
  type VehicleUsage,
} from "@/lib/api/vehicles";

/**
 * The bookable vehicle catalogue.
 *
 * This is a pricing screen as much as a content one: `multiplier` is applied by the fare
 * calculator on every quote and every booking, so an edit here changes what customers
 * are charged from the next request onward — no deploy, no restart.
 *
 * Two rules the interface has to carry, because the API enforces them and a form that
 * hides them just produces errors:
 *   - `value` is the key stored on every booking, so it is set once and never edited.
 *   - retiring a class (active: false) is the safe way to withdraw it; deleting leaves
 *     historical bookings pointing at a key nothing can label.
 */
const BASE_FARE_EXAMPLE = 129;

export default function VehiclesPage() {
  const [rows, setRows] = useState<VehicleClass[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<VehicleClass | "new" | null>(null);
  const [confirmRetire, setConfirmRetire] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      // Admins see retired classes too, so they can bring one back.
      setRows(await listVehicleClasses(true));
      setError(null);
    } catch (err) {
      setError(errorText(err, "Could not load the catalogue"));
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleActive(row: VehicleClass) {
    try {
      await updateVehicleClass(row._id, { active: !row.active });
      await load();
    } catch (err) {
      setError(errorText(err, "Could not update that class"));
    }
  }

  const columns: Column<VehicleClass>[] = [
    {
      key: "label",
      header: "Class",
      cell: (r) => (
        <span className="flex min-w-0 items-center gap-2.5">
          <span
            aria-hidden
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-field bg-accent-soft text-accent-strong"
          >
            <IconCar size={15} />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-bold text-fg">{r.label}</span>
            <span className="block truncate font-mono text-label text-fg-muted">
              {r.value}
            </span>
          </span>
        </span>
      ),
      sortValue: (r) => r.label,
    },
    {
      key: "capacity",
      header: "Seats · bags",
      cell: (r) => (
        <span className="text-fg-body">
          {r.seats} · {r.bags}
        </span>
      ),
      sortValue: (r) => r.seats,
    },
    {
      key: "usage",
      header: "Available for",
      cell: (r) => <span className="text-fg-body">{USAGE_LABEL[r.usage ?? "all"]}</span>,
      sortValue: (r) => r.usage ?? "all",
    },
    {
      key: "multiplier",
      header: "Fare multiplier",
      cell: (r) => (
        <span className="font-bold text-fg">
          ×{r.multiplier}
          {(r.usage ?? "all") === "all" && r.hourlyMultiplier ? (
            <span className="ml-1.5 text-note font-normal text-fg-muted">· hourly ×{r.hourlyMultiplier}</span>
          ) : null}
        </span>
      ),
      sortValue: (r) => r.multiplier,
    },
    {
      key: "example",
      header: "Example fare",
      secondary: true,
      cell: (r) => (
        <span className="text-fg-muted">{money(BASE_FARE_EXAMPLE * r.multiplier)}</span>
      ),
      sortValue: (r) => r.multiplier,
    },
    {
      key: "active",
      header: "Status",
      cell: (r) => (
        <StatusBadge tone={r.active ? "good" : "neutral"}>
          {r.active ? "Bookable" : "Retired"}
        </StatusBadge>
      ),
      sortValue: (r) => (r.active ? 0 : 1),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (r) =>
        confirmRetire === r._id ? (
          // Retiring removes the class from every booking form at once, so it gets the
          // same second step as Delete rather than firing on a single click.
          <span className="flex flex-wrap items-center justify-end gap-2">
            <span className="text-label text-fg-muted">Take it off sale?</span>
            <button
              type="button"
              onClick={() => {
                setConfirmRetire(null);
                void toggleActive(r);
              }}
              className="h-8 rounded-field bg-danger px-3 text-label font-bold text-white"
            >
              Retire
            </button>
            <button
              type="button"
              onClick={() => setConfirmRetire(null)}
              className="h-8 rounded-field border border-border bg-surface-raised px-3 text-label font-bold text-fg-body"
            >
              Keep
            </button>
          </span>
        ) : (
          <span className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditing(r)}
              className="h-8 rounded-field border border-border bg-surface-raised px-3 text-label font-bold text-fg-body transition-colors hover:border-accent hover:text-fg"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => (r.active ? setConfirmRetire(r._id) : void toggleActive(r))}
              className="h-8 rounded-field border border-border bg-surface-raised px-3 text-label font-bold text-fg-body transition-colors hover:border-accent hover:text-fg"
            >
              {r.active ? "Retire…" : "Restore"}
            </button>
          </span>
        ),
    },
  ];

  return (
    <ConsolePage
      title="Vehicle catalogue"
      description="The classes customers can book, and what each one does to the fare. Changes apply to the next quote — no deploy needed."
      action={
        <button
          type="button"
          onClick={() => setEditing("new")}
          className="inline-flex h-10 items-center gap-2 rounded-field bg-primary px-4 text-meta font-bold text-primary-fg"
        >
          <IconCheck size={15} />
          Add a class
        </button>
      }
    >
      {error ? (
        <p className="mb-4 rounded-field border border-danger/30 bg-danger/5 px-4 py-3 text-note font-bold text-danger">
          {error}
        </p>
      ) : null}

      <p className="mb-4 rounded-field border border-border bg-surface px-4 py-3 text-note leading-relaxed text-fg-muted">
        The fare is the city base fare × the peak multiplier × this class multiplier.
        Example fares above assume a {money(BASE_FARE_EXAMPLE)} base and no peak window.
      </p>

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r._id}
        minWidth="52rem"
        searchable={(r) => [r.label, r.value, r.detail]}
        searchPlaceholder="Search classes…"
        empty={{
          title: "No vehicle classes",
          description: "Add one to make it bookable on the passenger site.",
        }}
      />

      {editing ? (
        <VehicleDialog
          vehicle={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      ) : null}
    </ConsolePage>
  );
}

/* ---------------------------------- dialog --------------------------------- */

function VehicleDialog({
  vehicle,
  onClose,
  onSaved,
}: {
  vehicle: VehicleClass | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const isNew = vehicle === null;

  const [form, setForm] = useState<VehicleClassInput & { value: string }>({
    value: vehicle?.value ?? "",
    label: vehicle?.label ?? "",
    detail: vehicle?.detail ?? "",
    seats: vehicle?.seats ?? 3,
    bags: vehicle?.bags ?? 2,
    multiplier: vehicle?.multiplier ?? 1,
    usage: vehicle?.usage ?? "all",
    hourlyMultiplier: vehicle?.hourlyMultiplier ?? null,
    sortOrder: vehicle?.sortOrder ?? 0,
    active: vehicle?.active ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  async function save() {
    setSaving(true);
    setError(null);
    // A class limited to one kind of trip has one rate: `multiplier`. A separate hourly
    // rate only means something when the class serves both.
    const payload = {
      ...form,
      hourlyMultiplier: (form.usage ?? "all") === "all" ? (form.hourlyMultiplier ?? null) : null,
    };
    try {
      if (isNew) {
        await createVehicleClass(payload);
      } else {
        // `value` is omitted on purpose: the API rejects it, because every existing
        // booking stored the old key.
        const { value: _ignored, ...rest } = payload;
        await updateVehicleClass(vehicle._id, rest);
      }
      await onSaved();
    } catch (err) {
      setError(errorText(err, "Could not save that class"));
    } finally {
      setSaving(false);
    }
  }

  async function destroy() {
    if (!vehicle) return;
    setSaving(true);
    setError(null);
    try {
      await deleteVehicleClass(vehicle._id);
      await onSaved();
    } catch (err) {
      setError(errorText(err, "Could not delete that class"));
      setSaving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={isNew ? "Add a vehicle class" : `Edit ${vehicle.label}`}
      className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-panel/50 backdrop-blur-[2px]"
      />

      <div className="relative flex max-h-[88dvh] w-full max-w-lg flex-col overflow-hidden rounded-card border border-border bg-surface-raised shadow-[var(--shadow-raised)]">
        <div className="flex items-center gap-3 border-b border-border-subtle px-5 py-4">
          <h2 className="text-action font-bold text-fg">
            {isNew ? "Add a vehicle class" : vehicle.label}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-full text-fg-muted hover:bg-surface hover:text-fg"
          >
            <IconClose size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {error ? (
            <p className="rounded-field border border-danger/30 bg-danger/5 px-3.5 py-2.5 text-note font-bold text-danger">
              {error}
            </p>
          ) : null}

          <Field
            label="Key"
            hint={
              isNew
                ? "Lowercase, hyphens only. Stored on every booking, so it can never be changed."
                : "Set when the class was created and permanent — bookings reference it."
            }
          >
            <input
              value={form.value}
              disabled={!isNew}
              onChange={(e) => set("value", e.target.value.toLowerCase().replace(/\s+/g, "-"))}
              placeholder="luxury-van"
              className="h-10 w-full rounded-field border border-border bg-surface px-3 font-mono text-meta text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none disabled:opacity-60"
            />
          </Field>

          <Field label="Name" hint="What the customer sees on the booking card.">
            <input
              value={form.label}
              onChange={(e) => set("label", e.target.value)}
              placeholder="Luxury Van"
              className="h-10 w-full rounded-field border border-border bg-surface px-3 text-meta text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none"
            />
          </Field>

          <Field label="Description">
            <input
              value={form.detail ?? ""}
              onChange={(e) => set("detail", e.target.value)}
              placeholder="Up to 7 passengers, 6 bags"
              className="h-10 w-full rounded-field border border-border bg-surface px-3 text-meta text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none"
            />
          </Field>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Seats">
              <input
                type="number"
                min={1}
                max={60}
                value={form.seats}
                onChange={(e) => set("seats", Number(e.target.value))}
                className="h-10 w-full rounded-field border border-border bg-surface px-3 text-meta text-fg focus:border-accent focus:outline-none"
              />
            </Field>
            <Field label="Bags">
              <input
                type="number"
                min={0}
                max={60}
                value={form.bags}
                onChange={(e) => set("bags", Number(e.target.value))}
                className="h-10 w-full rounded-field border border-border bg-surface px-3 text-meta text-fg focus:border-accent focus:outline-none"
              />
            </Field>
            <Field label="Order">
              <input
                type="number"
                min={0}
                max={999}
                value={form.sortOrder ?? 0}
                onChange={(e) => set("sortOrder", Number(e.target.value))}
                className="h-10 w-full rounded-field border border-border bg-surface px-3 text-meta text-fg focus:border-accent focus:outline-none"
              />
            </Field>
          </div>

          {/*
            Which trips the class can be booked for. A class limited to hourly (or to
            transfers) is refused by the API for the other kind — quote and booking alike.
          */}
          <Field label="Available for" hint="Limit a vehicle to hourly charters, or keep it off them.">
            <div role="radiogroup" className="grid grid-cols-3 gap-1 rounded-field border border-border bg-surface p-1">
              {(["all", "transfer", "hourly"] as VehicleUsage[]).map((usage) => {
                const selected = (form.usage ?? "all") === usage;
                return (
                  <button
                    key={usage}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => set("usage", usage)}
                    className={`rounded-[0.5rem] px-2 py-2 text-note font-bold transition-colors ${
                      selected ? "bg-accent text-white" : "text-fg-muted hover:text-fg"
                    }`}
                  >
                    {USAGE_LABEL[usage]}
                  </button>
                );
              })}
            </div>
          </Field>

          <Field
            label={
              form.usage === "hourly"
                ? "Hourly fare multiplier"
                : form.usage === "transfer"
                  ? "Fare multiplier"
                  : "Transfer fare multiplier"
            }
            hint={
              form.usage === "hourly"
                ? "Applied to each hour booked, from the next request onward."
                : "Point-to-point and airport trips, from the next request onward."
            }
          >
            <div className="flex items-center gap-3">
              <input
                type="number"
                step={0.05}
                min={0.1}
                max={20}
                value={form.multiplier}
                onChange={(e) => set("multiplier", Number(e.target.value))}
                className="h-10 w-28 rounded-field border border-border bg-surface px-3 text-meta font-bold text-fg focus:border-accent focus:outline-none"
              />
              <span className="flex items-center gap-1.5 text-note text-fg-muted">
                <IconMoney size={14} />
                {money(BASE_FARE_EXAMPLE)} base becomes{" "}
                <span className="font-bold text-fg">
                  {money(BASE_FARE_EXAMPLE * (form.multiplier || 0))}
                </span>
              </span>
            </div>
          </Field>

          {(form.usage ?? "all") === "all" ? (
            <Field
              label="Hourly fare multiplier"
              hint="Leave blank to charge hourly charters the same multiplier as transfers."
            >
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  step={0.05}
                  min={0.1}
                  max={20}
                  value={form.hourlyMultiplier ?? ""}
                  placeholder={String(form.multiplier || 1)}
                  onChange={(e) =>
                    set("hourlyMultiplier", e.target.value === "" ? null : Number(e.target.value))
                  }
                  className="h-10 w-28 rounded-field border border-border bg-surface px-3 text-meta font-bold text-fg focus:border-accent focus:outline-none"
                />
                <span className="flex items-center gap-1.5 text-note text-fg-muted">
                  <IconMoney size={14} />
                  {money(BASE_FARE_EXAMPLE)} per hour becomes{" "}
                  <span className="font-bold text-fg">
                    {money(BASE_FARE_EXAMPLE * (form.hourlyMultiplier || form.multiplier || 0))}
                  </span>
                </span>
              </div>
            </Field>
          ) : null}

          <label className="flex items-center gap-2.5 rounded-field border border-border bg-surface px-3.5 py-3">
            <input
              type="checkbox"
              checked={form.active ?? true}
              onChange={(e) => set("active", e.target.checked)}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            <span className="text-meta text-fg">Bookable on the passenger site</span>
          </label>

          {!isNew ? (
            <div className="rounded-field border border-danger/30 bg-danger/5 p-3.5">
              {confirmDelete ? (
                <>
                  <p className="text-note leading-relaxed text-danger">
                    Deleting removes the class permanently. Bookings that chose{" "}
                    <span className="font-mono font-bold">{vehicle.value}</span> keep the
                    key but lose their label and seat count, and future quotes for it fall
                    back to the base fare. Retiring it instead keeps all of that intact.
                  </p>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={destroy}
                      disabled={saving}
                      className="h-9 rounded-field bg-danger px-3.5 text-label font-bold text-white disabled:opacity-50"
                    >
                      Delete permanently
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className="h-9 rounded-field border border-border bg-surface-raised px-3.5 text-label font-bold text-fg-body"
                    >
                      Keep it
                    </button>
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="text-note font-bold text-danger hover:underline"
                >
                  Delete this class…
                </button>
              )}
            </div>
          ) : null}
        </div>

        <div className="flex gap-2.5 border-t border-border-subtle px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="h-10 flex-1 rounded-field border border-border bg-surface-raised text-meta font-bold text-fg-body transition-colors hover:text-fg"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || !form.label || (isNew && !form.value)}
            className="h-10 flex-1 rounded-field bg-primary text-meta font-bold text-primary-fg transition-opacity disabled:opacity-40"
          >
            {saving ? "Saving…" : isNew ? "Create class" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  /*
   * The input is nested INSIDE the label rather than sitting as a sibling.
   *
   * The label previously had neither `htmlFor` nor any nesting, so nothing connected the
   * two: a screen reader announced the field as unlabelled, and clicking the label text
   * did not focus the input. Nesting fixes both for all seven fields in the dialog
   * without needing an id threaded through every call site.
   */
  return (
    <div>
      <label className="block">
        <span className="block text-note font-medium uppercase tracking-wider text-fg-muted">
          {label}
        </span>
        <span className="mt-1.5 block">{children}</span>
      </label>
      {hint ? <p className="mt-1.5 text-note leading-relaxed text-fg-faint">{hint}</p> : null}
    </div>
  );
}

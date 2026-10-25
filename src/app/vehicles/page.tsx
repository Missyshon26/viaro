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
  MAX_PHOTO_BYTES,
  MAX_PHOTOS,
  PHOTO_TYPES,
  removeVehiclePhoto,
  updateVehicleClass,
  updateVehiclePhoto,
  uploadVehiclePhoto,
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
      header: "Price",
      cell: (r) => {
        const fixed = [
          r.flatRate ? `${money(r.flatRate)} flat` : null,
          r.hourlyRate ? `${money(r.hourlyRate)}/hr` : null,
        ].filter(Boolean);
        return fixed.length ? (
          <span className="font-bold text-fg">
            {fixed.join(" · ")}
            {r.minimumFare ? (
              <span className="ml-1.5 text-note font-normal text-fg-muted">· min {money(r.minimumFare)}</span>
            ) : null}
          </span>
        ) : (
          <span className="text-fg-muted">≈ {money(BASE_FARE_EXAMPLE * r.multiplier)}</span>
        );
      },
      sortValue: (r) => r.flatRate ?? r.hourlyRate ?? BASE_FARE_EXAMPLE * r.multiplier,
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
        A class with a fixed price is charged exactly that, and peak windows don&apos;t apply.
        Any other class is priced at the city base fare × the peak multiplier × its class
        multiplier (≈ prices assume a {money(BASE_FARE_EXAMPLE)} base and no peak window). Pickups
        between 10pm and 7am add a $20 primetime surcharge to every class.
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
          onPhotosChanged={load}
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
  onPhotosChanged,
}: {
  vehicle: VehicleClass | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
  /** Photos save the moment they change, so the list behind the dialog refreshes too. */
  onPhotosChanged: () => Promise<void>;
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
    flatRate: vehicle?.flatRate ?? null,
    hourlyRate: vehicle?.hourlyRate ?? null,
    minimumFare: vehicle?.minimumFare ?? null,
    stopFee: vehicle?.stopFee ?? null,
    baseMiles: vehicle?.baseMiles ?? null,
    perMileRate: vehicle?.perMileRate ?? null,
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
      // A rate for a trip type the class doesn't serve would never be charged — clear it.
      flatRate: form.usage === "hourly" ? null : (form.flatRate ?? null),
      hourlyRate: form.usage === "transfer" ? null : (form.hourlyRate ?? null),
      minimumFare: form.minimumFare ?? null,
      stopFee: form.stopFee ?? null,
      // By the mile only makes sense for a flat transfer rate, and needs both numbers.
      baseMiles: form.usage === "hourly" || !form.flatRate || !form.perMileRate ? null : (form.baseMiles ?? null),
      perMileRate: form.usage === "hourly" || !form.flatRate || !form.baseMiles ? null : (form.perMileRate ?? null),
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

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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

          {/*
            Fixed prices. Set, they replace the multiplier for that kind of trip — the
            rate card is the price. Blank keeps the multiplier formula above.
          */}
          {form.usage !== "hourly" ? (
            <Field
              label="Flat transfer price ($)"
              hint="Point-to-point and airport. Leave blank to price by the multiplier."
            >
              <RateInput value={form.flatRate} onChange={(v) => set("flatRate", v)} />
            </Field>
          ) : null}

          {form.usage !== "transfer" ? (
            <Field
              label="Hourly price ($ per hour)"
              hint="Hourly charters. Leave blank to price by the multiplier."
            >
              <RateInput value={form.hourlyRate} onChange={(v) => set("hourlyRate", v)} />
            </Field>
          ) : null}

          <Field
            label="Minimum fare ($)"
            hint="The least a booking in this class costs, before the primetime surcharge."
          >
            <RateInput value={form.minimumFare} onChange={(v) => set("minimumFare", v)} />
          </Field>

          <Field
            label="Charge per extra stop ($)"
            hint="Added for each stop a passenger adds to a transfer. Leave blank for free stops."
          >
            <RateInput value={form.stopFee} onChange={(v) => set("stopFee", v)} />
          </Field>

          {form.usage !== "hourly" ? (
            <>
              <Field
                label="Miles the flat rate covers"
                hint="With a flat transfer rate: how far the trip goes before extra miles are charged. Leave blank, with the rate below, to charge the flat rate however far."
              >
                <RateInput value={form.baseMiles} onChange={(v) => set("baseMiles", v)} />
              </Field>

              <Field
                label="Rate per extra mile ($)"
                hint="Charged for each mile beyond that, rounded up. The route is measured by the server."
              >
                <RateInput value={form.perMileRate} onChange={(v) => set("perMileRate", v)} />
              </Field>
            </>
          ) : null}

          {vehicle ? (
            <PhotoManager vehicle={vehicle} onChanged={onPhotosChanged} />
          ) : (
            <p className="rounded-field border border-border bg-surface px-3.5 py-3 text-note text-fg-muted">
              Photos can be added once the class is created.
            </p>
          )}

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

/* --------------------------------- photos ---------------------------------- */

/**
 * The class's photos. Unlike the fields above they save immediately — a file is uploaded
 * the moment it is chosen — so they are managed here, not by "Save changes".
 *
 * The first photo is the cover the passenger site shows first. Photos that predate uploads
 * have no `key` and can only be replaced from the data, so they are listed but not editable.
 */
function PhotoManager({ vehicle, onChanged }: { vehicle: VehicleClass; onChanged: () => Promise<void> }) {
  const [photos, setPhotos] = useState(vehicle.images ?? []);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  async function run(label: string, work: () => Promise<VehicleClass>) {
    setBusy(label);
    setError(null);
    try {
      const updated = await work();
      setPhotos(updated.images ?? []);
      await onChanged();
    } catch (err) {
      setError(errorText(err, "That did not work"));
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  }

  async function onPick(files: FileList | null) {
    const picked = Array.from(files ?? []);
    // Each file is checked here first so the common mistakes get a plain message
    // instead of a failed upload; the server checks again regardless.
    for (const file of picked) {
      if (!PHOTO_TYPES.includes(file.type)) {
        setError(`${file.name} is not a JPEG, PNG or WebP image.`);
        return;
      }
      if (file.size > MAX_PHOTO_BYTES) {
        setError(`${file.name} is over 5 MB. Choose a smaller file.`);
        return;
      }
    }
    // One at a time: the server enforces the ten-photo limit atomically per upload.
    for (const file of picked) {
      let failed = false;
      await run(`Uploading ${file.name}…`, async () => {
        try {
          return await uploadVehiclePhoto(vehicle._id, file);
        } catch (err) {
          failed = true;
          throw err;
        }
      });
      if (failed) break;
    }
  }

  const full = photos.length >= MAX_PHOTOS;

  return (
    <div className="rounded-field border border-border bg-surface p-3.5">
      <div className="flex items-center gap-2">
        <h3 className="text-meta font-bold text-fg">Photos</h3>
        <span className="text-note text-fg-muted">
          {photos.length} of {MAX_PHOTOS} · the first is the cover
        </span>
      </div>

      {error ? (
        <p className="mt-2 rounded-field border border-danger/30 bg-danger/5 px-3 py-2 text-note font-bold text-danger">
          {error}
        </p>
      ) : null}

      {photos.length > 0 ? (
        <ul className="mt-3 grid grid-cols-2 gap-3">
          {photos.map((photo, index) => (
            <li key={photo.key ?? photo.src} className="overflow-hidden rounded-field border border-border bg-surface-raised">
              {/* eslint-disable-next-line @next/next/no-img-element -- admin-only preview of an API-hosted file */}
              <img src={photo.src} alt={photo.alt} className="h-24 w-full object-cover" />
              <div className="space-y-1.5 p-2">
                <p className="truncate text-note text-fg-muted">
                  {index === 0 ? "Cover · " : ""}
                  {photo.caption}
                </p>
                {photo.key ? (
                  confirming === photo.key ? (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => run("Removing…", () => removeVehiclePhoto(vehicle._id, photo.key as string))}
                        className="h-7 rounded-field bg-danger px-2 text-note font-bold text-white disabled:opacity-50"
                      >
                        Remove it
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirming(null)}
                        className="h-7 rounded-field border border-border px-2 text-note font-bold text-fg-body"
                      >
                        Keep
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      {index > 0 ? (
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() =>
                            run("Updating…", () => updateVehiclePhoto(vehicle._id, photo.key as string, { cover: true }))
                          }
                          className="text-note font-bold text-fg-body hover:underline disabled:opacity-50"
                        >
                          Make cover
                        </button>
                      ) : null}
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => setConfirming(photo.key as string)}
                        className="ml-auto text-note font-bold text-danger hover:underline disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </div>
                  )
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-note text-fg-muted">No photos yet. The passenger site shows a default picture until one is added.</p>
      )}

      <label
        className={`mt-3 inline-flex h-9 cursor-pointer items-center rounded-field border border-border bg-surface-raised px-3.5 text-label font-bold text-fg-body hover:text-fg ${
          full || busy ? "pointer-events-none opacity-50" : ""
        }`}
      >
        {busy ?? (full ? "Photo limit reached" : "Add photos")}
        <input
          type="file"
          accept={PHOTO_TYPES.join(",")}
          multiple
          disabled={full || busy !== null}
          className="sr-only"
          onChange={(event) => {
            const input = event.currentTarget;
            void onPick(input.files).finally(() => {
              input.value = "";
            });
          }}
        />
      </label>
      <p className="mt-1.5 text-note text-fg-muted">JPEG, PNG or WebP, up to 5 MB each.</p>
    </div>
  );
}

/** Optional dollar amount: an empty field is null (no fixed price), never $0. */
function RateInput({
  value,
  onChange,
}: {
  value: number | null | undefined;
  onChange: (value: number | null) => void;
}) {
  return (
    <input
      type="number"
      step={1}
      min={1}
      max={100000}
      value={value ?? ""}
      placeholder="—"
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      className="h-10 w-28 rounded-field border border-border bg-surface px-3 text-meta font-bold text-fg focus:border-accent focus:outline-none"
    />
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

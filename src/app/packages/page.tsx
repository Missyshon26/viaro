"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ConsolePage, DataTable, money, type Column } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/Dashboard";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { IconCheck, IconClose, IconPackage } from "@/components/ui/Icons";
import { errorText } from "@/lib/api/client";
import {
  createPackage,
  deletePackage,
  listPackages,
  MAX_PACKAGE_IMAGE_BYTES,
  PACKAGE_IMAGE_TYPES,
  removePackageImage,
  updatePackage,
  uploadPackageImage,
  type PackageInput,
  type PackageStatus,
  type TourPackage,
} from "@/lib/api/packages";
import { listVehicleClasses, type VehicleClass } from "@/lib/api/vehicles";

/**
 * Tour and event packages (a wine-country day, a wedding send-off…), each with a fixed price
 * per vehicle. "Visible" packages are listed on the booking page; "Hidden" ones are kept here
 * but not shown to customers.
 */
export default function PackagesPage() {
  const [rows, setRows] = useState<TourPackage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<TourPackage | "new" | null>(null);
  const [removing, setRemoving] = useState<TourPackage | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [show, setShow] = useState<"all" | PackageStatus>("all");

  const load = useCallback(async () => {
    try {
      setRows(await listPackages());
      setError(null);
    } catch (err) {
      setError(errorText(err, "Could not load the packages"));
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const visible = (rows ?? []).filter((r) => r.status === "visible").length;
    return { all: rows?.length ?? 0, visible, hidden: (rows?.length ?? 0) - visible };
  }, [rows]);
  const shown = useMemo(
    () => (rows === null ? null : show === "all" ? rows : rows.filter((r) => r.status === show)),
    [rows, show],
  );

  async function toggleStatus(row: TourPackage) {
    try {
      await updatePackage(row._id, { status: row.status === "visible" ? "hidden" : "visible" });
      await load();
    } catch (err) {
      setError(errorText(err, "Could not update that package"));
    }
  }

  async function confirmRemove() {
    if (!removing) return;
    setRemoveBusy(true);
    setRemoveError(null);
    try {
      await deletePackage(removing._id);
      setRemoving(null);
      await load();
    } catch (err) {
      setRemoveError(errorText(err, "Could not delete that package"));
    } finally {
      setRemoveBusy(false);
    }
  }

  const columns: Column<TourPackage>[] = [
    {
      key: "name",
      header: "Package",
      cell: (r) => (
        <span className="flex min-w-0 items-center gap-3">
          {r.image ? (
            // eslint-disable-next-line @next/next/no-img-element -- admin-only preview of an API-hosted file
            <img src={r.image.src} alt="" className="h-10 w-14 shrink-0 rounded-field object-cover" />
          ) : (
            <span aria-hidden className="inline-flex h-10 w-14 shrink-0 items-center justify-center rounded-field bg-accent-soft text-accent-strong">
              <IconPackage size={16} />
            </span>
          )}
          <span className="min-w-0">
            <span className="block truncate font-bold text-fg">{r.name}</span>
            {r.eventTypes.length ? (
              <span className="block truncate text-label text-fg-muted">{r.eventTypes.join(" · ")}</span>
            ) : null}
          </span>
        </span>
      ),
      sortValue: (r) => r.name,
    },
    {
      key: "length",
      header: "Length · people",
      cell: (r) => (
        <span className="text-fg-body">
          {r.tourLength || "—"} · {r.totalPersons}
        </span>
      ),
      sortValue: (r) => r.totalPersons,
    },
    {
      key: "price",
      header: "Price",
      cell: (r) => {
        const prices = r.vehicles.map((v) => v.price);
        if (!prices.length) return <span className="text-fg-muted">No vehicles priced</span>;
        const low = Math.min(...prices);
        return (
          <span className="font-bold text-fg">
            {prices.length > 1 ? `from ${money(low)}` : money(low)}
            <span className="ml-1.5 text-note font-normal text-fg-muted">
              · {prices.length} vehicle{prices.length === 1 ? "" : "s"}
            </span>
          </span>
        );
      },
      sortValue: (r) => (r.vehicles.length ? Math.min(...r.vehicles.map((v) => v.price)) : Infinity),
    },
    {
      key: "status",
      header: "Status",
      cell: (r) => (
        <StatusBadge tone={r.status === "visible" ? "good" : "neutral"}>
          {r.status === "visible" ? "Visible" : "Hidden"}
        </StatusBadge>
      ),
      sortValue: (r) => (r.status === "visible" ? 0 : 1),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (r) => (
        <span className="flex justify-end gap-2">
          <button type="button" onClick={() => setEditing(r)} className={rowButton}>
            Edit
          </button>
          <button type="button" onClick={() => void toggleStatus(r)} className={rowButton}>
            {r.status === "visible" ? "Hide" : "Show"}
          </button>
          <button
            type="button"
            onClick={() => {
              setRemoveError(null);
              setRemoving(r);
            }}
            className={`${rowButton} text-danger`}
          >
            Delete…
          </button>
        </span>
      ),
    },
  ];

  return (
    <ConsolePage
      title="Packages"
      description="Tour and event packages with a fixed price for each vehicle. Visible packages are listed on the booking page."
      action={
        <button
          type="button"
          onClick={() => setEditing("new")}
          className="inline-flex h-10 items-center gap-2 rounded-field bg-primary px-4 text-meta font-bold text-primary-fg"
        >
          <IconCheck size={15} />
          Add a package
        </button>
      }
    >
      {error ? (
        <p className="mb-4 rounded-field border border-danger/30 bg-danger/5 px-4 py-3 text-note font-bold text-danger">{error}</p>
      ) : null}

      <div role="group" aria-label="Show packages" className="mb-4 flex flex-wrap gap-2">
        {(
          [
            ["all", "All", counts.all],
            ["visible", "Visible", counts.visible],
            ["hidden", "Hidden", counts.hidden],
          ] as const
        ).map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            aria-pressed={show === key}
            onClick={() => setShow(key)}
            className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-3.5 text-meta font-bold transition-colors ${
              show === key
                ? "border-accent bg-accent-soft text-accent-strong"
                : "border-border bg-surface-raised text-fg-body hover:border-accent/50 hover:text-fg"
            }`}
          >
            {label}
            <span className={`rounded-full px-1.5 text-label ${show === key ? "bg-accent/15" : "bg-surface text-fg-muted"}`}>{count}</span>
          </button>
        ))}
      </div>

      <DataTable
        rows={shown}
        columns={columns}
        rowKey={(r) => r._id}
        minWidth="50rem"
        searchable={(r) => [r.name, r.description, r.tourLength, ...r.eventTypes]}
        searchPlaceholder="Search packages…"
        empty={{
          title: show === "all" ? "No packages yet" : `No ${show} packages`,
          description: show === "all" ? "Add one to list it on the booking page." : "Try another filter above.",
        }}
      />

      {editing ? (
        <PackageDialog
          pkg={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
          onChanged={load}
        />
      ) : null}

      <ConfirmDialog
        open={removing !== null}
        title="Delete this package?"
        confirmLabel="Delete package"
        pendingLabel="Deleting…"
        danger
        pending={removeBusy}
        error={removeError}
        onConfirm={() => void confirmRemove()}
        onCancel={() => setRemoving(null)}
      >
        {removing ? `“${removing.name}” and its picture will be removed for good. To keep it but stop customers seeing it, hide it instead.` : null}
      </ConfirmDialog>
    </ConsolePage>
  );
}

const rowButton =
  "h-8 rounded-field border border-border bg-surface-raised px-3 text-label font-bold text-fg-body transition-colors hover:border-accent hover:text-fg";

/* ---------------------------------- dialog --------------------------------- */

function PackageDialog({
  pkg,
  onClose,
  onSaved,
  onChanged,
}: {
  pkg: TourPackage | null;
  onClose: () => void;
  /** Saved everything: close and refresh. */
  onSaved: () => Promise<void>;
  /** Something changed but the dialog stays open: refresh the list behind it. */
  onChanged: () => Promise<void>;
}) {
  const isNew = pkg === null;

  const [name, setName] = useState(pkg?.name ?? "");
  const [description, setDescription] = useState(pkg?.description ?? "");
  const [tourLength, setTourLength] = useState(pkg?.tourLength ?? "");
  const [totalPersons, setTotalPersons] = useState(String(pkg?.totalPersons ?? 1));
  const [status, setStatus] = useState<PackageStatus>(pkg?.status ?? "visible");
  const [eventTypes, setEventTypes] = useState((pkg?.eventTypes ?? []).join(", "));
  // Price per vehicle class, as typed: a class is offered when it has a price.
  const [prices, setPrices] = useState<Record<string, string>>(
    Object.fromEntries((pkg?.vehicles ?? []).map((v) => [v.vehicleClass, String(v.price)])),
  );
  const [classes, setClasses] = useState<VehicleClass[] | null>(null);

  // The picture: what is stored, and a newly picked file waiting to be saved with the form.
  const [image, setImage] = useState(pkg?.image ?? null);
  const [picked, setPicked] = useState<File | null>(null);
  const pickedUrl = useMemo(() => (picked ? URL.createObjectURL(picked) : null), [picked]);
  useEffect(() => () => (pickedUrl ? URL.revokeObjectURL(pickedUrl) : undefined), [pickedUrl]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set once a new package has been saved, so a retry updates it instead of adding another.
  const [createdId, setCreatedId] = useState<string | null>(null);
  const targetId = pkg?._id ?? createdId;

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let current = true;
    listVehicleClasses(false)
      .then((list) => current && setClasses(list))
      .catch((err) => {
        if (current) {
          setClasses([]);
          setError(errorText(err, "Could not load the vehicle list"));
        }
      });
    return () => {
      current = false;
    };
  }, []);

  // A package may still price a class that has since been retired; keep it editable.
  const retired = useMemo(
    () => Object.keys(prices).filter((value) => classes && !classes.some((c) => c.value === value)),
    [prices, classes],
  );

  function pickFile(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    if (!PACKAGE_IMAGE_TYPES.includes(file.type)) return setError(`${file.name} is not a JPEG, PNG or WebP image.`);
    if (file.size > MAX_PACKAGE_IMAGE_BYTES) return setError(`${file.name} is over 5 MB. Choose a smaller file.`);
    setError(null);
    setPicked(file);
  }

  function buildInput(): PackageInput | string {
    if (name.trim().length < 2) return "Give the package a name.";
    const persons = Number(totalPersons);
    if (!Number.isInteger(persons) || persons < 1 || persons > 100) return "Total people must be a whole number from 1 to 100.";

    const vehicles: PackageInput["vehicles"] = [];
    for (const [vehicleClass, text] of Object.entries(prices)) {
      if (text.trim() === "") continue; // no price = not offered
      const price = Number(text);
      if (!Number.isFinite(price) || price < 0) return `Enter a valid price for ${vehicleClass}.`;
      vehicles.push({ vehicleClass, price });
    }

    return {
      name: name.trim(),
      description: description.trim(),
      tourLength: tourLength.trim(),
      totalPersons: persons,
      status,
      eventTypes: [...new Set(eventTypes.split(",").map((t) => t.trim()).filter(Boolean))],
      vehicles,
    };
  }

  async function save() {
    const input = buildInput();
    if (typeof input === "string") return setError(input);

    setSaving(true);
    setError(null);
    let saved: TourPackage;
    try {
      saved = targetId ? await updatePackage(targetId, input) : await createPackage(input);
    } catch (err) {
      setSaving(false);
      return setError(errorText(err, "Could not save that package"));
    }

    // Saved. If the picture then fails, stay open on this same package (so pressing Save
    // again updates it rather than creating a second copy) and say exactly what happened.
    setCreatedId(saved._id);
    try {
      if (picked) await uploadPackageImage(saved._id, picked);
    } catch (err) {
      setSaving(false);
      setError(`The package was saved, but its picture was not: ${errorText(err, "the upload failed")}. Press Save to try the picture again.`);
      await onChanged();
      return;
    }
    await onSaved();
    setSaving(false);
  }

  async function removeStoredImage() {
    if (!pkg) return;
    setSaving(true);
    setError(null);
    try {
      await removePackageImage(pkg._id);
      setImage(null);
      await onChanged();
    } catch (err) {
      setError(errorText(err, "Could not remove the picture"));
    } finally {
      setSaving(false);
    }
  }

  const previewSrc = pickedUrl ?? image?.src ?? null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={isNew ? "Add a package" : `Edit ${pkg.name}`}
      className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
    >
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 cursor-default bg-panel/50 backdrop-blur-[2px]" />

      <div className="relative flex max-h-[88dvh] w-full max-w-xl flex-col overflow-hidden rounded-card border border-border bg-surface-raised shadow-[var(--shadow-raised)]">
        <div className="flex items-center gap-3 border-b border-border-subtle px-5 py-4">
          <h2 className="text-action font-bold text-fg">{isNew ? "Add a package" : pkg.name}</h2>
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
            <p role="alert" className="rounded-field border border-danger/30 bg-danger/5 px-3.5 py-2.5 text-note font-bold text-danger">
              {error}
            </p>
          ) : null}

          <Field label="Package name">
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Wine Country Day" className={inputCls} />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Tour length" hint="For example “4 hours” or “Full day”.">
              <input value={tourLength} onChange={(e) => setTourLength(e.target.value)} maxLength={60} placeholder="8 hours" className={inputCls} />
            </Field>
            <Field label="Total people">
              <input type="number" min={1} max={100} step={1} value={totalPersons} onChange={(e) => setTotalPersons(e.target.value)} className={inputCls} />
            </Field>
          </div>

          <Field label="Short description">
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} rows={3} className={`${inputCls} h-auto py-2`} />
          </Field>

          <Field label="Event types" hint="Separate with commas, for example “Wedding, Wine Tasting”.">
            <input value={eventTypes} onChange={(e) => setEventTypes(e.target.value)} placeholder="Wine Tasting, Birthday" className={inputCls} />
          </Field>

          <div className="rounded-field border border-border bg-surface p-3.5">
            <h3 className="text-meta font-bold text-fg">Picture</h3>
            {previewSrc ? (
              // eslint-disable-next-line @next/next/no-img-element -- admin-only preview
              <img src={previewSrc} alt="" className="mt-3 h-36 w-full rounded-field object-cover" />
            ) : (
              <p className="mt-2 text-note text-fg-muted">No picture yet. JPEG, PNG or WebP, up to 5 MB.</p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label className="inline-flex h-9 cursor-pointer items-center rounded-field border border-border bg-surface-raised px-3 text-label font-bold text-fg-body hover:border-accent">
                {previewSrc ? "Change picture" : "Choose picture"}
                <input
                  type="file"
                  accept={PACKAGE_IMAGE_TYPES.join(",")}
                  className="sr-only"
                  onChange={(e) => {
                    pickFile(e.target.files);
                    e.target.value = "";
                  }}
                />
              </label>
              {picked ? (
                <button type="button" onClick={() => setPicked(null)} className="text-note font-bold text-fg-body hover:underline">
                  Undo
                </button>
              ) : image ? (
                <button type="button" disabled={saving} onClick={() => void removeStoredImage()} className="text-note font-bold text-danger hover:underline disabled:opacity-50">
                  Remove picture
                </button>
              ) : null}
            </div>
          </div>

          <div className="rounded-field border border-border bg-surface p-3.5">
            <h3 className="text-meta font-bold text-fg">Vehicles and prices</h3>
            <p className="mt-1 text-note text-fg-muted">The fixed price for the whole package. Leave a price empty to not offer that vehicle.</p>
            {classes === null ? (
              <p className="mt-3 text-note text-fg-muted">Loading vehicles…</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {classes.map((c) => (
                  <PriceRow key={c.value} label={c.label} detail={`${c.seats} seats · ${c.bags} bags`} value={prices[c.value] ?? ""} onChange={(v) => setPrices((p) => ({ ...p, [c.value]: v }))} />
                ))}
                {retired.map((value) => (
                  <PriceRow key={value} label={value} detail="No longer on sale" value={prices[value] ?? ""} onChange={(v) => setPrices((p) => ({ ...p, [value]: v }))} />
                ))}
              </ul>
            )}
          </div>

          <label className="flex items-center gap-2.5 rounded-field border border-border bg-surface px-3.5 py-3">
            <input
              type="checkbox"
              checked={status === "visible"}
              onChange={(e) => setStatus(e.target.checked ? "visible" : "hidden")}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            <span className="text-meta text-fg">Visible (listed on the booking page)</span>
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border-subtle px-5 py-3">
          <button type="button" onClick={onClose} className="h-10 rounded-field border border-border bg-surface-raised px-4 text-meta font-bold text-fg-body">
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void save()}
            className="h-10 rounded-field bg-primary px-5 text-meta font-bold text-primary-fg disabled:opacity-60"
          >
            {saving ? "Saving…" : isNew ? "Add package" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputCls =
  "h-10 w-full rounded-field border border-border bg-surface px-3 text-meta text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none";

function PriceRow({ label, detail, value, onChange }: { label: string; detail: string; value: string; onChange: (value: string) => void }) {
  return (
    <li className="flex items-center gap-3">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-meta font-bold text-fg">{label}</span>
        <span className="block truncate text-note text-fg-muted">{detail}</span>
      </span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="text-meta text-fg-muted">$</span>
        <input
          type="number"
          min={0}
          step="any"
          inputMode="decimal"
          value={value}
          placeholder="—"
          aria-label={`Price for ${label}`}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-28 rounded-field border border-border bg-surface-raised px-3 text-meta font-bold text-fg focus:border-accent focus:outline-none"
        />
      </span>
    </li>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label className="block">
        <span className="block text-note font-medium uppercase tracking-wider text-fg-muted">{label}</span>
        <span className="mt-1.5 block">{children}</span>
      </label>
      {hint ? <p className="mt-1.5 text-note leading-relaxed text-fg-faint">{hint}</p> : null}
    </div>
  );
}

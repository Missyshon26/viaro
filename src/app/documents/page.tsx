"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Card, Kicker, WarnBox } from "@/components/ui/Surfaces";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import {
  deleteDocument,
  getMyDocuments,
  openDocument,
  setDocumentProfile,
  uploadDocument,
  type BusinessDetails,
  type DocumentRequirement,
  type DriverDocumentFile,
  type MyDocuments,
  type OperatorType,
} from "@/lib/api/driver";
import { ApiError } from "@/lib/api/client";

/**
 * Documents, by operator type.
 *
 * Operations' requirements (Sept 2026):
 *
 *   Independent — chauffeur credential, COI naming All Black Limo, driver's license,
 *   vehicle registration, passed inspection, license plate, headshot, W-9.
 *   Company — legal name & entity type, active registration + UBI (entered here), then
 *   municipal business license, WA DOL limousine carrier license, fleet COI and every
 *   driver's license.
 *
 * The list of requirements comes from the API, so a change there needs no release here.
 * Files are now really stored (they used to be "registered" by name only).
 */

const ENTITY_TYPES = [
  "Limited Liability Company (LLC)",
  "Corporation",
  "Sole proprietorship",
  "Partnership",
  "Other",
];
const REGISTRATION_STATUSES = ["Active", "Inactive", "Pending"];

const errorText = (err: unknown, fallback: string) =>
  err instanceof ApiError ? err.message : fallback;

export default function DocumentsPage() {
  const [data, setData] = useState<MyDocuments | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      getMyDocuments()
        .then((next) => {
          setData(next);
          setError(null);
        })
        .catch((err) => setError(errorText(err, "Could not load your documents"))),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const operatorType = data?.operatorType ?? null;
  const requirements = operatorType ? (data?.requirements[operatorType] ?? []) : [];
  const done = requirements.filter((r) => data?.files.some((f) => f.type === r.type && f.status !== "rejected")).length;

  return (
    <div className="mx-auto max-w-[1050px]">
      <h1 className="text-[1.5rem] font-bold tracking-tight text-fg">Documents</h1>
      <p className="mt-2 text-note text-fg-muted">
        Everything we need before you can take bookings. PDF or photo, up to 10 MB each.
      </p>

      {error ? <p className="mt-4 text-note font-bold text-danger">{error}</p> : null}

      {data ? (
        <div className="mt-6 space-y-4">
          <OperatorPicker
            current={operatorType}
            onPick={async (type) => {
              try {
                setData(await setDocumentProfile(type));
              } catch (err) {
                setError(errorText(err, "Could not save your choice"));
              }
            }}
          />

          {operatorType ? (
            <>
              <Card className="flex flex-wrap items-center gap-4 p-5">
                <div className="min-w-0 flex-1">
                  <Kicker>Progress</Kicker>
                  <p className="mt-1 text-body font-bold text-fg">
                    {data.complete
                      ? "All documents submitted"
                      : `${done} of ${requirements.length} documents${
                          operatorType === "company" ? " and your company details" : ""
                        }`}
                  </p>
                  <p className="mt-0.5 text-note text-fg-muted">
                    {data.complete
                      ? "Our team reviews each one. You'll be able to go online now."
                      : "Your account stays in review until the set is complete."}
                  </p>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-surface sm:w-56">
                  <div
                    className="h-full rounded-full bg-accent transition-all"
                    style={{
                      width: `${requirements.length ? Math.round((done / requirements.length) * 100) : 0}%`,
                    }}
                  />
                </div>
              </Card>

              {operatorType === "company" ? (
                <BusinessForm business={data.business} onSaved={setData} />
              ) : null}

              <Card className="p-0">
                <div className="px-5 pt-5">
                  <Kicker>{operatorType === "company" ? "Company documents" : "Your documents"}</Kicker>
                </div>
                <ul className="mt-3 divide-y divide-border">
                  {requirements.map((req) => (
                    <RequirementRow
                      key={req.type}
                      requirement={req}
                      files={data.files.filter((f) => f.type === req.type)}
                      onChange={setData}
                      onError={setError}
                    />
                  ))}
                </ul>
              </Card>

              <WarnBox title="Keep them current">
                Dispatch stops the day a document lapses. Add the expiry date where we ask for it
                and upload the renewal before then — a new upload replaces the old one.
              </WarnBox>
            </>
          ) : null}
        </div>
      ) : !error ? (
        <p className="mt-6 text-note text-fg-muted">Loading…</p>
      ) : null}
    </div>
  );
}

/* ------------------------------ operator type ------------------------------ */

function OperatorPicker({
  current,
  onPick,
}: {
  current: OperatorType | null;
  onPick: (type: OperatorType) => void;
}) {
  const options: { type: OperatorType; title: string; body: string }[] = [
    {
      type: "independent",
      title: "Independent chauffeur",
      body: "You drive your own vehicle under your own name.",
    },
    {
      type: "company",
      title: "Company",
      body: "You operate as a registered business, with a fleet or other drivers.",
    },
  ];
  return (
    <Card className="p-5">
      <Kicker>How do you operate?</Kicker>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {options.map((option) => {
          const selected = current === option.type;
          return (
            <button
              key={option.type}
              type="button"
              onClick={() => onPick(option.type)}
              aria-pressed={selected}
              className={`rounded-field border p-4 text-left transition-colors ${
                selected ? "border-accent bg-accent-soft" : "border-border hover:border-accent"
              }`}
            >
              <p className="text-meta font-bold text-fg">{option.title}</p>
              <p className="mt-1 text-note text-fg-muted">{option.body}</p>
            </button>
          );
        })}
      </div>
      {current ? (
        <p className="mt-3 text-note text-fg-muted">
          Changing this changes the list below. Files you already uploaded are kept.
        </p>
      ) : null}
    </Card>
  );
}

/* ----------------------------- company details ----------------------------- */

function BusinessForm({
  business,
  onSaved,
}: {
  business: BusinessDetails;
  onSaved: (next: MyDocuments) => void;
}) {
  const [values, setValues] = useState<BusinessDetails>(business);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (key: keyof BusinessDetails) => (value: string) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  const selectCls =
    "mt-0.5 w-full bg-transparent text-body font-bold text-fg outline-none";

  return (
    <Card className="p-5">
      <Kicker>Company details</Kicker>
      <form
        className="mt-4 grid gap-3 sm:grid-cols-2"
        onSubmit={async (event) => {
          event.preventDefault();
          setPending(true);
          setMessage(null);
          try {
            onSaved(await setDocumentProfile("company", values));
            setMessage({ ok: true, text: "Company details saved." });
          } catch (err) {
            setMessage({ ok: false, text: errorText(err, "Could not save your details") });
          } finally {
            setPending(false);
          }
        }}
      >
        <TextField
          label="Legal name"
          value={values.legalName ?? ""}
          onChange={(e) => set("legalName")(e.target.value)}
          placeholder="As registered with the state"
          required
          className="sm:col-span-2"
        />
        <SelectBox label="Entity type" value={values.entityType ?? ""} onChange={set("entityType")} className={selectCls}>
          <option value="" disabled>
            Select…
          </option>
          {ENTITY_TYPES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </SelectBox>
        <SelectBox
          label="Registration status"
          value={values.registrationStatus ?? ""}
          onChange={set("registrationStatus")}
          className={selectCls}
        >
          <option value="" disabled>
            Select…
          </option>
          {REGISTRATION_STATUSES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </SelectBox>
        <TextField
          label="UBI or state registration number"
          value={values.ubiNumber ?? ""}
          onChange={(e) => set("ubiNumber")(e.target.value)}
          placeholder="e.g. 604 123 456"
          required
          className="sm:col-span-2"
        />
        {values.registrationStatus && values.registrationStatus !== "Active" ? (
          <p className="text-note font-bold text-danger sm:col-span-2">
            Your registration must be active before you can take bookings.
          </p>
        ) : null}
        <div className="flex items-center gap-3 sm:col-span-2">
          <Button type="submit" variant="accent" disabled={pending}>
            {pending ? "Saving…" : "Save details"}
          </Button>
          {message ? (
            <p className={`text-note font-bold ${message.ok ? "text-success" : "text-danger"}`}>{message.text}</p>
          ) : null}
        </div>
      </form>
    </Card>
  );
}

function SelectBox({
  label,
  value,
  onChange,
  className,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block rounded-field border border-border bg-surface px-3.5 py-2.5">
      <span className="block text-label font-bold text-fg-muted">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={className}>
        {children}
      </select>
    </label>
  );
}

/* ------------------------------- one document ------------------------------ */

const STATUS: Record<DriverDocumentFile["status"], { label: string; cls: string }> = {
  submitted: { label: "In review", cls: "bg-accent-soft text-accent-strong" },
  approved: { label: "Approved", cls: "bg-success/15 text-success" },
  rejected: { label: "Rejected — upload again", cls: "bg-danger/15 text-danger" },
};

function RequirementRow({
  requirement,
  files,
  onChange,
  onError,
}: {
  requirement: DocumentRequirement;
  files: DriverDocumentFile[];
  onChange: (next: MyDocuments) => void;
  onError: (message: string | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [expiresAt, setExpiresAt] = useState("");
  const [pending, setPending] = useState(false);
  const has = files.some((f) => f.status !== "rejected");

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      onError(`${file.name} is larger than 10 MB.`);
      return;
    }
    setPending(true);
    onError(null);
    try {
      onChange(await uploadDocument(requirement.type, file, expiresAt || undefined));
      setExpiresAt("");
    } catch (err) {
      onError(errorText(err, "Upload failed"));
    } finally {
      setPending(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-start gap-3">
        <span
          aria-hidden
          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
            has ? "bg-success text-white" : "border border-border text-fg-muted"
          }`}
        >
          {has ? "✓" : ""}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-meta font-bold text-fg">
            {requirement.label}
            {requirement.multiple ? <span className="ml-2 font-normal text-fg-muted">(one per driver)</span> : null}
          </p>
          <p className="mt-0.5 text-note text-fg-muted">{requirement.description}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {requirement.expires ? (
            <label className="flex items-center gap-2 text-note text-fg-muted">
              Expires
              <input
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                className="rounded-field border border-border bg-surface px-2 py-1.5 text-note text-fg"
              />
            </label>
          ) : null}
          <input
            ref={input}
            type="file"
            accept={requirement.imageOnly ? "image/*" : ".pdf,image/*"}
            className="hidden"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
          <Button
            type="button"
            variant={has && !requirement.multiple ? "secondary" : "accent"}
            disabled={pending}
            onClick={() => input.current?.click()}
          >
            {pending ? "Uploading…" : has ? (requirement.multiple ? "Add another" : "Replace") : "Upload"}
          </Button>
        </div>
      </div>

      {files.length > 0 ? (
        <ul className="ml-8 mt-3 space-y-2">
          {files.map((file) => (
            <FileLine key={file._id} file={file} onChange={onChange} onError={onError} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function FileLine({
  file,
  onChange,
  onError,
}: {
  file: DriverDocumentFile;
  onChange: (next: MyDocuments) => void;
  onError: (message: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  // Read once per mount: "expired" does not need to tick over while the page is open.
  const [renderedAt] = useState(() => Date.now());
  const status = STATUS[file.status];
  const expired = file.expiresAt ? new Date(file.expiresAt).getTime() < renderedAt : false;

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-field bg-surface px-3 py-2 text-note">
      <button
        type="button"
        className="min-w-0 max-w-[18rem] truncate font-bold text-accent hover:underline"
        onClick={async () => {
          try {
            const blob = await openDocument(file._id);
            const url = URL.createObjectURL(blob);
            window.open(url, "_blank", "noopener");
            setTimeout(() => URL.revokeObjectURL(url), 60_000);
          } catch (err) {
            onError(errorText(err, "Could not open that document"));
          }
        }}
      >
        {file.fileName}
      </button>
      <span className="text-fg-muted">
        {(file.sizeBytes / 1024 / 1024).toFixed(file.sizeBytes > 1024 * 1024 ? 1 : 2)} MB
        {file.expiresAt
          ? ` · ${expired ? "expired" : "expires"} ${new Date(file.expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`
          : ""}
      </span>
      <span className="ml-auto flex items-center gap-2">
        {expired ? <Badge tone="panel">Expired</Badge> : null}
        <span className={`rounded-full px-2.5 py-0.5 text-label font-bold ${status.cls}`}>{status.label}</span>
        {file.status !== "approved" ? (
          <button
            type="button"
            disabled={busy}
            className="text-label font-bold text-fg-muted hover:text-danger"
            onClick={async () => {
              setBusy(true);
              try {
                onChange(await deleteDocument(file._id));
              } catch (err) {
                onError(errorText(err, "Could not remove it"));
              } finally {
                setBusy(false);
              }
            }}
          >
            Remove
          </button>
        ) : null}
      </span>
    </li>
  );
}

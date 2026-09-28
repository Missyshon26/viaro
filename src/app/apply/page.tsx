"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Badge, Card, Kicker, WarnBox } from "@/components/ui/Surfaces";
import { Button, buttonClass } from "@/components/ui/Button";
import {
  applyAsDriver,
  getMyDriver,
  listVehicleClasses,
  type DriverProfile,
  type VehicleClassInfo,
} from "@/lib/api/driver";
import { ApiError } from "@/lib/api/client";
import { useAuth } from "@/lib/auth/AuthProvider";

/** Figma driver "02 · Apply" / "04 · Verification pending". */

const inputClass =
  "w-full rounded-field border border-border bg-surface-raised px-3 py-2 text-note text-fg outline-none";

/**
 * Driver application.
 *
 * Registering as a driver already creates the profile, so this exists for an account
 * that needs to (re)apply — after a rejection, or when switching vehicle class. The
 * account is held at `pending_documents` until the licence and insurance are on file.
 */
export default function ApplyPage() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [classes, setClasses] = useState<VehicleClassInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      getMyDriver()
        .then(setProfile)
        .catch(() => undefined),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // The catalogue supplies the human label for the driver's vehicle class.
  useEffect(() => {
    listVehicleClasses()
      .then(setClasses)
      .catch(() => undefined);
  }, []);

  const labelFor = useMemo(() => {
    const byValue = new Map(classes.map((c) => [c.value, c.label]));
    // Falls back to the raw value so the row still renders before the catalogue loads.
    return (value?: string) => (value ? (byValue.get(value) ?? value) : "");
  }, [classes]);

  const pending = user?.status === "pending_documents";
  const documents = profile?.driver.documents ?? [];

  return (
    <div className="mx-auto max-w-[1050px]">
      <h1 className="text-[1.5rem] font-bold tracking-tight text-fg">
        Your application
      </h1>
      <p className="mt-2 text-note text-fg-muted">
        What we need before dispatch can offer you a booking.
      </p>

      {error ? <p className="mt-4 text-note font-bold text-danger">{error}</p> : null}

      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-start">
        <div className="space-y-4">
          <Card className="p-5">
            <div className="flex flex-wrap items-center gap-3">
              <Kicker>Status</Kicker>
              <span className="ml-auto">
                <Badge>{user?.status?.replace("_", " ") ?? "unknown"}</Badge>
              </span>
            </div>

            <p className="mt-4 text-note leading-relaxed text-fg-muted">
              {pending
                ? "Your account is held until your documents are reviewed. You will not receive booking offers until then."
                : "Your account is active. You can go online and take bookings."}
            </p>

            <dl className="mt-5 space-y-2 border-t border-border-subtle pt-4 text-meta">
              <div className="flex justify-between gap-4">
                <dt className="text-fg-muted">Vehicle class</dt>
                {/*
                  * The catalogue label, not a CSS-capitalised enum.
                  *
                  * `capitalize` on the raw value rendered "suv" as "Suv"; the requests and
                  * schedule screens already look the value up and correctly show
                  * "Business SUV".
                  */}
                <dd className="font-bold text-fg">
                  {labelFor(profile?.driver.vehicleClass) || "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-fg-muted">Files on record</dt>
                <dd className="font-bold text-fg">{documents.length}</dd>
              </div>
            </dl>

            <Link href="/documents" className={`${buttonClass("secondary", true)} mt-5`}>
              Manage documents
            </Link>
          </Card>

          <WarnBox title="Verification is not a one-time form">
            Dispatch is suspended automatically the day a document lapses, and resumes
            when a current one replaces it.
          </WarnBox>
        </div>

        <Card className="p-5">
          <Kicker>Apply or update</Kicker>
          <div className="mt-4">
            <ApplyForm
              classes={classes}
              current={profile?.driver.vehicleClass}
              onDone={load}
              onError={setError}
            />
          </div>
        </Card>
      </div>
    </div>
  );
}

function ApplyForm({
  classes,
  current,
  onDone,
  onError,
}: {
  classes: VehicleClassInfo[];
  /** The class on the driver's profile — pre-selected so a re-apply does not silently change it. */
  current?: string;
  onDone: () => void;
  onError: (message: string | null) => void;
}) {
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [chosen, setChosen] = useState("");

  const options = classes.length > 0 ? classes : current ? [{ value: current, label: current }] : [];
  const selected = chosen || current || options[0]?.value || "";

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setPending(true);
        onError(null);
        try {
          await applyAsDriver(String(form.get("vehicleClass")));
          setDone(true);
          onDone();
        } catch (err) {
          onError(err instanceof ApiError ? err.message : "Could not submit your application");
        } finally {
          setPending(false);
        }
      }}
      className="space-y-4"
    >
      <label className="block">
        <span className="text-label font-bold text-fg-muted">Vehicle class</span>
        {/* The catalogue is owned by operations; a hardcoded list showed 3 of its 6 classes. */}
        <select
          name="vehicleClass"
          value={selected}
          onChange={(event) => setChosen(event.target.value)}
          className={`${inputClass} mt-1`}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      {/* Documents are uploaded file by file on their own page, against the checklist for
          independent chauffeurs or companies — no longer pasted here as links. */}
      <p className="text-note leading-relaxed text-fg-muted">
        Upload your license, insurance and the rest on the{" "}
        <Link href="/documents" className="font-bold text-accent hover:underline">
          Documents
        </Link>{" "}
        page.
      </p>

      <Button type="submit" variant="accent" disabled={pending}>
        {pending ? "Submitting…" : "Submit application"}
      </Button>
      {done ? (
        <p className="text-note font-bold text-success">
          Submitted. Dispatch will review it.
        </p>
      ) : null}
    </form>
  );
}

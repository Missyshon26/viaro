"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PersonCell, StatusBadge } from "@/components/ui/Dashboard";
import { Button } from "@/components/ui/Button";
import { ConsolePage, DataTable, emptyActionClass, formatDate, type Column } from "@/components/ui/DataTable";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { IconClose } from "@/components/ui/Icons";
import { errorText } from "@/lib/api/client";
import {
  createClient,
  downloadClients,
  listClients,
  updateClient,
  type Client,
} from "@/lib/api/clients";
import {
  createPayload,
  emptyClientForm,
  formFromClient,
  updatePayload,
  type ClientFilters,
  type ClientFormValues,
} from "@/lib/clients";

/**
 * Clients: the customers, with the three things operations does to them — add one (a phone
 * booking, a corporate guest), correct their details, and download the list.
 *
 * Search and filters run on the server, so they cover every client rather than the page
 * that happens to be loaded, and the download uses exactly the same filters as the screen:
 * what you see narrowed to is what you get in the file.
 */

const PAGE_SIZE = 50;
const EMPTY_FILTERS: ClientFilters = { search: "", status: "", guest: "" };

export default function ClientsPage() {
  const [filters, setFilters] = useState<ClientFilters>(EMPTY_FILTERS);
  const [rows, setRows] = useState<Client[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"new" | Client | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<"xlsx" | "csv" | null>(null);

  /**
   * Debounced, and guarded against a slow response arriving after a newer one: typing
   * "ali" then "alice" must end on the "alice" list however the replies are ordered.
   */
  const request = useRef(0);
  const load = useCallback(async (next: ClientFilters, nextPage: number, append: boolean) => {
    const mine = ++request.current;
    try {
      const result = await listClients(next, nextPage, PAGE_SIZE);
      if (mine !== request.current) return;
      setRows((prev) => (append && prev ? [...prev, ...result.items] : result.items));
      setTotal(result.total);
      setPage(nextPage);
      setError(null);
    } catch (err) {
      if (mine !== request.current) return;
      setError(errorText(err, "Could not load clients"));
      if (!append) setRows([]);
    } finally {
      if (mine === request.current) setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void load(filters, 1, false), filters.search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [filters, load]);

  const reload = () => load(filters, 1, false);

  async function download(format: "xlsx" | "csv") {
    setDownloading(format);
    setError(null);
    try {
      await downloadClients(filters, format);
    } catch (err) {
      setError(errorText(err, "Could not download the list"));
    } finally {
      setDownloading(null);
    }
  }

  const columns: Column<Client>[] = [
    {
      key: "name",
      header: "Client",
      cell: (c) => (
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/users/${c._id}`} className="hover:text-accent">
            <PersonCell name={c.name} meta={c.email} />
          </Link>
          {c.isGuest ? <StatusBadge tone="info">Guest</StatusBadge> : null}
        </div>
      ),
    },
    { key: "phone", header: "Phone", cell: (c) => c.phone, secondary: true },
    {
      key: "status",
      header: "Status",
      cell: (c) => <StatusBadge status={c.status} />,
    },
    {
      key: "bookings",
      header: "Bookings",
      align: "right",
      cell: (c) => c.bookings,
    },
    {
      key: "last",
      header: "Last booking",
      align: "right",
      secondary: true,
      cell: (c) => (c.lastBookingAt ? formatDate(c.lastBookingAt) : "—"),
    },
    {
      key: "joined",
      header: "Joined",
      align: "right",
      secondary: true,
      cell: (c) => formatDate(c.createdAt),
    },
    {
      key: "edit",
      header: "",
      align: "right",
      cell: (c) => (
        <button
          type="button"
          onClick={() => setDialog(c)}
          className="rounded-field border border-border px-3 py-1.5 text-label font-bold text-fg hover:border-accent"
        >
          Edit
        </button>
      ),
    },
  ];

  const filtered = filters.search || filters.status || filters.guest;

  return (
    <ConsolePage
      title="Clients"
      description="Customers, and what you can do with them: add one, correct their details, download the list."
      action={
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" block={false} disabled={downloading !== null} onClick={() => download("xlsx")}>
            {downloading === "xlsx" ? "Preparing…" : "Download Excel"}
          </Button>
          <Button variant="secondary" block={false} disabled={downloading !== null} onClick={() => download("csv")}>
            {downloading === "csv" ? "Preparing…" : "CSV"}
          </Button>
          <Button block={false} onClick={() => setDialog("new")}>
            Add client
          </Button>
        </div>
      }
    >
      {notice ? (
        <p role="status" className="mb-4 rounded-field border border-border bg-surface px-4 py-3 text-note font-bold text-fg">
          {notice}
        </p>
      ) : null}
      {error ? <p className="mb-4 text-note font-bold text-danger">{error}</p> : null}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={filters.search}
          onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
          placeholder="Search name, email, phone…"
          aria-label="Search clients"
          className="h-10 w-full max-w-xs rounded-field border border-border bg-surface px-3 text-meta text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none"
        />
        <select
          value={filters.status}
          onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value as ClientFilters["status"] }))}
          aria-label="Status"
          className="h-10 rounded-field border border-border bg-surface px-3 text-meta text-fg focus:border-accent focus:outline-none"
        >
          <option value="">Any status</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
        <select
          value={filters.guest}
          onChange={(e) => setFilters((f) => ({ ...f, guest: e.target.value as ClientFilters["guest"] }))}
          aria-label="Account type"
          className="h-10 rounded-field border border-border bg-surface px-3 text-meta text-fg focus:border-accent focus:outline-none"
        >
          <option value="">All accounts</option>
          <option value="true">Guest accounts</option>
          <option value="false">Registered accounts</option>
        </select>
        {filtered ? (
          <button
            type="button"
            onClick={() => setFilters(EMPTY_FILTERS)}
            className="text-note font-bold text-accent hover:underline"
          >
            Clear filters
          </button>
        ) : null}
        {rows ? (
          <span className="ml-auto text-note text-fg-muted">
            {total} client{total === 1 ? "" : "s"}
            {filtered ? " match" : ""}
          </span>
        ) : null}
      </div>

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(c) => c._id}
        minWidth="52rem"
        empty={{
          title: filtered ? "No clients match" : "No clients yet",
          description: filtered ? "Try a different search or clear the filters." : "Add one to get started.",
          action: filtered ? (
            <button type="button" className={emptyActionClass} onClick={() => setFilters(EMPTY_FILTERS)}>Clear filters</button>
          ) : (
            <button type="button" className={emptyActionClass} onClick={() => setDialog("new")}>Add a client</button>
          ),
        }}
      />

      {rows && rows.length < total ? (
        <div className="mt-4 flex justify-center">
          <Button
            variant="secondary"
            block={false}
            disabled={loadingMore}
            onClick={() => {
              setLoadingMore(true);
              void load(filters, page + 1, true);
            }}
          >
            {loadingMore ? "Loading…" : `Show more (${total - rows.length} left)`}
          </Button>
        </div>
      ) : null}

      {dialog ? (
        <ClientDialog
          client={dialog === "new" ? null : dialog}
          onClose={() => setDialog(null)}
          onSaved={async (message) => {
            setDialog(null);
            setNotice(message);
            await reload();
          }}
        />
      ) : null}
    </ConsolePage>
  );
}

/* ---------------------------------- dialog --------------------------------- */

function ClientDialog({
  client,
  onClose,
  onSaved,
}: {
  client: Client | null;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const isNew = client === null;
  const [form, setForm] = useState<ClientFormValues>(() => (client ? formFromClient(client) : emptyClientForm()));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const set = <K extends keyof ClientFormValues>(key: K, value: ClientFormValues[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  // Suspending locks someone out of their account, so it is confirmed before it is sent.
  const [confirmSuspend, setConfirmSuspend] = useState(false);
  const suspending = !isNew && form.status === "suspended" && client.status !== "suspended";

  function save(event: React.FormEvent) {
    event.preventDefault();
    if (suspending) {
      setConfirmSuspend(true);
      return;
    }
    void commit();
  }

  async function commit() {
    setSaving(true);
    setError(null);
    try {
      if (isNew) {
        const { user, inviteSent } = await createClient(createPayload(form));
        await onSaved(
          !form.sendInvite
            ? `${user.name} was added. No invitation was sent.`
            : inviteSent
              ? `${user.name} was added, and an email is on its way to set their password.`
              : `${user.name} was added, but the invitation email could not be sent. They can use "Forgot password" on the booking site.`,
        );
      } else {
        const changes = updatePayload(form, client);
        if (Object.keys(changes).length === 0) {
          onClose();
          return;
        }
        const user = await updateClient(client._id, changes);
        await onSaved(
          changes.status === "suspended"
            ? `${user.name} was suspended and signed out.`
            : `${user.name} was updated.`,
        );
      }
    } catch (err) {
      setError(errorText(err, "Could not save that client"));
      setSaving(false);
      // The error is shown in the form behind; close the question so it can be read.
      setConfirmSuspend(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={isNew ? "Add a client" : `Edit ${client.name}`}
      className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-panel/50 backdrop-blur-[2px]"
      />

      <form
        onSubmit={save}
        className="relative flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-card border border-border bg-surface-raised shadow-[var(--shadow-raised)]"
      >
        <div className="flex items-center gap-3 border-b border-border-subtle px-5 py-4">
          <h2 className="text-action font-bold text-fg">{isNew ? "Add a client" : client.name}</h2>
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

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Box label="First name">
              <input
                value={form.firstName}
                onChange={(e) => set("firstName", e.target.value)}
                required
                maxLength={60}
                autoFocus
                className={inputCls}
              />
            </Box>
            <Box label="Last name">
              <input
                value={form.lastName}
                onChange={(e) => set("lastName", e.target.value)}
                maxLength={60}
                className={inputCls}
              />
            </Box>
          </div>

          <Box
            label="Email"
            hint={isNew ? "They sign in with this." : "Changing it changes how they sign in."}
          >
            <input
              type="email"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              required
              className={inputCls}
            />
          </Box>

          <Box label="Phone" hint={isNew ? undefined : "A new number needs to be verified again."}>
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => set("phone", e.target.value)}
              required
              minLength={6}
              className={inputCls}
            />
          </Box>

          <fieldset className="space-y-3 rounded-field border border-border p-3.5">
            <legend className="px-1 text-note font-medium uppercase tracking-wider text-fg-muted">
              Address (optional)
            </legend>
            <Box label="Street address">
              <input value={form.line1} onChange={(e) => set("line1", e.target.value)} className={inputCls} />
            </Box>
            <Box label="Apartment, suite, etc.">
              <input value={form.line2} onChange={(e) => set("line2", e.target.value)} className={inputCls} />
            </Box>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Box label="City">
                <input value={form.city} onChange={(e) => set("city", e.target.value)} className={inputCls} />
              </Box>
              <Box label="State">
                <input value={form.state} onChange={(e) => set("state", e.target.value)} className={inputCls} />
              </Box>
              <Box label="Postal code">
                <input
                  value={form.postalCode}
                  onChange={(e) => set("postalCode", e.target.value)}
                  className={inputCls}
                />
              </Box>
            </div>
            <p className="text-note text-fg-muted">
              Street, city, state and postal code go together; leave all of them blank for no address.
            </p>
          </fieldset>

          {isNew ? (
            <label className="flex items-start gap-2.5 rounded-field border border-border bg-surface px-3.5 py-3">
              <input
                type="checkbox"
                checked={form.sendInvite}
                onChange={(e) => set("sendInvite", e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
              />
              <span className="text-meta text-fg">
                Email them a link to set their password
                <span className="block text-note text-fg-muted">
                  You never see or set a password. Untick for a client who will not use the site.
                </span>
              </span>
            </label>
          ) : (
            <Box
              label="Account status"
              hint="Suspending signs them out everywhere and stops them signing in until reinstated."
            >
              <select
                value={form.status}
                onChange={(e) => set("status", e.target.value as ClientFormValues["status"])}
                className={inputCls}
              >
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
                {client.status === "pending_documents" ? <option value="pending_documents">Pending documents</option> : null}
              </select>
            </Box>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border-subtle px-5 py-3">
          <Button type="button" variant="secondary" block={false} onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" block={false} loading={saving}>
            {isNew ? "Add client" : "Save changes"}
          </Button>
        </div>

        <ConfirmDialog
          open={confirmSuspend}
          title={`Suspend ${client?.name ?? "this client"}?`}
          confirmLabel="Suspend and sign out"
          pendingLabel="Suspending…"
          danger
          pending={saving}
          onConfirm={() => void commit()}
          onCancel={() => setConfirmSuspend(false)}
        >
          <p>They will be signed out everywhere straight away and cannot sign in until you reinstate them.</p>
          <p>Their bookings, wallet and history are kept. Trips already booked are not cancelled.</p>
        </ConfirmDialog>
      </form>
    </div>
  );
}

const inputCls =
  "h-10 w-full rounded-field border border-border bg-surface px-3 text-meta text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none";

/** The input sits INSIDE the label, so clicking the text focuses it and screen readers announce it. */
function Box({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block">
        <span className="block text-note font-medium uppercase tracking-wider text-fg-muted">{label}</span>
        <span className="mt-1.5 block">{children}</span>
      </label>
      {hint ? <p className="mt-1.5 text-note text-fg-muted">{hint}</p> : null}
    </div>
  );
}

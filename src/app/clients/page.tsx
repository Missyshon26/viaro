"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PersonCell, StatusBadge } from "@/components/ui/Dashboard";
import { Button } from "@/components/ui/Button";
import { ConsolePage, DataTable, emptyActionClass, formatDate, type Column } from "@/components/ui/DataTable";
import { AccountDialog } from "@/components/ops/AccountDialog";
import { errorText } from "@/lib/api/client";
import { downloadClients, listClients, type Client } from "@/lib/api/clients";
import { type ClientFilters } from "@/lib/clients";

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
        <AccountDialog
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

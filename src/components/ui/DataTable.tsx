"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EmptyState, TableSkeleton } from "@/components/ui/Dashboard";
import { IconChevronDown, IconInbox, IconSearch } from "@/components/ui/Icons";

/**
 * The console workhorse: one table pattern for every list, so bookings, users, drivers
 * and reports all read the same. Columns render their own cell so a value can be a
 * badge, an avatar or a link without the table knowing about it.
 *
 * Search, sorting and pagination are all opt-in and all client-side. That is a
 * deliberate limit: the list endpoints behind these screens page on the server but do
 * not accept a query or a sort, so anything cleverer here would only be sorting the
 * page you happen to be looking at while implying it sorted the set. Pass `searchable`
 * or `sortValue` only where the table holds the whole collection.
 */
export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  align?: "left" | "right";
  /** Hidden below `lg` — for columns that are useful but not essential. */
  secondary?: boolean;
  /** Return a comparable value to make the column sortable. */
  sortValue?: (row: T) => string | number;
}

export function DataTable<T>({
  rows,
  columns,
  empty,
  loading,
  rowKey,
  searchable,
  searchPlaceholder = "Search…",
  pageSize,
  remote,
  onPageSizeChange,
  toolbar,
  mobileCard,
  rowHref,
}: {
  rows: T[] | null;
  columns: Column<T>[];
  empty: { title: string; description?: string; action?: ReactNode };
  loading?: boolean;
  rowKey: (row: T, index: number) => string;
  minWidth?: string;
  /** Free-text fields to match against. Omit to hide the search box. */
  searchable?: (row: T) => (string | number | null | undefined)[];
  searchPlaceholder?: string;
  /** Rows per page. Omit to render every row. */
  pageSize?: number;
  /**
   * Server-driven mode: `rows` is already ONE page, filtered and searched by the API, so the
   * table neither filters, sorts nor slices it. Search text and the page number live with the
   * caller, which refetches when they change.
   */
  remote?: { query: string; onQuery: (query: string) => void; page: number; total: number; onPage: (page: number) => void };
  onPageSizeChange?: (size: number) => void;
  /** Filters or actions shown beside the search box. */
  toolbar?: ReactNode;
  /**
   * Optional custom card rendering for narrow screens. Defaults to labeled fields.
   */
  mobileCard?: (row: T) => ReactNode;
  /**
   * Makes each row open a record. Supplying it turns the row into a link target.
   *
   * The row click is a convenience for the mouse, not the mechanism: the caller is
   * expected to render a real <Link> inside one cell so the row is reachable by keyboard
   * and openable in a new tab. A div with an onClick would be neither.
   */
  rowHref?: (row: T) => string;
}) {
  const [localQuery, setLocalQuery] = useState("");
  const query = remote ? remote.query : localQuery;
  const setQuery = (value: string) => (remote ? remote.onQuery(value) : setLocalQuery(value));
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);
  const [localPage, setLocalPage] = useState(1);
  const setPage = (value: number) => (remote ? remote.onPage(value) : setLocalPage(value));
  const router = useRouter();

  const filtered = useMemo(() => {
    if (!rows) return null;
    if (remote) return rows;
    if (!searchable || !query.trim()) return rows;
    const needle = query.trim().toLowerCase();
    return rows.filter((row) =>
      searchable(row).some((field) => String(field ?? "").toLowerCase().includes(needle)),
    );
  }, [rows, searchable, query, remote]);

  const sorted = useMemo(() => {
    if (!filtered || !sort) return filtered;
    const column = columns.find((c) => c.key === sort.key);
    if (!column?.sortValue) return filtered;
    const factor = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = column.sortValue!(a);
      const bv = column.sortValue!(b);
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * factor;
      return String(av).localeCompare(String(bv)) * factor;
    });
  }, [filtered, sort, columns]);

  const total = remote ? remote.total : (sorted?.length ?? 0);
  const pageCount = pageSize ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  const current = Math.min(remote ? remote.page : localPage, pageCount);
  const visible = useMemo(() => {
    if (!sorted) return null;
    if (!pageSize || remote) return sorted;
    const start = (current - 1) * pageSize;
    return sorted.slice(start, start + pageSize);
  }, [sorted, pageSize, current, remote]);

  function toggleSort(key: string) {
    setPage(1);
    setSort((prev) =>
      prev?.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" },
    );
  }

  const hasToolbar = Boolean(searchable || toolbar || columns.some((column) => column.sortValue));

  return (
    <div className="record-container rounded-card border border-border bg-surface-raised shadow-[var(--shadow-card)]">
      {hasToolbar ? (
        <div className="flex flex-wrap items-center gap-3 border-b border-border-subtle px-4 py-3">
          {searchable ? (
            <div className="relative min-w-0 basis-full flex-1 sm:basis-auto sm:max-w-xs">
              <span
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted"
              >
                <IconSearch size={15} />
              </span>
              <input
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                className="h-11 w-full rounded-field border border-border bg-surface pl-9 pr-3 text-meta text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none"
              />
            </div>
          ) : null}
          {toolbar ? <div className="flex flex-wrap items-center gap-2">{toolbar}</div> : null}
          {columns.some((column) => column.sortValue) ? <label className="record-sort flex flex-wrap items-center gap-2 text-label text-fg-muted">Sort by
            <select aria-label="Sort records" value={sort ? `${sort.key}:${sort.dir}` : ""} onChange={(event) => {
              const [key, dir] = event.target.value.split(":");
              setSort(key ? { key, dir: dir as "asc" | "desc" } : null); setPage(1);
            }} className="min-h-11 max-w-[190px] rounded-field border border-border bg-surface-raised px-2 text-fg">
              <option value="">Default order</option>
              {columns.filter((column) => column.sortValue).flatMap((column) => [<option key={`${column.key}:asc`} value={`${column.key}:asc`}>{column.header} ↑</option>, <option key={`${column.key}:desc`} value={`${column.key}:desc`}>{column.header} ↓</option>])}
            </select>
          </label> : null}
          {rows && searchable ? (
            <p className="ml-auto shrink-0 text-label text-fg-muted">
              {total} {total === 1 ? "result" : "results"}
            </p>
          ) : null}
        </div>
      ) : null}

      {rows === null || loading ? (
        <TableSkeleton />
      ) : total === 0 ? (
        <EmptyState
          icon={<IconInbox size={22} />}
          title={query ? "Nothing matches that search" : empty.title}
          description={query ? `No rows contain “${query}”.` : empty.description}
          action={query ? <button type="button" className="rounded-field border border-border px-4 py-2 text-note font-bold text-accent" onClick={() => { setQuery(""); setPage(1); }}>Clear search</button> : empty.action}
        />
      ) : (
        <>
          <ul className="record-cards divide-y divide-border-subtle">
            {visible!.map((row, index) => (
              <li key={rowKey(row, index)} className="space-y-4 px-4 py-5 sm:px-6">
                {mobileCard ? mobileCard(row) : <DefaultCard row={row} columns={columns} />}
                {rowHref ? <Link href={rowHref(row)} className="inline-flex min-h-11 items-center rounded-field border border-border px-4 text-note font-bold text-accent">View details <span aria-hidden className="ml-2">→</span></Link> : null}
              </li>
            ))}
          </ul>

          <div className="record-table">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border-subtle bg-surface/60">
                  {columns.map((column) => {
                    const active = sort?.key === column.key;
                    return (
                      <th
                        key={column.key}
                        scope="col"
                        aria-sort={
                          active ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined
                        }
                        className={`px-4 py-3 text-label font-semibold text-fg-muted ${
                          column.align === "right" ? "text-right" : ""
                        } ${column.secondary ? "hidden lg:table-cell" : ""}`}
                      >
                        {column.sortValue ? (
                          <button
                            type="button"
                            onClick={() => toggleSort(column.key)}
                            className={`inline-flex items-center gap-1 transition-colors hover:text-fg ${
                              active ? "text-accent-strong" : ""
                            }`}
                          >
                            {column.header}
                            <IconChevronDown
                              size={12}
                              className={`transition-transform ${
                                active && sort!.dir === "desc" ? "rotate-180" : ""
                              } ${active ? "opacity-100" : "opacity-35"}`}
                            />
                          </button>
                        ) : (
                          column.header
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle text-meta">
                {visible!.map((row, index) => {
                  const href = rowHref?.(row);
                  return (
                    <tr
                      key={rowKey(row, index)}
                      // Ignore clicks that landed on a link or control inside the row —
                      // otherwise a nested action would also trigger the navigation.
                      tabIndex={href ? 0 : undefined}
                      onKeyDown={href ? (event) => {
                        if (event.target !== event.currentTarget) return;
                        if (event.key === "Enter") router.push(href);
                      } : undefined}
                      onClick={
                        href
                          ? (event) => {
                              const target = event.target as HTMLElement;
                              if (target.closest("a,button,input,select")) return;
                              router.push(href);
                            }
                          : undefined
                      }
                      className={`transition-colors hover:bg-surface/70 ${
                        href ? "cursor-pointer" : ""
                      }`}
                    >
                      {columns.map((column) => (
                        <td
                          key={column.key}
                          className={`px-4 py-4 align-middle text-fg ${
                            column.align === "right" ? "text-right" : ""
                          } ${column.secondary ? "hidden lg:table-cell" : ""}`}
                        >
                          {column.cell(row)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {pageSize && (pageCount > 1 || onPageSizeChange) ? (
            <div className="flex flex-wrap items-center gap-3 border-t border-border-subtle px-4 py-3">
              <p aria-live="polite" className="text-label text-fg-muted">
                Showing {(current - 1) * pageSize + 1}–{Math.min(current * pageSize, total)} of {total} records
              </p>
              {onPageSizeChange && <label className="flex items-center gap-2 text-label text-fg-muted">Rows per page<select aria-label="Rows per page" value={pageSize} onChange={(event) => { setPage(1); onPageSizeChange(Number(event.target.value)); }} className="h-10 rounded-field border border-border bg-surface-raised px-2 text-fg">{[10, 20, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}</select></label>}
              <nav aria-label="Table pagination" className="ml-auto flex flex-wrap items-center gap-1.5">
                {onPageSizeChange && <PageButton disabled={current === 1} onClick={() => setPage(1)} label="First" />}
                <PageButton
                  disabled={current === 1}
                  onClick={() => setPage(current - 1)}
                  label="Previous"
                />
                {onPageSizeChange ? <div className="hidden items-center gap-1 sm:flex">{Array.from({ length: Math.min(5, pageCount) }, (_, index) => Math.max(1, Math.min(current - 2, pageCount - 4)) + index).map((number) => <button key={number} type="button" aria-label={`Page ${number}`} aria-current={number === current ? "page" : undefined} onClick={() => setPage(number)} className={`h-10 min-w-10 rounded-field border px-2 text-label font-semibold ${number === current ? "border-accent/30 bg-accent-soft text-accent-strong" : "border-border text-fg-muted hover:bg-surface"}`}>{number}</button>)}</div> : null}
                <span className={`px-1 text-label font-bold text-fg ${onPageSizeChange ? "sm:hidden" : ""}`}>{current} / {pageCount}</span>
                <PageButton
                  disabled={current === pageCount}
                  onClick={() => setPage(current + 1)}
                  label="Next"
                />
                {onPageSizeChange && <PageButton disabled={current === pageCount} onClick={() => setPage(pageCount)} label="Last" />}
              </nav>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

/**
 * The narrow-screen card: the first column is the heading, a column with no header is
 * the action footer, and everything else is a small label/value grid in between — so a
 * row reads as one record rather than a stack of unlabeled fields.
 */
function DefaultCard<T>({ row, columns }: { row: T; columns: Column<T>[] }) {
  const [head, ...rest] = columns;
  const actions = rest.filter((column) => !column.header);
  const fields = rest.filter((column) => column.header);
  return (
    <div className="space-y-4">
      {head ? <div className="min-w-0 text-fg">{head.cell(row)}</div> : null}
      {fields.length ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          {fields.map((column) => (
            <div key={column.key} className="min-w-0">
              <dt className="text-label font-medium text-fg-muted">{column.header}</dt>
              <dd className="mt-1 min-w-0 break-words text-meta text-fg">{column.cell(row)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {actions.map((column) => {
        const cell = column.cell(row);
        return cell ? (
          <div key={column.key} className="flex flex-wrap justify-end gap-2">
            {cell}
          </div>
        ) : null;
      })}
    </div>
  );
}

function PageButton({
  disabled,
  onClick,
  label,
}: {
  disabled: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="h-10 rounded-field border border-border bg-surface-raised px-3 text-label font-bold text-fg-body transition-colors hover:border-accent hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border disabled:hover:text-fg-body"
    >
      {label}
    </button>
  );
}

/** Page heading used above every table. */
/** The look of the one button an empty table offers, so every empty state reads the same. */
export const emptyActionClass =
  "inline-flex min-h-11 items-center rounded-field border border-border bg-surface-raised px-4 text-note font-bold text-accent transition-colors hover:border-accent";

export function ConsolePage({
  title,
  description,
  action,
  children,
  width = "wide",
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  /** Dashboards want the full measure; forms and single tables read better narrower. */
  width?: "wide" | "narrow";
}) {
  return (
    <div className={`mx-auto ${width === "wide" ? "max-w-[1400px]" : "max-w-[1100px]"}`}>
      {/* The actions wrap under the title when they do not fit beside it, instead of squeezing the title to a sliver. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="min-w-0 sm:min-w-[18rem]">
          <h1 className="text-[1.75rem] font-semibold tracking-tight text-fg">{title}</h1>
          {description ? (
            <p className="mt-2 max-w-2xl text-body leading-relaxed text-fg-muted">
              {description}
            </p>
          ) : null}
        </div>
        {action ? <div className="max-w-full sm:ml-auto">{action}</div> : null}
      </div>

      <div className="mt-6">{children}</div>
    </div>
  );
}

export const money = (amount: number | undefined | null) =>
  typeof amount === "number"
    ? amount.toLocaleString("en-US", { style: "currency", currency: "USD" })
    : "—";

export function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

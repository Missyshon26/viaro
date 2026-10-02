"use client";

import { useMemo, useState, type ReactNode } from "react";
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
  minWidth = "44rem",
  searchable,
  searchPlaceholder = "Search…",
  pageSize,
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
  /** Filters or actions shown beside the search box. */
  toolbar?: ReactNode;
  /**
   * Card rendering for narrow screens. Without it the table scrolls horizontally
   * inside its own container, which is fine for short rows and poor for wide ones.
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
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);
  const [page, setPage] = useState(1);
  const router = useRouter();

  const filtered = useMemo(() => {
    if (!rows) return null;
    if (!searchable || !query.trim()) return rows;
    return rows.filter((row) => matchesQuery(query, searchable(row)));
  }, [rows, searchable, query]);

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

  const total = sorted?.length ?? 0;
  const pageCount = pageSize ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  const current = Math.min(page, pageCount);
  const visible = useMemo(() => {
    if (!sorted) return null;
    if (!pageSize) return sorted;
    const start = (current - 1) * pageSize;
    return sorted.slice(start, start + pageSize);
  }, [sorted, pageSize, current]);

  function toggleSort(key: string) {
    setPage(1);
    setSort((prev) =>
      prev?.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" },
    );
  }

  const hasToolbar = Boolean(searchable || toolbar);

  return (
    <div className="overflow-hidden rounded-card border border-border bg-surface-raised shadow-[var(--shadow-card)]">
      {hasToolbar ? (
        <div className="flex flex-wrap items-center gap-3 border-b border-border-subtle px-4 py-3">
          {searchable ? (
            <SearchInput
              value={query}
              onChange={(value) => {
                setQuery(value);
                setPage(1);
              }}
              placeholder={searchPlaceholder}
            />
          ) : null}
          {toolbar ? <div className="flex flex-wrap items-center gap-2">{toolbar}</div> : null}
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
          action={query ? null : empty.action}
        />
      ) : (
        <>
          {/* Cards below `md` when the caller supplies a renderer. */}
          {mobileCard ? (
            <ul className="divide-y divide-border-subtle md:hidden">
              {visible!.map((row, index) => (
                <li key={rowKey(row, index)} className="px-4 py-3.5">
                  {mobileCard(row)}
                </li>
              ))}
            </ul>
          ) : null}

          <div className={`overflow-x-auto ${mobileCard ? "hidden md:block" : ""}`}>
            <table className="w-full text-left" style={{ minWidth }}>
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
                        className={`px-5 py-3 text-note font-bold uppercase tracking-wider text-fg-body ${
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
                          className={`px-5 py-3.5 align-middle text-fg ${
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

          {pageSize && pageCount > 1 ? (
            <div className="flex flex-wrap items-center gap-3 border-t border-border-subtle px-4 py-3">
              <p className="text-label text-fg-muted">
                {(current - 1) * pageSize + 1}–{Math.min(current * pageSize, total)} of {total}
              </p>
              <div className="ml-auto flex items-center gap-1.5">
                <PageButton
                  disabled={current === 1}
                  onClick={() => setPage(current - 1)}
                  label="Previous"
                />
                <span className="px-1 text-label font-bold text-fg">
                  {current} / {pageCount}
                </span>
                <PageButton
                  disabled={current === pageCount}
                  onClick={() => setPage(current + 1)}
                  label="Next"
                />
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

/**
 * The table's search box, exported for lists that are not a DataTable (the roster and
 * penalties are cards) so every screen searches with the same control.
 */
export function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="relative min-w-0 flex-1 sm:max-w-xs">
      <span
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted"
      >
        <IconSearch size={15} />
      </span>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-9 w-full rounded-field border border-border bg-surface pl-9 pr-3 text-meta text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none"
      />
    </div>
  );
}

/** Case-insensitive "does any field contain the query" — the rule DataTable uses. */
export function matchesQuery(query: string, fields: (string | number | null | undefined)[]) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return fields.some((field) => String(field ?? "").toLowerCase().includes(needle));
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
      className="h-8 rounded-field border border-border bg-surface-raised px-3 text-label font-bold text-fg-body transition-colors hover:border-accent hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border disabled:hover:text-fg-body"
    >
      {label}
    </button>
  );
}

/** Page heading used above every table. */
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0">
          <h2 className="text-[1.5rem] font-bold tracking-tight text-fg">{title}</h2>
          {description ? (
            <p className="mt-2 max-w-2xl text-note leading-relaxed text-fg-muted">
              {description}
            </p>
          ) : null}
        </div>
        {action ? <div className="sm:ml-auto sm:shrink-0">{action}</div> : null}
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
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

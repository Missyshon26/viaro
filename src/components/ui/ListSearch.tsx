"use client";

import { IconSearch } from "@/components/ui/Icons";

/**
 * A search box for the card lists (Drivers, City pricing) that are not DataTables.
 *
 * Those two screens had no search of their own, so staff typed into the header's
 * "Jump to…" box — which only jumps between console pages — and nothing was filtered.
 */
export function ListSearch({
  value,
  onChange,
  placeholder,
  count,
  total,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  /** Matches shown, and out of how many — displayed once a query is typed. */
  count: number;
  total: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative min-w-0 flex-1 sm:max-w-xs">
        <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted">
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
      {value.trim() ? (
        <p className="text-note text-fg-muted">
          {count} of {total}
        </p>
      ) : null}
    </div>
  );
}

/** Case-insensitive match of a query against any of the given fields. */
export function matches(query: string, fields: (string | number | null | undefined)[]) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return fields.some((field) => String(field ?? "").toLowerCase().includes(needle));
}

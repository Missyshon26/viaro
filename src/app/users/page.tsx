"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PersonCell, StatusBadge } from "@/components/ui/Dashboard";
import { ConsolePage, DataTable, emptyActionClass, formatDate, type Column } from "@/components/ui/DataTable";
import { getUsersDashboard } from "@/lib/api/admin";
import { errorText } from "@/lib/api/client";
import { useLiveChanges } from "@/lib/live/useLiveChanges";
import type { User } from "@/lib/api/types";

const ROLES = ["all", "customer", "driver", "admin", "company"] as const;

const PAGE_SIZE = 20;

export default function UsersPage() {
  const [data, setData] = useState<{ items: User[]; total: number } | null>(null);
  const [role, setRole] = useState<(typeof ROLES)[number]>("customer");
  const [searchText, setSearchText] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const latest = useRef(0);

  // The page number belongs to one role + search: changing either is page 1 again.
  const fetchKey = JSON.stringify([role, search]);
  const [pageState, setPageState] = useState({ key: fetchKey, page: 1 });
  const page = pageState.key === fetchKey ? pageState.page : 1;

  const load = useCallback(async () => {
    const ticket = ++latest.current;
    setLoading(true);
    try {
      // One page from the API, filtered there: a few thousand accounts are never downloaded together.
      const result = await getUsersDashboard(page, PAGE_SIZE, { role: role === "all" ? undefined : role, q: search.trim() });
      if (ticket !== latest.current) return;
      setData({ items: result.items, total: result.total });
      setError(null);
    } catch (err) {
      if (ticket !== latest.current) return;
      setError(errorText(err, "Could not load users"));
      setData((current) => current ?? { items: [], total: 0 });
    } finally {
      if (ticket === latest.current) setLoading(false);
    }
  }, [page, role, search]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchText), 350);
    return () => clearTimeout(timer);
  }, [searchText]);

  // New sign-ups and account changes appear without a refresh.
  useLiveChanges(["user"], (event) => {
    if (event.action !== "reconnected") void load();
  });

  const columns: Column<User>[] = [
    {
      key: "name",
      header: "Name",
      cell: (u) => (
        <Link href={`/users/${u._id}`} className="hover:text-accent">
          <PersonCell name={u.name} meta={u.email} />
          {u.isGuest ? <StatusBadge tone="info">Guest</StatusBadge> : null}
        </Link>
      ),
    },
    {
      key: "role",
      header: "Role",
      cell: (u) => <StatusBadge tone="info">{u.role}</StatusBadge>,
    },
    {
      key: "status",
      header: "Status",
      cell: (u) => <StatusBadge status={u.status} />,
    },
    { key: "phone", header: "Phone", cell: (u) => u.phone, secondary: true },
    {
      key: "joined",
      header: "Joined",
      align: "right",
      cell: (u) => formatDate(u.createdAt),
    },
  ];

  return (
    <ConsolePage
      title="Users"
      description="Everyone with an account, across all four roles."
      action={
        <div className="flex gap-1 rounded-field bg-accent-soft p-1">
          {ROLES.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setRole(value)}
              aria-pressed={role === value}
              className={`rounded-[0.5rem] px-3 py-1.5 text-label font-bold capitalize transition-colors ${
                role === value ? "bg-surface-raised text-fg" : "text-accent-strong hover:text-fg"
              }`}
            >
              {value}
            </button>
          ))}
        </div>
      }
    >
      {error ? <p className="mb-4 text-note font-bold text-danger">{error}</p> : null}
      <div aria-busy={loading} className={loading && data ? "opacity-60 transition-opacity" : "transition-opacity"}>
      <DataTable
        rows={data?.items ?? null}
        columns={columns}
        rowKey={(u) => u._id}
        minWidth="52rem"
        pageSize={PAGE_SIZE}
        remote={{
          query: searchText,
          onQuery: setSearchText,
          page,
          total: data?.total ?? 0,
          onPage: (next) => setPageState({ key: fetchKey, page: next }),
        }}
        searchable={() => []}
        searchPlaceholder="Search name, email, phone…"
        rowHref={(u) => `/users/${u._id}`}
        empty={{
          title: role === "all" ? "No users" : `No ${role} accounts`,
          description: "Nobody matches that filter.",
          action:
            role !== "all" ? (
              <button type="button" className={emptyActionClass} onClick={() => setRole("all")}>Show all users</button>
            ) : undefined,
        }}
      />
      </div>
    </ConsolePage>
  );
}

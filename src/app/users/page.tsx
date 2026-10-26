"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PersonCell, StatusBadge } from "@/components/ui/Dashboard";
import { ConsolePage, DataTable, formatDate, type Column } from "@/components/ui/DataTable";
import { getUsersDashboard } from "@/lib/api/admin";
import { errorText } from "@/lib/api/client";
import { useLiveChanges } from "@/lib/live/useLiveChanges";
import type { User } from "@/lib/api/types";

const ROLES = ["all", "customer", "driver", "admin", "company"] as const;

export default function UsersPage() {
  const [rows, setRows] = useState<User[] | null>(null);
  const [role, setRole] = useState<(typeof ROLES)[number]>("all");
  const [error, setError] = useState<string | null>(null);

  const [reload, setReload] = useState(0);
  // New sign-ups and account changes appear without a refresh.
  useLiveChanges(["user"], (event) => {
    if (event.action !== "reconnected") setReload((n) => n + 1);
  });

  useEffect(() => {
    let cancelled = false;
    // 100 is the API's maximum page size; asking for more is a 400..
    getUsersDashboard(1, 100)
      .then((page) => { if (!cancelled) setRows(page.items); })
      .catch((err) => {
        if (cancelled) return;
        setError(errorText(err, "Could not load users"));
        setRows([]);
      });
    return () => { cancelled = true; };
  }, [reload]);

  const filtered = useMemo(
    () => (rows ?? []).filter((u) => role === "all" || u.role === role),
    [rows, role],
  );

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
      sortValue: (u) => u.name,
    },
    {
      key: "role",
      header: "Role",
      cell: (u) => <StatusBadge tone="info">{u.role}</StatusBadge>,
      sortValue: (u) => u.role,
    },
    {
      key: "status",
      header: "Status",
      cell: (u) => <StatusBadge status={u.status} />,
      sortValue: (u) => u.status,
    },
    { key: "phone", header: "Phone", cell: (u) => u.phone, secondary: true },
    {
      key: "joined",
      header: "Joined",
      align: "right",
      cell: (u) => formatDate(u.createdAt),
      sortValue: (u) => u.createdAt,
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
      <DataTable
        rows={rows === null ? null : filtered}
        columns={columns}
        rowKey={(u) => u._id}
        minWidth="52rem"
        pageSize={20}
        searchable={(u) => [u.name, u.email, u.phone, u.role]}
        searchPlaceholder="Search name, email, phone…"
        rowHref={(u) => `/users/${u._id}`}
        empty={{ title: "No users", description: "Nobody matches that filter." }}
      />
    </ConsolePage>
  );
}

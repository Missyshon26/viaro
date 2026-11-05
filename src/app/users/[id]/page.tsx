"use client";

import { use, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  ConsolePage,
  DataTable,
  emptyActionClass,
  formatDate,
  formatDateTime,
  money,
  type Column,
} from "@/components/ui/DataTable";
import {
  Avatar,
  NotAvailable,
  Skeleton,
  StatusBadge,
  type BadgeTone,
} from "@/components/ui/Dashboard";
import { IconCheck, IconMoney, IconPenalty, IconRoute, IconUsers } from "@/components/ui/Icons";
import { errorText } from "@/lib/api/client";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useLiveChanges } from "@/lib/live/useLiveChanges";
import {
  fetchAllPages,
  getJourneys,
  getUserAgreement,
  getUserDashboard,
  reviewUserAgreement,
  type UserAgreement,
} from "@/lib/api/admin";
import { vehicleLabel } from "@/lib/vehicles";
import { invoiceNumber } from "@/lib/invoice";
import { AccountDialog } from "@/components/ops/AccountDialog";
import { updateUser } from "@/lib/api/clients";
import type { Booking, Trip, User } from "@/lib/api/types";

/**
 * One account, and everything it has done on the platform.
 *
 * Assembled from three reads and two joins, because none of it is available directly:
 * there is no GET /admin/users/:id, and nothing filters bookings by customer. So the
 * page pulls the three admin lists and narrows them here.
 *
 * The journey history only applies to a customer — a booking records who *asked* for the
 * ride, not who drove it. A chauffeur's own history lives on the Drivers screen, which
 * reads the driver-scoped reports; showing an empty table here for a driver would imply
 * they had done nothing.
 */

type Row = Booking & {
  customerId: string | { _id: string; name: string; email?: string };
  scheduledAtLocal?: string;
  trip?: Trip;
};

type Stage = "awaiting" | "assigned" | "in_progress" | "completed" | "cancelled";

const STAGE: Record<Stage, { label: string; tone: BadgeTone }> = {
  awaiting: { label: "Awaiting a driver", tone: "warn" },
  assigned: { label: "Driver assigned", tone: "info" },
  in_progress: { label: "In progress", tone: "info" },
  completed: { label: "Completed", tone: "good" },
  cancelled: { label: "Cancelled", tone: "bad" },
};

/** Same derivation the Trips screen uses — a booking alone never reads 'completed'. */
function stageOf(row: Row): Stage {
  if (row.trip?.status === "completed") return "completed";
  if (row.trip?.status === "cancelled" || row.status === "cancelled") return "cancelled";
  if (row.trip?.status === "started") return "in_progress";
  if (row.trip) return "assigned";
  return "awaiting";
}

export default function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [user, setUser] = useState<User | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [agreement, setAgreement] = useState<UserAgreement | null>(null);

  // A passenger's signed agreement. Only customers sign one, and a failed read just
  // hides the panel rather than taking the page down.
  const isCustomerRole = user?.role === "customer";
  useEffect(() => {
    if (!isCustomerRole) return;
    let current = true;
    getUserAgreement(id)
      .then((a) => current && setAgreement(a))
      .catch(() => current && setAgreement(null));
    return () => {
      current = false;
    };
  }, [id, isCustomerRole]);

  /**
   * Guarded against a stale response for the same reason the trip detail page is: these
   * fetch on mount with no cancellation check, so a quick navigation between two accounts
   * could let the slower first response land last and render the wrong person's history
   * under the new URL.
   */
  const load = useCallback(async (isCurrent: () => boolean = () => true) => {
    try {
      // One account and its own bookings (each with its trip), not every user, booking and trip.
      const [found, journeys] = await Promise.all([
        getUserDashboard(id),
        fetchAllPages((page, limit) => getJourneys(page, limit, { customerId: id })),
      ]);

      if (!isCurrent()) return;

      setUser(found);
      setRows(
        (journeys.items as unknown as Row[]).sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt)),
      );
      setError(null);
    } catch (err) {
      if (!isCurrent()) return;
      setError(errorText(err, "Could not load this account"));
      setRows([]);
    }
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    void load(() => !cancelled);
    return () => {
      cancelled = true;
    };
  }, [load]);

  // This customer's trips follow the bookings and trips as they change.
  useLiveChanges(["booking", "trip"], () => void load());

  const stats = useMemo(() => {
    const list = rows ?? [];
    const completed = list.filter((r) => stageOf(r) === "completed");
    const cancelled = list.filter((r) => stageOf(r) === "cancelled");
    const spent = completed.reduce(
      (sum, r) => sum + (r.trip?.fareAmount ?? r.estimatedFare ?? 0),
      0,
    );
    return {
      total: list.length,
      completed: completed.length,
      cancelled: cancelled.length,
      spent,
      // Completion rate over journeys that actually reached an outcome — counting the
      // ones still in flight would drag it down for no reason.
      rate:
        completed.length + cancelled.length > 0
          ? Math.round((completed.length / (completed.length + cancelled.length)) * 100)
          : null,
    };
  }, [rows]);

  const columns: Column<Row>[] = [
    {
      key: "ref",
      header: "Reference",
      cell: (r) => (
        <Link
          href={`/trips/${r._id}`}
          className="font-mono text-[0.8125rem] font-bold text-fg hover:text-accent"
        >
          {invoiceNumber(r)}
        </Link>
      ),
      sortValue: (r) => r._id,
    },
    {
      key: "route",
      header: "Route",
      cell: (r) => (
        <span className="flex min-w-0 max-w-[22rem] items-center gap-1.5">
          <span className="truncate text-fg">{r.pickup.address}</span>
          <span aria-hidden className="shrink-0 text-fg-faint">
            →
          </span>
          <span className="truncate text-fg-muted">{r.drop.address}</span>
        </span>
      ),
    },
    {
      key: "when",
      header: "Pickup",
      cell: (r) => (
        <span className="whitespace-nowrap text-fg-body">
          {r.scheduledAtLocal ?? formatDateTime(r.scheduledAt)}
        </span>
      ),
      sortValue: (r) => r.scheduledAt,
    },
    {
      key: "vehicle",
      header: "Vehicle",
      secondary: true,
      cell: (r) => <span className="text-fg-body">{vehicleLabel(r.vehicleClass)}</span>,
      sortValue: (r) => vehicleLabel(r.vehicleClass),
    },
    {
      key: "stage",
      header: "Stage",
      cell: (r) => {
        const stage = STAGE[stageOf(r)];
        return <StatusBadge tone={stage.tone}>{stage.label}</StatusBadge>;
      },
    },
    {
      key: "fare",
      header: "Fare",
      align: "right",
      cell: (r) => (
        <span className="font-bold text-fg">
          {money(r.trip?.fareAmount ?? r.estimatedFare)}
        </span>
      ),
      sortValue: (r) => r.trip?.fareAmount ?? r.estimatedFare ?? 0,
    },
  ];

  const isCustomer = user?.role === "customer";

  return (
    <>
      <div className="mx-auto mb-4 max-w-[1400px]">
        <Link
          href="/users"
          className="inline-flex h-9 items-center gap-2 rounded-field border border-border bg-surface-raised px-3.5 text-meta font-bold text-fg-body shadow-[var(--shadow-card)] transition-colors hover:border-accent hover:text-fg"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Back to users
        </Link>
      </div>

      <ConsolePage
        title={user?.name ?? "Account"}
        description={user ? `${user.role} · joined ${formatDate(user.createdAt)}` : "Loading…"}
        action={
          user ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setNotice(null);
                  setEditing(true);
                }}
                className="h-9 rounded-field border border-border bg-surface-raised px-3.5 text-meta font-bold text-fg-body shadow-[var(--shadow-card)] transition-colors hover:border-accent hover:text-fg"
              >
                Edit details
              </button>
              <StatusBadge status={user.status} />
            </div>
          ) : null
        }
      >
        {notice ? (
          <p role="status" className="mb-4 rounded-field border border-border bg-surface px-4 py-3 text-note font-bold text-fg">
            {notice}
          </p>
        ) : null}

        {error ? (
          <p className="mb-4 rounded-field border border-danger/30 bg-danger/5 px-4 py-3 text-note font-bold text-danger">
            {error}
          </p>
        ) : null}

        {!user ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-40 rounded-card" />
            ))}
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Tile
                label="Trips"
                value={isCustomer ? String(stats.total) : "—"}
                hint={isCustomer ? "Booked all time" : "Customers only"}
                icon={<IconRoute size={16} />}
              />
              <Tile
                label="Completed"
                value={isCustomer ? String(stats.completed) : "—"}
                hint={stats.rate !== null ? `${stats.rate}% completion rate` : undefined}
                icon={<IconCheck size={16} />}
              />
              <Tile
                label="Cancelled"
                value={isCustomer ? String(stats.cancelled) : "—"}
                icon={<IconPenalty size={16} />}
              />
              <Tile
                label="Spent"
                value={isCustomer ? money(stats.spent) : "—"}
                hint="Completed trips only"
                icon={<IconMoney size={16} />}
              />
            </div>

            <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              <Section icon={<IconUsers size={14} />} title="Account">
                <div className="flex items-center gap-3">
                  <Avatar name={user.name} size={44} />
                  <div className="min-w-0">
                    <p className="truncate text-action font-bold text-fg">{user.name}</p>
                    <p className="truncate text-note text-fg-muted">{user.email}</p>
                  </div>
                </div>
                <dl className="mt-5 grid gap-x-6 gap-y-3 sm:grid-cols-2">
                  <Field label="Role" value={user.role} capitalize />
                  <Field label="Status" value={user.status.replace(/_/g, " ")} capitalize />
                  <Field label="Phone" value={user.phone || "—"} />
                  {user.address ? (
                    <Field
                      label="Address"
                      value={[
                        user.address.line1,
                        user.address.line2,
                        [user.address.city, [user.address.state, user.address.postalCode].filter(Boolean).join(" ")]
                          .filter(Boolean)
                          .join(", "),
                      ]
                        .filter(Boolean)
                        .join(", ")}
                    />
                  ) : null}
                  <Field label="Joined" value={formatDate(user.createdAt)} />
                  <Field label="User id" value={user._id} mono />
                </dl>
                {user.isGuest ? (
                  <p className="mt-4">
                    <StatusBadge tone="info">Guest account</StatusBadge>
                  </p>
                ) : null}
                {isCustomerRole && agreement ? (
                  <div className="mt-5 border-t border-border pt-4">
                    <p className="text-label font-bold uppercase tracking-wider text-fg-muted">
                      Rental agreement
                    </p>
                    {agreement.signed ? (
                      <>
                        <p className="mt-1 text-note text-fg-muted">
                          Signed {formatDate(agreement.signedAt ?? "")} · revision {agreement.version}
                        </p>
                        {agreement.signature ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={agreement.signature}
                            alt={`${user.name}'s signature`}
                            className="mt-2 h-16 rounded border border-border bg-white"
                          />
                        ) : null}
                        <AgreementReview
                          userId={id}
                          review={agreement.review}
                          onDecided={(next) => setAgreement(next)}
                        />
                      </>
                    ) : (
                      <p className="mt-1 text-note text-fg-muted">
                        {agreement.version
                          ? `Signed an older revision (${agreement.version}); needs to sign again.`
                          : "Hasn't signed yet."}
                      </p>
                    )}
                  </div>
                ) : null}
              </Section>

              <Section icon={<IconRoute size={14} />} title="Trip history">
                {!isCustomer ? (
                  <NotAvailable
                    title="Trips are recorded against the customer who booked them"
                    reason={`A booking stores who requested the ride, not who drove it, so there is nothing to list for a ${user.role} account here. A driver's own record — trips, earnings and penalties — is on the Drivers screen, which reads the driver-scoped reports.`}
                  />
                ) : (
                  <DataTable
                    rows={rows}
                    columns={columns}
                    rowKey={(r) => r._id}
                    minWidth="46rem"
                    pageSize={10}
                    searchable={(r) => [
                      invoiceNumber(r),
                      r.pickup.address,
                      r.drop.address,
                      vehicleLabel(r.vehicleClass),
                    ]}
                    searchPlaceholder="Search this customer's trips…"
                    rowHref={(r) => `/trips/${r._id}`}
                    empty={{
                      title: "No trips yet",
                      description: "This customer has not booked a ride.",
                      action: <Link href="/trips" className={emptyActionClass}>Add a trip from Trips</Link>,
                    }}
                  />
                )}
              </Section>
            </div>
          </>
        )}
      </ConsolePage>

      {editing && user ? (
        <AccountDialog
          client={user}
          noun="user"
          saveChanges={updateUser}
          onClose={() => setEditing(false)}
          onSaved={async (message) => {
            setEditing(false);
            setNotice(message);
            await load();
          }}
        />
      ) : null}
    </>
  );
}

/* --------------------------------- fragments ------------------------------- */

function Tile({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: ReactNode;
}) {
  return (
    <div className="rounded-card border border-border bg-surface-raised p-4 shadow-[var(--shadow-card)]">
      <p className="flex items-center gap-2 text-note font-bold uppercase tracking-wider text-fg-body">
        <span aria-hidden className="text-accent">
          {icon}
        </span>
        {label}
      </p>
      <p className="mt-2.5 truncate text-[1.375rem] font-bold tracking-tight text-fg">
        {value}
      </p>
      {hint ? <p className="mt-1.5 truncate text-note text-fg-muted">{hint}</p> : null}
    </div>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h3 className="flex items-center gap-2 text-small font-bold uppercase tracking-wider text-fg-body">
        <span aria-hidden className="text-accent">
          {icon}
        </span>
        {title}
      </h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Field({
  label,
  value,
  mono,
  capitalize,
}: {
  label: string;
  value: string;
  mono?: boolean;
  capitalize?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-note font-medium uppercase tracking-wider text-fg-muted">
        {label}
      </dt>
      <dd
        className={`mt-1 truncate ${mono ? "font-mono text-[0.8125rem]" : "text-body"} text-fg ${
          capitalize ? "capitalize" : ""
        }`}
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * Operations' verdict on a signed agreement. The client is emailed it, so each button asks
 * first. Signing again clears the verdict, which is why it can be set again later.
 */
function AgreementReview({
  userId,
  review,
  onDecided,
}: {
  userId: string;
  review: UserAgreement["review"];
  onDecided: (next: UserAgreement) => void;
}) {
  const [asking, setAsking] = useState<"approve" | "reject" | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: "approve" | "reject") {
    setPending(true);
    setError(null);
    try {
      onDecided(await reviewUserAgreement(userId, decision));
      setAsking(null);
    } catch (err) {
      setError(errorText(err, "Could not save that decision"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-3 space-y-2">
      {review ? (
        <p className="text-note text-fg-body">
          <StatusBadge tone={review.status === "approved" ? "good" : "bad"}>
            {review.status === "approved" ? "Approved" : "Rejected"}
          </StatusBadge>{" "}
          {formatDate(review.at)}
          {review.byName ? ` by ${review.byName}` : ""}
        </p>
      ) : (
        <p className="text-note text-fg-muted">Not reviewed yet.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            setError(null);
            setAsking("approve");
          }}
          className="rounded-field border border-border px-3 py-1.5 text-note font-bold text-fg hover:border-accent"
        >
          Approve
        </button>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setAsking("reject");
          }}
          className="rounded-field border border-danger/40 px-3 py-1.5 text-note font-bold text-danger hover:bg-danger/5"
        >
          Reject
        </button>
      </div>
      <ConfirmDialog
        open={asking !== null}
        title={asking === "approve" ? "Approve this agreement?" : "Reject this agreement?"}
        confirmLabel={asking === "approve" ? "Approve" : "Reject"}
        pendingLabel="Saving…"
        danger={asking === "reject"}
        pending={pending}
        error={error}
        onConfirm={() => asking && void decide(asking)}
        onCancel={() => setAsking(null)}
      >
        <p>
          The client is emailed that their document was {asking === "approve" ? "approved" : "rejected"}.
        </p>
      </ConfirmDialog>
    </div>
  );
}

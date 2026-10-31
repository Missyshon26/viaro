"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ConsolePage, emptyActionClass } from "@/components/ui/DataTable";
import { Card } from "@/components/ui/Surfaces";
import { IconBell, IconInbox } from "@/components/ui/Icons";
import { errorText } from "@/lib/api/client";
import { listNotificationPage, markAllNotificationsRead, markNotificationRead } from "@/lib/api/notifications";
import type { Notification } from "@/lib/api/types";
import { useLiveChanges } from "@/lib/live/useLiveChanges";
import { needsAction, notificationHref, notificationKind, notificationText, notificationTime } from "@/lib/notifications";

const PAGE_SIZE = 20;

/**
 * Everything operations has been told: new bookings, cancellations, nobody available to send, cases
 * waiting, failed payments. The bell shows the latest few; this is the whole list, with the unread
 * ones one click away. Opening a notice marks it read and goes to the thing it is about.
 */
export default function NotificationsPage() {
  const router = useRouter();
  const [only, setOnly] = useState<"all" | "unread">("all");
  const [items, setItems] = useState<Notification[] | null>(null);
  const [total, setTotal] = useState(0);
  const [unread, setUnread] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  /** Reads the first page again (also after a live change, so a new notice appears at the top). */
  const reload = useCallback(async () => {
    const ticket = ++latest.current;
    try {
      const result = await listNotificationPage(1, PAGE_SIZE, only === "unread");
      if (ticket !== latest.current) return;
      setItems(result.items);
      setTotal(result.total);
      setUnread(result.unread);
      setPages(result.totalPages);
      setPage(1);
      setError(null);
    } catch (err) {
      if (ticket !== latest.current) return;
      setError(errorText(err, "Could not load the notifications"));
      setItems((current) => current ?? []);
    }
  }, [only]);

  useEffect(() => {
    void reload();
  }, [reload]);
  useLiveChanges(["notification"], () => void reload());

  async function loadMore() {
    setLoadingMore(true);
    try {
      const result = await listNotificationPage(page + 1, PAGE_SIZE, only === "unread");
      setItems((current) => {
        const have = new Set((current ?? []).map((n) => n._id));
        return [...(current ?? []), ...result.items.filter((n) => !have.has(n._id))];
      });
      setPage(page + 1);
      setPages(result.totalPages);
      setUnread(result.unread);
    } catch (err) {
      setError(errorText(err, "Could not load more"));
    } finally {
      setLoadingMore(false);
    }
  }

  async function open(n: Notification) {
    const href = notificationHref(n);
    if (!n.read) {
      setItems((current) => current?.map((x) => (x._id === n._id ? { ...x, read: true } : x)) ?? current);
      setUnread((count) => Math.max(0, count - 1));
      try {
        await markNotificationRead(n._id);
      } catch {
        void reload();
      }
    }
    if (href) router.push(href);
  }

  async function readAll() {
    try {
      await markAllNotificationsRead();
      await reload();
    } catch (err) {
      setError(errorText(err, "Could not mark them as read"));
    }
  }

  return (
    <ConsolePage
      title="Notifications"
      description="What needs attention: new bookings, cancellations, trips with no driver, support cases and failed payments."
      action={
        unread > 0 ? (
          <button type="button" onClick={() => void readAll()} className={emptyActionClass}>
            Mark all as read
          </button>
        ) : undefined
      }
    >
      {error ? (
        <p role="alert" className="mb-4 rounded-field border border-danger/30 bg-danger/5 px-4 py-3 text-note font-bold text-danger">
          {error}
        </p>
      ) : null}

      <div role="group" aria-label="Show notifications" className="mb-4 flex flex-wrap gap-2">
        {(
          [
            ["all", "All"],
            ["unread", "Unread"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={only === key}
            onClick={() => {
              setItems(null);
              setOnly(key);
            }}
            className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-3.5 text-meta font-bold transition-colors ${
              only === key
                ? "border-accent bg-accent-soft text-accent-strong"
                : "border-border bg-surface-raised text-fg-body hover:border-accent/50 hover:text-fg"
            }`}
          >
            {label}
            {key === "unread" ? (
              <span className={`rounded-full px-1.5 text-label ${only === key ? "bg-accent/15" : "bg-surface text-fg-muted"}`}>{unread}</span>
            ) : null}
          </button>
        ))}
      </div>

      <Card className="overflow-hidden p-0">
        {items === null ? (
          <p className="px-5 py-8 text-note text-fg-muted">Loading…</p>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-14 text-center">
            <IconInbox size={24} className="mb-3 text-fg-muted" />
            <p className="text-card font-bold text-fg">{only === "unread" ? "You are all caught up" : "No notifications yet"}</p>
            <p className="mt-2 max-w-sm text-note text-fg-muted">
              {only === "unread"
                ? "Nothing is waiting for you."
                : "New bookings, cancellations, trips with no driver and support cases appear here as they happen."}
            </p>
            <div className="mt-5">
              {only === "unread" ? (
                <button type="button" className={emptyActionClass} onClick={() => { setItems(null); setOnly("all"); }}>
                  Show all notifications
                </button>
              ) : (
                <button type="button" className={emptyActionClass} onClick={() => router.push("/trips")}>
                  View trips
                </button>
              )}
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {items.map((n) => {
              const href = notificationHref(n);
              return (
                <li key={n._id}>
                  <button
                    type="button"
                    onClick={() => void open(n)}
                    className="flex w-full items-start gap-3 px-5 py-4 text-left transition-colors hover:bg-surface"
                  >
                    <span
                      aria-hidden
                      className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                        n.read ? "bg-surface text-fg-muted" : needsAction(n.type) ? "bg-danger/10 text-danger" : "bg-accent-soft text-accent-strong"
                      }`}
                    >
                      <IconBell size={15} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="text-label font-bold uppercase tracking-wider text-fg-muted">{notificationKind(n.type)}</span>
                        {!n.read ? <span className="rounded-full bg-accent px-1.5 py-px text-[0.625rem] font-bold text-white">New</span> : null}
                      </span>
                      <span className={`mt-0.5 block text-meta leading-snug ${n.read ? "text-fg-body" : "font-bold text-fg"}`}>{notificationText(n)}</span>
                      <span className="mt-1 block text-label text-fg-muted">{notificationTime(n.createdAt)}</span>
                    </span>
                    {href ? <span aria-hidden className="mt-1 shrink-0 text-note font-bold text-accent">Open →</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {items && items.length > 0 ? (
        <div className="mt-4 flex flex-col items-center gap-2">
          <p className="text-label text-fg-muted">
            Showing {items.length} of {total}
          </p>
          {page < pages ? (
            <button type="button" disabled={loadingMore} onClick={() => void loadMore()} className={`${emptyActionClass} disabled:opacity-60`}>
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          ) : null}
        </div>
      ) : null}
    </ConsolePage>
  );
}

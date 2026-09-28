import type { Metadata } from "next";
import { PageShell, Panel, EmptyState, formatDateTime } from "@/components/app/shell";
import { MarkReadButton } from "@/components/app/notification-actions";
import { listNotifications } from "@/lib/api/account";
import type { NotificationItem, Paginated } from "@/lib/api/types";

export const metadata: Metadata = {
  title: "Notifications | Viaro",
  robots: { index: false, follow: false },
};

/** The list endpoint may answer with a bare array or a paginated envelope. */
function toItems(
  payload: Paginated<NotificationItem> | NotificationItem[],
): NotificationItem[] {
  return Array.isArray(payload) ? payload : (payload.items ?? []);
}

/** Turns "trip.accepted" or "TRIP_ACCEPTED" into "Trip accepted". */
function humanise(type: string) {
  const words = type.replace(/[._-]/g, " ").toLowerCase().trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export default async function NotificationsPage() {
  const items = toItems(await listNotifications(1, 50));

  return (
    <PageShell title="Notifications" description="Updates about your trips and account.">
      {items.length === 0 ? (
        <EmptyState
          title="Nothing yet"
          description="Dispatch updates, flight changes and receipts will appear here."
        />
      ) : (
        <Panel className="p-0">
          <ul className="divide-y divide-border">
            {items.map((item) => (
              <li
                key={item._id}
                className={`flex flex-wrap items-start gap-4 px-6 py-5 ${
                  item.read ? "opacity-60" : ""
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">
                    {humanise(item.type)}
                  </p>
                  {item.payload?.message ? (
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                      {item.payload.message}
                    </p>
                  ) : null}
                  <p className="mt-2 text-xs text-muted-foreground">
                    {formatDateTime(item.createdAt)}
                  </p>
                </div>
                {!item.read ? <MarkReadButton id={item._id} /> : null}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </PageShell>
  );
}

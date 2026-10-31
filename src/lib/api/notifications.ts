import { api } from "./client";
import type { Notification, Paginated } from "./types";

/**
 * `GET /notifications` is guarded by `authGuard` only — no role check — so the same
 * feed backs the operations console, the fleet console and the chauffeur portal. What
 * differs is the payload each role is sent, not the endpoint.
 *
 * For an admin the feed is the operations feed: a new booking, a cancellation, nobody
 * available to send, a case waiting, a failed payment.
 *
 * The route answers with a paginated envelope on some deployments and a bare array on
 * others, so callers go through these functions rather than reading `.items`.
 */
export interface NotificationPage {
  items: Notification[];
  total: number;
  totalPages: number;
  /** The account's whole unread count, whatever the filter. */
  unread: number;
}

export async function listNotificationPage(
  page = 1,
  limit = 20,
  unreadOnly = false,
): Promise<NotificationPage> {
  const result = await api.get<(Paginated<Notification> & { unread?: number }) | Notification[]>("/notifications", {
    query: { page, limit, ...(unreadOnly ? { unread: "true" } : {}) },
  });
  if (Array.isArray(result)) {
    const unread = result.filter((n) => !n.read).length;
    return { items: result, total: result.length, totalPages: 1, unread };
  }
  const items = result.items ?? [];
  return {
    items,
    total: result.total ?? items.length,
    totalPages: result.totalPages ?? 1,
    unread: result.unread ?? items.filter((n) => !n.read).length,
  };
}

export async function listNotifications(limit = 12): Promise<Notification[]> {
  return (await listNotificationPage(1, limit)).items;
}

export const markNotificationRead = (id: string) =>
  api.patch<Notification>(`/notifications/${id}/read`);

export const markAllNotificationsRead = () => api.patch<{ updated: number }>("/notifications/read-all");

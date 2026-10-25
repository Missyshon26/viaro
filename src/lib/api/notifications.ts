import { api } from "./client";
import type { Notification, Paginated } from "./types";

/**
 * `GET /notifications` is guarded by `authGuard` only — no role check — so the same
 * feed backs the operations console, the fleet console and the chauffeur portal. What
 * differs is the payload each role is sent, not the endpoint.
 *
 * The route answers with a paginated envelope on some deployments and a bare array on
 * others, so callers go through `listNotifications` rather than reading `.items`.
 */
export async function listNotifications(limit = 12): Promise<Notification[]> {
  const result = await api.get<Paginated<Notification> | Notification[]>("/notifications", {
    query: { page: 1, limit },
  });
  return Array.isArray(result) ? result : (result.items ?? []);
}

export const markNotificationRead = (id: string) =>
  api.patch<Notification>(`/notifications/${id}/read`);

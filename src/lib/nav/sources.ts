import { getNavBadges } from "@/lib/api/admin";

/**
 * What the operations console counts as "new", per nav entry.
 *
 * Only sections with a defensible notion of newness are here. Revenue, Reports, City
 * pricing and Vehicles are things an operator changes rather than things that arrive, so
 * badging them would just be decoration.
 *
 * The server works out the ids (see adminService.navBadges): the trips entry is the OPS QUEUE
 * (bookings still waiting for a driver), support is the open and pending tickets, users the
 * newest accounts. The hook decides which of them this browser has already been shown.
 * One small request, where this used to download four lists on every change.
 */
export async function collectBadgeIds(): Promise<Record<string, string[]>> {
  try {
    return await getNavBadges();
  } catch {
    // A failed round returns nothing; the hook merges, so the badges already showing stay.
    return {};
  }
}

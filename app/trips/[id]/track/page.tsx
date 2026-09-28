import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PageShell, Panel, SectionTitle, formatDateTime } from "@/components/app/shell";
import { MapPanel } from "@/components/app/map-panel";
import { RideStatusBadge } from "@/components/app/status-badge";
import { rideStatus } from "@/lib/ride-status";
import { TrackingRefresh } from "@/components/app/tracking-refresh";
import { apiOptional, ApiError } from "@/lib/api/client";
import { getBooking } from "@/lib/api/bookings";
import type { Booking, Receipt, Trip } from "@/lib/api/types";

export const metadata: Metadata = {
  title: "Live tracking | Viaro",
  robots: { index: false, follow: false },
};

const STATUS_COPY: Record<string, string> = {
  accepted: "On the way to you",
  started: "On the trip",
  completed: "Trip completed",
  cancelled: "Cancelled",
};

/**
 * Live tracking.
 *
 * `lastLocation` is the driver's last reported position, stored on the Trip as a REST
 * fallback for exactly this case — the high-frequency stream is the `/tracking/:tripId`
 * socket, which no client is wired to yet. Until it is, the page re-fetches on an
 * interval; the map, driver card and status all work the same either way.
 */
export default async function TrackTripPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let booking: Booking | null = null;
  try {
    booking = await getBooking(id);
  } catch (err) {
    if (!(err instanceof ApiError) || !(err.isNotFound || err.isForbidden)) throw err;
  }

  // The URL carries a booking id; the trip only exists once a chauffeur accepts.
  const receipt = booking
    ? await apiOptional<Receipt>(`/users/me/rides/${booking._id}/receipt`)
    : null;
  const tripId = receipt?.tripId ?? id;
  const trip = await apiOptional<Trip>(`/trips/${tripId}`);

  if (!booking && !trip) notFound();

  const ride = trip?.booking ?? booking;
  const live = trip?.status === "accepted" || trip?.status === "started";

  return (
    <PageShell
      title="Live tracking"
      description={trip ? STATUS_COPY[trip.status] : "Waiting for a chauffeur to accept."}
      action={
        <Button asChild variant="outline">
          <Link href={`/trips/${id}`}>Trip details</Link>
        </Button>
      }
    >
      {/* Polls while the trip is moving; stops once it ends. */}
      {live ? <TrackingRefresh /> : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <MapPanel
          lat={trip?.lastLocation?.lat}
          lng={trip?.lastLocation?.lng}
          updatedAt={trip?.lastLocation?.updatedAt}
          label={trip?.driver?.name ?? "Your chauffeur"}
          className="min-h-[420px]"
        />

        <div className="space-y-6">
          <Panel>
            <div className="flex flex-wrap items-center gap-3">
              <SectionTitle>Status</SectionTitle>
              <RideStatusBadge
                className="ml-auto"
                status={rideStatus({
                  bookingStatus: booking?.status,
                  tripStatus: trip?.status,
                  refundPct: trip?.cancellation?.refundPct,
                })}
              />
            </div>

            {trip?.driver ? (
              <div className="mt-5">
                <p className="text-lg font-medium text-foreground">
                  {trip.driver.name ?? "Assigned"}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {trip.driver.vehicleClass}
                  {typeof trip.driver.rating === "number"
                    ? ` · ${trip.driver.rating.toFixed(2)} ★`
                    : ""}
                </p>
                <Button asChild variant="outline" className="mt-4 w-full">
                  <Link href={`/trips/${id}/chat`}>Message your chauffeur</Link>
                </Button>
              </div>
            ) : (
              <p className="mt-5 text-sm leading-relaxed text-muted-foreground">
                No chauffeur assigned yet. This page updates as soon as one accepts.
              </p>
            )}
          </Panel>

          {ride ? (
            <Panel>
              <SectionTitle>Journey</SectionTitle>
              <dl className="mt-5 space-y-4 text-sm">
                <div>
                  <dt className="text-muted-foreground">Route</dt>
                  <dd className="mt-1 text-foreground">
                    {ride.pickup.address} → {ride.drop.address}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Pickup</dt>
                  <dd className="mt-1 text-foreground">
                    {ride.scheduledAtLocal ?? formatDateTime(ride.scheduledAt)}
                  </dd>
                </div>
              </dl>
            </Panel>
          ) : null}
        </div>
      </div>
    </PageShell>
  );
}

import type { Metadata } from "next";
import { PageShell } from "@/components/app/shell";
import { BookingForm, type JourneyPrefill } from "@/components/app/booking-form";
import { getMyWallet, } from "@/lib/api/wallet";
import { listVehicleClasses } from "@/lib/api/bookings";
import { VEHICLE_CLASSES, type VehicleClassOption } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Book a ride | Viaro",
  robots: { index: false, follow: false },
};

/**
 * The bookable classes come from the API, which operations manages in the admin console.
 *
 * Photography does not: there is no image field on the catalogue yet, so a class the API
 * returns is matched to the local photo set by key, and anything new falls back to the
 * drawn silhouette. That way adding a class in the console makes it bookable immediately
 * rather than waiting for artwork.
 */
async function loadVehicles(): Promise<VehicleClassOption[]> {
  try {
    const classes = await listVehicleClasses();
    if (classes.length === 0) return VEHICLE_CLASSES;

    // This flow books point-to-point journeys only, so a class operations limited to
    // hourly charters is not offered here — the API would refuse to quote it.
    return classes.filter((api) => api.usage !== "hourly").map((api) => {
      const local = VEHICLE_CLASSES.find((v) => v.value === api.value);
      return {
        value: api.value,
        label: api.label,
        detail: api.detail ?? `Up to ${api.seats} passengers, ${api.bags} bags`,
        seats: api.seats,
        bags: api.bags,
        photos: local?.photos ?? [],
      };
    });
  } catch {
    // The catalogue is not worth failing the page over — book with what shipped.
    return VEHICLE_CLASSES;
  }
}

/*
 * The homepage booking widget hands its answers over in the query string, the way
 * Blacklane's search box does. Anything malformed is simply dropped — the passenger
 * then fills that field in here as if they had come straight to /book.
 */
type SearchParams = Record<string, string | string[] | undefined>;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

function readJourney(params: SearchParams): JourneyPrefill {
  const one = (key: string) => {
    const v = params[key];
    return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
  };
  const text = (key: string) => one(key).slice(0, 300);
  const match = (key: string, re: RegExp) => (re.test(one(key)) ? one(key) : "");
  const passengers = Number.parseInt(one("passengers"), 10);
  const trip = one("trip");

  return {
    shape: trip === "roundtrip" ? "roundtrip" : "oneway",
    pickup: text("pickup"),
    drop: text("drop"),
    date: match("date", DATE_RE),
    time: match("time", TIME_RE),
    returnDate: match("returnDate", DATE_RE),
    returnTime: match("returnTime", TIME_RE),
    passengers: Number.isFinite(passengers) && passengers >= 1 && passengers <= 99 ? passengers : 1,
  };
}

export default async function BookPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const prefill = params.pickup || params.drop ? readJourney(params) : undefined;

  const [walletBalance, vehicles] = await Promise.all([
    getMyWallet(1, 1)
      .then((wallet) => wallet.balance)
      .catch(() => null),
    loadVehicles(),
  ]);

  return (
    <PageShell
      title="Book a ride"
      description="Point to point, airport or hourly. The total is quoted before you confirm."
    >
      <BookingForm walletBalance={walletBalance} vehicles={vehicles} prefill={prefill} />
    </PageShell>
  );
}

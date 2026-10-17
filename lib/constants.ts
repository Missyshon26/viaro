import type { TripType } from "@/lib/api/types";

/**
 * Shared constants.
 *
 * These live outside the "use server" action files on purpose: such a file may only
 * export async functions, so exporting an object from one fails the build.
 */

/**
 * Cities are the pricing keys the backend matches on (PricingRule.city, lowercased),
 * with representative coordinates. POST /bookings requires lat/lng on both ends and
 * there is no geocoder wired, so the flow works from a known list rather than
 * inventing coordinates for free text.
 */
export const CITIES = [
  { name: "Seattle", lat: 47.608, lng: -122.332 },
  { name: "Bellevue", lat: 47.6101, lng: -122.2015 },
  { name: "Tacoma", lat: 47.2529, lng: -122.4443 },
  { name: "Kirkland", lat: 47.6769, lng: -122.206 },
  { name: "Everett", lat: 47.979, lng: -122.2021 },
  { name: "Los Angeles", lat: 34.0522, lng: -118.2437 },
] as const;

/**
 * The vehicle catalogue.
 *
 * `value` and `seats` mirror src/config/vehicles.ts in the backend, which is where the
 * fare multiplier lives — prices are never computed here, they are quoted per class by
 * GET /pricing/fare-estimate so the card and the checkout cannot disagree.
 *
 * `photos[0]` is the card image; the rest are only seen in the lightbox. Every file is
 * local to /public/images, so next.config.mjs needs no `images.remotePatterns` entry.
 *
 * ⚠ ONE INTERIOR, SHARED BY EVERY CLASS. The project's own photography is all exteriors,
 * so CabinInterior.jpg stands in for all six cabins. It is honestly captioned "Cabin"
 * rather than claiming to be that particular car. Replace it per class as real interior
 * photography arrives — add entries to `photos` and nothing else needs to change.
 */
export interface VehiclePhoto {
  src: string;
  alt: string;
  /** Shown under the lightbox image and on the thumbnail. */
  caption: string;
}

export interface VehicleClassOption {
  value: string;
  label: string;
  detail: string;
  seats: number;
  bags: number;
  photos: VehiclePhoto[];
  /** all · hourly (charters only) · transfer (never hourly). Absent = all. */
  usage?: "all" | "hourly" | "transfer";
}

/** Stands in for every cabin until per-class interior photography exists. */
const CABIN: VehiclePhoto = {
  src: "/images/CabinInterior.jpg",
  alt: "Car cabin at dusk, driver at the wheel",
  caption: "Cabin",
};

export const VEHICLE_CLASSES: VehicleClassOption[] = [
  {
    value: "sedan",
    label: "Business Sedan",
    detail: "Up to 3 passengers, 2 bags",
    seats: 3,
    bags: 2,
    photos: [
      {
        src: "/images/FleetChauffeur.png",
        alt: "Dark executive saloon at the kerb with its chauffeur",
        caption: "Exterior",
      },
      { src: "/images/FleetHero.png", alt: "The Viaro fleet lined up", caption: "The fleet" },
      CABIN,
    ],
  },
  {
    value: "sedan-first",
    label: "First Class Sedan",
    detail: "Up to 3 passengers, 2 bags",
    seats: 3,
    bags: 2,
    photos: [
      {
        src: "/images/FleetSedan.png",
        alt: "Black Mercedes-Benz S-Class saloon",
        caption: "Exterior",
      },
      {
        src: "/images/FleetInterior.png",
        alt: "Long-wheelbase black Mercedes saloon in profile",
        caption: "Profile",
      },
      CABIN,
    ],
  },
  {
    value: "suv",
    label: "Business SUV",
    detail: "Up to 5 passengers, 5 bags",
    seats: 5,
    bags: 5,
    photos: [
      {
        src: "/images/VIP.png",
        alt: "Black Cadillac Escalade at a hotel entrance at night",
        caption: "Exterior",
      },
      {
        src: "/images/Family.png",
        alt: "A family boarding a black SUV outside a house",
        caption: "Boarding",
      },
      CABIN,
    ],
  },
  {
    value: "suv-luxury",
    label: "Luxury SUV",
    detail: "Up to 6 passengers, 6 bags",
    seats: 6,
    bags: 6,
    photos: [
      {
        src: "/images/FleetSUV.png",
        alt: "Black Cadillac Escalade in daylight",
        caption: "Exterior",
      },
      {
        src: "/images/VIP.png",
        alt: "Black Cadillac Escalade at a hotel entrance at night",
        caption: "At the door",
      },
      CABIN,
    ],
  },
  {
    value: "minibus",
    label: "Sprinter Van",
    detail: "Up to 13 passengers, 13 bags",
    seats: 13,
    bags: 13,
    photos: [
      {
        src: "/images/FleetSprinter.png",
        alt: "Black Mercedes-Benz Sprinter van",
        caption: "Exterior",
      },
      { src: "/images/FleetHero.png", alt: "The Viaro fleet lined up", caption: "The fleet" },
      CABIN,
    ],
  },
  {
    value: "limo",
    label: "Stretch Limousine",
    detail: "Up to 8 passengers, 4 bags",
    seats: 8,
    bags: 4,
    photos: [
      {
        src: "/images/FleetInterior.png",
        alt: "Long-wheelbase black Mercedes saloon in profile",
        caption: "Exterior",
      },
      {
        src: "/images/FleetSedan.png",
        alt: "Black Mercedes-Benz S-Class saloon",
        caption: "Front",
      },
      CABIN,
    ],
  },
];

export const TRIP_TYPE_LABEL: Record<TripType, string> = {
  point2point: "Point to point",
  airport: "Airport",
  hourly: "Hourly",
};

export const cityCoords = (name: string) =>
  CITIES.find((c) => c.name.toLowerCase() === name.toLowerCase()) ?? CITIES[0];

/**
 * Support contact details, shown on the cancel panel, support pages and booking flow.
 *
 * Kept in code rather than .env: they are public business facts, not configuration,
 * and an empty or placeholder env value ("000000000" reached production) is exactly
 * how the wrong number ended up on screen. Change them here.
 */
export const SUPPORT_PHONE = "(206) 672-8281";
export const SUPPORT_PHONE_HREF = "tel:+12066728281";
export const SUPPORT_HOURS = "24 hours a day, 7 days a week";
export const SUPPORT_EMAIL = "reservations@allblacklimoseattle.com";

/** The API does not define a plan price, so the product states the offer. */
export const MONTHLY_PLAN = { plan: "monthly", price: 49.99 } as const;

/*
 * Booking extras. Mirrors viaro-backend/src/config/services.ts, which is what prices
 * them — these are only for labelling the form; every total shown comes from the API.
 */

/** Meet and Greet add-on, per journey. */
export const MEET_AND_GREET_FEE = 25;

/** Child car seats are free; at most this many per booking. */
export const MAX_CAR_SEATS = 3;

/** Cruise terminals. The address becomes the pickup address. */
export const CRUISE_PORTS = [
  {
    value: "pier66",
    label: "Pier 66 — Bell Street Cruise Terminal",
    address: "Bell Street Cruise Terminal, Pier 66, 2225 Alaskan Way, Seattle, WA 98121",
  },
  {
    value: "pier91",
    label: "Pier 91 — Smith Cove Cruise Terminal",
    address: "Smith Cove Cruise Terminal, Pier 91, 2001 W Garfield St, Seattle, WA 98119",
  },
] as const;

/** Default pickup for an airport booking. The customer can change it. */
export const SEA_TAC_ADDRESS =
  "Seattle-Tacoma International Airport (SEA), 17801 International Blvd, SeaTac, WA 98158";

/**
 * Vehicle classes, for display only.
 *
 * Mirrors src/config/vehicles.ts in the backend — which is the authority, because the
 * fare multiplier lives there and is applied server-side. Nothing here is used to price
 * anything; this exists so the console can print "Luxury SUV · seats 6" instead of the
 * raw `suv-luxury` string a booking stores.
 *
 * `multiplier` is shown as context on the booking detail, not used to compute a fare —
 * the fare on a booking is whatever the API already worked out and stored.
 */
export interface VehicleClassInfo {
  value: string;
  label: string;
  seats: number;
  bags: number;
  multiplier: number;
}

export const VEHICLE_CLASSES: VehicleClassInfo[] = [
  { value: "sedan", label: "Business Sedan", seats: 3, bags: 2, multiplier: 1 },
  { value: "mpv", label: "MPV", seats: 6, bags: 5, multiplier: 1.23 },
  { value: "sedan-first", label: "First Class Sedan", seats: 3, bags: 2, multiplier: 1.45 },
  { value: "suv-first", label: "First Class SUV", seats: 6, bags: 6, multiplier: 1.54 },
  { value: "suv", label: "Business SUV", seats: 5, bags: 5, multiplier: 1.4 },
  { value: "suv-luxury", label: "Luxury SUV", seats: 6, bags: 6, multiplier: 1.75 },
  { value: "minibus", label: "Sprinter Van", seats: 13, bags: 13, multiplier: 2.2 },
  { value: "limo", label: "Stretch Limousine", seats: 8, bags: 4, multiplier: 2.6 },
  { value: "nemt", label: "NEMT", seats: 2, bags: 2, multiplier: 1 },
];

const BY_VALUE = new Map(VEHICLE_CLASSES.map((v) => [v.value, v]));

/** Unknown classes are real: `vehicleClass` is a free string and old rows predate this list. */
export const findVehicleClass = (value?: string | null): VehicleClassInfo | undefined =>
  value ? BY_VALUE.get(value) : undefined;

export const vehicleLabel = (value?: string | null): string =>
  findVehicleClass(value)?.label ?? value ?? "—";

export const TRIP_TYPE_LABEL: Record<string, string> = {
  point2point: "Point to point",
  airport: "Airport transfer",
  hourly: "Hourly charter",
};

import { Schema, model, type HydratedDocument } from 'mongoose';

/**
 * Which trips a class can be booked for.
 *   all       — every trip type (the default, and what existing classes are)
 *   hourly    — hourly charters only
 *   transfer  — point-to-point and airport transfers only, never hourly
 */
export const VEHICLE_USAGES = ['all', 'hourly', 'transfer'] as const;
export type VehicleUsage = (typeof VEHICLE_USAGES)[number];

/**
 * A bookable vehicle class, owned by operations rather than by a constant in the source.
 *
 * This replaces the hard-coded table in config/vehicles.ts, which is now only the seed
 * for a fresh database. The multiplier in particular has to live here: it is pricing,
 * and pricing is a business decision that should not need a deploy to change — the same
 * reason city base fares are already a collection rather than a constant.
 *
 * `value` is the key stored on every Booking, so it is immutable once created and
 * unique. Renaming a class means changing `label`; changing `value` would orphan every
 * booking that referenced it, which is why the update route refuses it.
 */
export interface IVehicleImage {
  /** Where to load it: a stored upload's path (`/uploads/vehicles/…`) or an absolute URL. */
  src: string;
  alt: string;
  caption: string;
  /**
   * The stored file's name, present only for images uploaded through the console. It is how
   * the file is found again to delete it; an image linked by URL has none and owns no file.
   */
  key?: string;
}

export interface IVehicleClass {
  /** Stored on bookings. Immutable. */
  value: string;
  label: string;
  /** Shown on the booking card, e.g. "Up to 3 passengers, 2 bags". */
  detail?: string;
  /** A short label on the card, e.g. "Most Popular". */
  badge?: string;
  seats: number;
  bags: number;
  /** Fare = cityBaseFare × peakMultiplier × hours × THIS. */
  multiplier: number;
  /** Which trip types may use this class. */
  usage: VehicleUsage;
  /**
   * Fare multiplier for HOURLY trips, when it should differ from `multiplier` (which
   * then prices point-to-point and airport). Unset = hourly uses `multiplier` too.
   */
  hourlyMultiplier?: number | null;
  /**
   * Fixed price for a point-to-point or airport transfer, in dollars. When set it
   * replaces the multiplier formula for transfers — the city base fare and the peak
   * window no longer apply, only the primetime surcharge does.
   */
  flatRate?: number | null;
  /** Fixed price per hour for hourly charters. Same precedence as `flatRate`. */
  hourlyRate?: number | null;
  /** The least a booking in this class can cost, before surcharges (e.g. NEMT $297). */
  minimumFare?: number | null;
  /** Charged per intermediate stop on a transfer. Unset = stops are free for this class. */
  stopFee?: number | null;
  /**
   * Per-mile pricing for a flat-rate transfer: the flat rate covers the first `baseMiles`, and
   * every further mile (rounded up) costs `perMileRate`. Both unset = the flat rate is the price
   * however far the trip goes.
   */
  baseMiles?: number | null;
  perMileRate?: number | null;
  /**
   * The longest trip this class will take, in miles (a transfer, measured through its stops).
   * Quoting or booking a longer one is refused. Unset = no limit. Old ABL kept its Executive
   * Sedan and Executive MPV to 60 miles.
   */
  maxMiles?: number | null;
  images: IVehicleImage[];
  /**
   * Retiring a class rather than deleting it. An inactive class disappears from the
   * booking form but still prices and still labels the bookings that already chose it —
   * deleting outright would leave historical bookings pointing at nothing.
   */
  active: boolean;
  /** Display order in the booking form; ties fall back to seats. */
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export type VehicleClassDocument = HydratedDocument<IVehicleClass>;

const imageSchema = new Schema<IVehicleImage>(
  {
    src: { type: String, required: true, trim: true },
    alt: { type: String, required: true, trim: true },
    caption: { type: String, required: true, trim: true },
    key: { type: String, trim: true },
  },
  { _id: false },
);

const vehicleClassSchema = new Schema<IVehicleClass>(
  {
    value: { type: String, required: true, unique: true, trim: true, lowercase: true },
    label: { type: String, required: true, trim: true },
    detail: { type: String, trim: true },
    badge: { type: String, trim: true, maxlength: 40 },
    seats: { type: Number, required: true, min: 1, max: 60 },
    bags: { type: Number, required: true, min: 0, max: 60 },
    multiplier: { type: Number, required: true, min: 0.1, max: 20 },
    usage: { type: String, enum: VEHICLE_USAGES, default: 'all' },
    hourlyMultiplier: { type: Number, min: 0.1, max: 20, default: null },
    flatRate: { type: Number, min: 0, max: 100_000, default: null },
    hourlyRate: { type: Number, min: 0, max: 100_000, default: null },
    minimumFare: { type: Number, min: 0, max: 100_000, default: null },
    stopFee: { type: Number, min: 0, max: 100_000, default: null },
    baseMiles: { type: Number, min: 0, max: 1000, default: null },
    perMileRate: { type: Number, min: 0, max: 1000, default: null },
    maxMiles: { type: Number, min: 1, max: 5000, default: null },
    images: { type: [imageSchema], default: [] },
    active: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export const VehicleClass = model<IVehicleClass>('VehicleClass', vehicleClassSchema);

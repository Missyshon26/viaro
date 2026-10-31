import { Schema, model, type HydratedDocument } from 'mongoose';

export const PACKAGE_STATUSES = ['visible', 'hidden'] as const;
export type PackageStatus = (typeof PACKAGE_STATUSES)[number];

/** What one vehicle class costs for this package. */
export interface IPackageVehicle {
  /** A VehicleClass `value`, e.g. "suv". */
  vehicleClass: string;
  /** Fixed price in dollars for the whole package with this vehicle. */
  price: number;
}

/**
 * A tour or event package (a half-day tour, a wedding send-off, a wine-tasting day…), priced per
 * vehicle class instead of by distance. Operations write these in the console; the booking
 * page lists the visible ones.
 *
 * `image` is a file uploaded through the console (utils/imageStorage, folder "packages"); `key`
 * is its stored name, which is how the file is removed when the image or the package goes.
 */
export interface IPackage {
  name: string;
  description: string;
  /** Free text, e.g. "4 hours" or "Full day". */
  tourLength: string;
  totalPersons: number;
  status: PackageStatus;
  eventTypes: string[];
  vehicles: IPackageVehicle[];
  image?: { src: string; key: string };
  createdAt: Date;
  updatedAt: Date;
}

export type PackageDocument = HydratedDocument<IPackage>;

const packageSchema = new Schema<IPackage>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: '', trim: true, maxlength: 2000 },
    tourLength: { type: String, default: '', trim: true, maxlength: 60 },
    totalPersons: { type: Number, default: 1, min: 1, max: 100 },
    status: { type: String, enum: PACKAGE_STATUSES, default: 'visible', index: true },
    eventTypes: { type: [{ type: String, trim: true, maxlength: 60 }], default: [] },
    vehicles: {
      type: [
        {
          _id: false,
          vehicleClass: { type: String, required: true },
          price: { type: Number, required: true, min: 0 },
        },
      ],
      default: [],
    },
    image: { type: new Schema({ src: String, key: String }, { _id: false }), required: false },
  },
  { timestamps: true },
);

packageSchema.index({ createdAt: -1 });

export const Package = model<IPackage>('Package', packageSchema);

import { Schema, model, Types, type HydratedDocument } from 'mongoose';

export const DRIVER_STATUSES = ['available', 'busy', 'offline'] as const;
export type DriverStatus = (typeof DRIVER_STATUSES)[number];

export const DRIVER_PAYOUT_MODES = ['percentage', 'flat'] as const;

/** How the chauffeur operates — decides which documents are required (driver.documents.ts). */
export const OPERATOR_TYPES = ['independent', 'company'] as const;
export type OperatorType = (typeof OPERATOR_TYPES)[number];

export const DOCUMENT_REVIEW_STATUSES = ['submitted', 'approved', 'rejected'] as const;
export type DocumentReviewStatus = (typeof DOCUMENT_REVIEW_STATUSES)[number];

/** One uploaded file. The bytes live in GridFS (bucket `driverDocuments`), not here. */
export interface IDriverDocumentFile {
  _id: Types.ObjectId;
  /** Requirement key, e.g. 'drivers_license', 'insurance_coi' — see driver.documents.ts. */
  type: string;
  fileId: Types.ObjectId;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  expiresAt?: Date;
  status: DocumentReviewStatus;
  uploadedAt: Date;
}

/** A chauffeur operating as a company supplies these alongside its documents. */
export interface IDriverBusiness {
  legalName?: string;
  entityType?: string;
  registrationStatus?: string;
  /** Washington UBI, or the state registration number elsewhere. */
  ubiNumber?: string;
}
export type DriverPayoutMode = (typeof DRIVER_PAYOUT_MODES)[number];

export interface IDriver {
  userId: Types.ObjectId;
  vehicleClass: string;
  status: DriverStatus;
  rating: number;
  /** Kept alongside `rating` so the running average never needs a full Rating scan. */
  ratingCount: number;
  penaltyCount: number;
  documents: string[];
  operatorType?: OperatorType;
  business?: IDriverBusiness;
  /** A DocumentArray so `.id()`, `.pull()` and sub-document `_id`s are typed. */
  documentFiles: Types.DocumentArray<IDriverDocumentFile>;
  /**
   * What this driver is paid per completed trip, set by whoever owns them:
   * a company for its roster drivers, the admin/platform for everyone else.
   *
   *   percentage -> `value`% of the OWNER'S revenue share for that trip
   *   flat       -> a fixed amount per trip, whatever the fare was
   *
   * Left undefined until the owner sets it, in which case the admin-set default
   * (Admin console → Drivers → Default payout) applies. `setBy` records who agreed it.
   */
  payout?: {
    mode: DriverPayoutMode;
    value: number;
    setBy?: 'admin' | 'company';
    updatedAt?: Date;
  };
  createdAt: Date;
  updatedAt: Date;
}

export type DriverDocument = HydratedDocument<IDriver>;

const driverSchema = new Schema<IDriver>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    vehicleClass: { type: String, required: true, trim: true },
    status: { type: String, enum: DRIVER_STATUSES, default: 'offline', index: true },
    rating: { type: Number, default: 0, min: 0, max: 5 },
    ratingCount: { type: Number, default: 0, min: 0 },
    penaltyCount: { type: Number, default: 0, min: 0, index: true },
    documents: [{ type: String }],
    operatorType: { type: String, enum: OPERATOR_TYPES },
    business: {
      legalName: { type: String, trim: true, maxlength: 200 },
      entityType: { type: String, trim: true, maxlength: 60 },
      registrationStatus: { type: String, trim: true, maxlength: 60 },
      ubiNumber: { type: String, trim: true, maxlength: 40 },
    },
    documentFiles: [
      {
        type: { type: String, required: true, trim: true },
        fileId: { type: Schema.Types.ObjectId, required: true },
        fileName: { type: String, required: true, trim: true, maxlength: 200 },
        mimeType: { type: String, required: true, trim: true },
        sizeBytes: { type: Number, required: true, min: 0 },
        expiresAt: { type: Date },
        status: { type: String, enum: DOCUMENT_REVIEW_STATUSES, default: 'submitted' },
        uploadedAt: { type: Date, required: true },
      },
    ],
    payout: {
      mode: { type: String, enum: DRIVER_PAYOUT_MODES },
      value: { type: Number, min: 0 },
      setBy: { type: String, enum: ['admin', 'company'] },
      updatedAt: { type: Date },
    },
  },
  { timestamps: true },
);

export const Driver = model<IDriver>('Driver', driverSchema);

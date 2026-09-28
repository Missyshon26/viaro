import { Readable } from 'node:stream';
import mongoose, { Types } from 'mongoose';
import { Driver, type OperatorType } from '../../models/Driver';
import { User } from '../../models/User';
import { Company } from '../../models/Company';
import { ApiError } from '../../utils/ApiError';
import type { AuthUser } from '../../middlewares/authGuard';
import { now, toDate } from '../../config/timezone';
import { logger } from '../../utils/logger';

/**
 * Chauffeur documents: what each kind of operator must supply, and the files themselves.
 *
 * Requirements come from operations (chauffeur portal feedback, Sept 2026):
 *
 *   Independent chauffeur — credential, COI naming All Black Limo, driver's licence,
 *   vehicle registration, a passed inspection, the plate, a headshot and a W-9.
 *
 *   Company — legal name and entity type, active registration status and UBI (entered
 *   as details), plus the municipal business licence, WA DOL limousine carrier licence,
 *   a fleet-level COI, and every one of its drivers' licences.
 *
 * Files are stored in MongoDB GridFS (bucket `driverDocuments`). They used to be
 * "uploaded" to a placeholder that stored nothing, so no document a chauffeur sent ever
 * reached anyone. GridFS needs no extra service or credentials — it is the same Atlas
 * database — and can be swapped for S3 behind storeFile/openFile later.
 */

/** Who must be named on an independent chauffeur's certificate of insurance. */
export const INSURANCE_NAMED_PARTY = 'All Black Limo';

export interface DocumentRequirement {
  type: string;
  label: string;
  description: string;
  /** A company uploads one per driver. */
  multiple?: boolean;
  /** Ask for the expiry date so lapses can be flagged. */
  expires?: boolean;
  /** Restrict to images (the headshot). */
  imageOnly?: boolean;
}

export const REQUIREMENTS: Record<OperatorType, DocumentRequirement[]> = {
  independent: [
    {
      type: 'chauffeur_credential',
      label: 'Chauffeur credential',
      description: 'Your current chauffeur / for-hire driver credential.',
      expires: true,
    },
    {
      type: 'insurance_coi',
      label: 'Certificate of Insurance',
      description: `Commercial auto COI with ${INSURANCE_NAMED_PARTY} listed as additional insured and certificate holder.`,
      expires: true,
    },
    {
      type: 'drivers_license',
      label: "Driver's license",
      description: 'Front of a valid driver’s license.',
      expires: true,
    },
    {
      type: 'vehicle_registration',
      label: 'Vehicle registration certificate',
      description: 'Current registration for the vehicle you drive.',
      expires: true,
    },
    {
      type: 'vehicle_inspection',
      label: 'Vehicle inspection (passed)',
      description: 'The latest inspection report showing a pass.',
      expires: true,
    },
    {
      type: 'license_plate',
      label: 'Vehicle license plate',
      description: 'A clear photo of the plate on the vehicle.',
    },
    {
      type: 'headshot',
      label: 'Headshot',
      description: 'A clear, recent photo of your face. It does not need to be professional.',
      imageOnly: true,
    },
    {
      type: 'w9',
      label: 'W-9',
      description: 'A completed, signed IRS Form W-9.',
    },
  ],
  company: [
    {
      type: 'registration_proof',
      label: 'Proof of active registration',
      description: 'Secretary of State / business registry record showing the entity is active.',
    },
    {
      type: 'municipal_business_license',
      label: 'Municipal business license',
      description: 'The city business license for where you operate.',
      expires: true,
    },
    {
      type: 'wa_dol_limousine_license',
      label: 'WA DOL limousine carrier license',
      description: 'Washington Department of Licensing limousine carrier license.',
      expires: true,
    },
    {
      type: 'fleet_coi',
      label: 'Fleet-level Certificate of Insurance',
      description: `Fleet COI covering every vehicle, with ${INSURANCE_NAMED_PARTY} listed as additional insured and certificate holder.`,
      expires: true,
    },
    {
      type: 'drivers_license',
      label: "Drivers' licenses",
      description: 'One upload per driver who will operate under your company — all of them.',
      multiple: true,
      expires: true,
    },
  ],
};

/** Details a company enters rather than uploads. All required. */
export const BUSINESS_FIELDS = ['legalName', 'entityType', 'registrationStatus', 'ubiNumber'] as const;

export const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/* --------------------------------- storage --------------------------------- */

function bucket() {
  const db = mongoose.connection.db;
  if (!db) throw new ApiError(503, 'Document storage is not available right now');
  return new mongoose.mongo.GridFSBucket(db, { bucketName: 'driverDocuments' });
}

async function storeFile(
  data: Buffer,
  meta: { fileName: string; mimeType: string; driverId: string; type: string },
): Promise<Types.ObjectId> {
  const upload = bucket().openUploadStream(meta.fileName, {
    metadata: { contentType: meta.mimeType, driverId: meta.driverId, type: meta.type },
  });
  await new Promise<void>((resolve, reject) => {
    Readable.from(data).pipe(upload).on('finish', () => resolve()).on('error', reject);
  });
  return upload.id as Types.ObjectId;
}

async function deleteFile(fileId: Types.ObjectId) {
  try {
    await bucket().delete(fileId);
  } catch (err) {
    // Already gone is fine; the record is what matters.
    logger.warn('[documents] could not delete stored file', { fileId: String(fileId), err });
  }
}

/* --------------------------------- status ---------------------------------- */

type DriverLike = {
  operatorType?: OperatorType;
  business?: Partial<Record<(typeof BUSINESS_FIELDS)[number], string>>;
  documentFiles?: ArrayLike<{ type: string; status: string }>;
};

/** What is on file against each requirement, and whether the set is complete. */
export function checklist(driver: DriverLike) {
  const operatorType = driver.operatorType ?? null;
  if (!operatorType) return { operatorType, complete: false, missing: ['operatorType'], items: [] };

  const files = Array.from(driver.documentFiles ?? []).filter((f) => f.status !== 'rejected');
  const items = REQUIREMENTS[operatorType].map((req) => {
    const count = files.filter((f) => f.type === req.type).length;
    return { ...req, count, satisfied: count > 0 };
  });

  const missing = items.filter((i) => !i.satisfied).map((i) => i.type);
  if (operatorType === 'company') {
    for (const field of BUSINESS_FIELDS) {
      if (!driver.business?.[field]?.trim()) missing.push(`business.${field}`);
    }
  }

  return { operatorType, complete: missing.length === 0, missing, items };
}

/**
 * Requirements whose current (non-rejected) file has passed its expiry date. A
 * requirement with any unexpired file on record is fine — for company driver licences,
 * one lapsed licence among several does not ground the whole company.
 */
export function expiredDocuments(driver: {
  operatorType?: OperatorType;
  documentFiles?: ArrayLike<{ type: string; status: string; expiresAt?: Date | null }>;
}): string[] {
  if (!driver.operatorType) return [];
  const today = Date.now();
  const files = Array.from(driver.documentFiles ?? []).filter((f) => f.status !== 'rejected');
  return REQUIREMENTS[driver.operatorType]
    .filter((req) => req.expires && !req.multiple)
    .filter((req) => {
      const mine = files.filter((f) => f.type === req.type);
      return mine.length > 0 && mine.every((f) => f.expiresAt && new Date(f.expiresAt).getTime() < today);
    })
    .map((req) => req.label.toLowerCase());
}

async function loadOwnDriver(userId: string) {
  const driver = await Driver.findOne({ userId });
  if (!driver) throw ApiError.notFound('Driver profile not found');
  return driver;
}

function present(driver: InstanceType<typeof Driver>) {
  const status = checklist(driver);
  return {
    ...status,
    insuranceNamedParty: INSURANCE_NAMED_PARTY,
    business: driver.business ?? {},
    requirements: REQUIREMENTS,
    files: driver.documentFiles.map((f) => ({
      _id: String(f._id),
      type: f.type,
      fileName: f.fileName,
      mimeType: f.mimeType,
      sizeBytes: f.sizeBytes,
      expiresAt: f.expiresAt,
      status: f.status,
      uploadedAt: f.uploadedAt,
    })),
  };
}

/**
 * A complete set lifts the "pending documents" hold so the chauffeur can go online.
 * Never the reverse here — suspending someone is an operations decision, not a side
 * effect of deleting a file.
 */
async function releaseHoldIfComplete(userId: string, driver: DriverLike) {
  if (!checklist(driver).complete) return;
  await User.updateOne({ _id: userId, status: 'pending_documents' }, { $set: { status: 'active' } });
}

/* -------------------------------- operations -------------------------------- */

export async function getMyDocuments(userId: string) {
  return present(await loadOwnDriver(userId));
}

export async function setProfile(
  userId: string,
  input: { operatorType: OperatorType; business?: Partial<Record<(typeof BUSINESS_FIELDS)[number], string>> },
) {
  const driver = await loadOwnDriver(userId);
  driver.operatorType = input.operatorType;
  if (input.operatorType === 'company' && input.business) {
    driver.business = { ...(driver.business ?? {}), ...input.business };
  }
  await driver.save();
  await releaseHoldIfComplete(userId, driver);
  return present(driver);
}

export async function upload(
  userId: string,
  input: { type: string; fileName: string; mimeType: string; expiresAt?: string; data: Buffer },
) {
  const driver = await loadOwnDriver(userId);
  if (!driver.operatorType) {
    throw ApiError.badRequest('Choose independent or company before uploading documents');
  }

  const requirement = REQUIREMENTS[driver.operatorType].find((r) => r.type === input.type);
  if (!requirement) throw ApiError.badRequest(`'${input.type}' is not a document we ask for`);
  if (!ALLOWED_MIME.has(input.mimeType)) {
    throw ApiError.badRequest('Upload a PDF or a photo (JPG, PNG, WEBP or HEIC)');
  }
  if (requirement.imageOnly && !input.mimeType.startsWith('image/')) {
    throw ApiError.badRequest(`${requirement.label} must be a photo`);
  }
  if (input.data.length === 0) throw ApiError.badRequest('The file is empty');
  if (input.data.length > MAX_FILE_BYTES) throw ApiError.badRequest('Files can be up to 10 MB');

  const fileName = input.fileName.replace(/[^\w.\- ()]/g, '_').slice(0, 120) || 'document';
  const fileId = await storeFile(input.data, {
    fileName,
    mimeType: input.mimeType,
    driverId: String(driver._id),
    type: input.type,
  });

  // A single-copy requirement is replaced; a per-driver one (company licences) accumulates.
  const replaced = requirement.multiple
    ? []
    : driver.documentFiles.filter((f) => f.type === input.type);
  for (const old of replaced) {
    driver.documentFiles.pull(old._id);
    void deleteFile(old.fileId);
  }

  const expires = input.expiresAt ? new Date(input.expiresAt) : undefined;
  driver.documentFiles.push({
    type: input.type,
    fileId,
    fileName,
    mimeType: input.mimeType,
    sizeBytes: input.data.length,
    expiresAt: expires && !Number.isNaN(expires.getTime()) ? expires : undefined,
    status: 'submitted',
    uploadedAt: toDate(now()),
  });

  // Keep the legacy list in step: older screens and the review check count it.
  const path = `/drivers/documents/${String(driver.documentFiles[driver.documentFiles.length - 1]._id)}/file`;
  driver.documents = [...(driver.documents ?? []).filter((d) => !replaced.some((r) => d.includes(String(r._id)))), path];

  await driver.save();
  await releaseHoldIfComplete(userId, driver);
  return present(driver);
}

export async function remove(userId: string, documentId: string) {
  const driver = await loadOwnDriver(userId);
  const file = driver.documentFiles.id(documentId);
  if (!file) throw ApiError.notFound('Document not found');
  if (file.status === 'approved') {
    throw ApiError.conflict('An approved document cannot be removed — upload a replacement instead');
  }
  driver.documentFiles.pull(file._id);
  driver.documents = (driver.documents ?? []).filter((d) => !d.includes(documentId));
  await driver.save();
  void deleteFile(file.fileId);
  return present(driver);
}

/**
 * The file itself, for the chauffeur who uploaded it, the platform admin, or the
 * company whose roster the chauffeur is on.
 */
export async function openFile(documentId: string, user: AuthUser) {
  if (!Types.ObjectId.isValid(documentId)) throw ApiError.notFound('Document not found');
  const driver = await Driver.findOne({ 'documentFiles._id': documentId });
  const file = driver?.documentFiles.id(documentId);
  if (!driver || !file) throw ApiError.notFound('Document not found');

  const own = String(driver.userId) === user.userId;
  let allowed = own || user.role === 'admin';
  if (!allowed && user.role === 'company') {
    allowed = Boolean(await Company.exists({ userId: user.userId, driverIds: driver._id }));
  }
  if (!allowed) throw ApiError.forbidden('You cannot view this document');

  return {
    stream: bucket().openDownloadStream(file.fileId),
    fileName: file.fileName,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
  };
}

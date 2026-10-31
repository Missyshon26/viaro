import { Package, type IPackage } from '../../models/Package';

/**
 * Data access for the package module — Controller → Service → **Repository**. The only file
 * here that touches Mongoose; it returns plain objects and leaves "not found" as `null`.
 */
export type PackageRecord = IPackage & { _id: import('mongoose').Types.ObjectId };

export async function findAll(filter: { status?: string; search?: RegExp } = {}): Promise<PackageRecord[]> {
  const query: Record<string, unknown> = {};
  if (filter.status) query.status = filter.status;
  if (filter.search) query.$or = [{ name: filter.search }, { description: filter.search }, { eventTypes: filter.search }];
  return Package.find(query).sort({ createdAt: -1 }).lean<PackageRecord[]>();
}

export const findById = (id: string) => Package.findById(id).lean<PackageRecord>();

export async function create(input: Partial<IPackage>): Promise<PackageRecord> {
  return (await Package.create(input)).toObject() as PackageRecord;
}

export const update = (id: string, set: Partial<IPackage>) =>
  Package.findByIdAndUpdate(id, { $set: set }, { returnDocument: 'after', runValidators: true }).lean<PackageRecord>();

export const remove = (id: string) => Package.findByIdAndDelete(id).lean<PackageRecord>();

/** Sets the image and returns the document as it was BEFORE, so the old file can be deleted. */
export const swapImage = (id: string, image: { src: string; key: string } | null) =>
  Package.findOneAndUpdate(
    { _id: id },
    image ? { $set: { image } } : { $unset: { image: 1 } },
    { returnDocument: 'before' },
  ).lean<PackageRecord>();

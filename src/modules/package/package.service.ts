import { ApiError } from '../../utils/ApiError';
import { ImageRejected, deleteImage, publicImageUrl, saveImage } from '../../utils/imageStorage';
import * as vehicleRepo from '../vehicle/vehicle.repository';
import * as repo from './package.repository';
import type { CreatePackageInput, ListPackagesQuery, UpdatePackageInput } from './package.validation';

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The record as the console and the booking page read it: ids as strings, image as a full link. */
function present(record: repo.PackageRecord) {
  const { _id, image, ...rest } = record;
  return {
    ...rest,
    _id: String(_id),
    image: image?.src ? { src: publicImageUrl(image.src), key: image.key } : null,
  };
}

/** Every vehicle named on a package must be a class we actually have. */
async function assertVehiclesExist(lines: { vehicleClass: string }[]) {
  for (const { vehicleClass } of lines) {
    if (!(await vehicleRepo.findByValue(vehicleClass))) {
      throw ApiError.badRequest(`There is no vehicle class "${vehicleClass}"`);
    }
  }
}

export async function listForAdmin(q: ListPackagesQuery) {
  const records = await repo.findAll({
    status: q.status,
    search: q.q ? new RegExp(escapeRegex(q.q), 'i') : undefined,
  });
  return records.map(present);
}

export async function getForAdmin(id: string) {
  const record = await repo.findById(id);
  if (!record) throw ApiError.notFound('Package not found');
  return present(record);
}

export async function create(input: CreatePackageInput) {
  await assertVehiclesExist(input.vehicles);
  return present(await repo.create(input));
}

export async function update(id: string, input: UpdatePackageInput) {
  if (input.vehicles) await assertVehiclesExist(input.vehicles);
  const record = await repo.update(id, input);
  if (!record) throw ApiError.notFound('Package not found');
  return present(record);
}

export async function remove(id: string) {
  const record = await repo.remove(id);
  if (!record) throw ApiError.notFound('Package not found');
  if (record.image?.key) await deleteImage('packages', record.image.key);
  return { _id: String(record._id) };
}

/** Replaces the package's picture. A failed save never leaves a stray file behind. */
export async function setImage(id: string, bytes: Buffer) {
  if (!(await repo.findById(id))) throw ApiError.notFound('Package not found');

  let stored;
  try {
    stored = await saveImage('packages', bytes);
  } catch (err) {
    if (err instanceof ImageRejected) {
      throw new ApiError(err.reason === 'too_large' ? 413 : 400, err.message, { code: `IMAGE_${err.reason.toUpperCase()}` });
    }
    throw err;
  }

  const before = await repo.swapImage(id, { src: stored.path, key: stored.key });
  if (!before) {
    await deleteImage('packages', stored.key);
    throw ApiError.notFound('That package was removed, so the picture was not saved.');
  }
  if (before.image?.key) await deleteImage('packages', before.image.key);
  return getForAdmin(id);
}

export async function removeImage(id: string) {
  const before = await repo.swapImage(id, null);
  if (!before) throw ApiError.notFound('Package not found');
  if (before.image?.key) await deleteImage('packages', before.image.key);
  return getForAdmin(id);
}

/* ------------------------------ booking page ------------------------------ */

/**
 * What a visitor sees: visible packages only, each vehicle with its class details, and a class
 * that has since been switched off is left out (it can no longer be booked).
 */
async function forVisitors(records: repo.PackageRecord[]) {
  const classes = new Map((await vehicleRepo.findAll(false)).map((c) => [c.value, c]));
  return records.map((record) => {
    const { status: _status, createdAt: _c, updatedAt: _u, ...visible } = present(record);
    return {
      ...visible,
      vehicles: record.vehicles.flatMap((line) => {
        const cls = classes.get(line.vehicleClass);
        return cls ? [{ vehicleClass: line.vehicleClass, label: cls.label, seats: cls.seats, bags: cls.bags, price: line.price }] : [];
      }),
    };
  });
}

export async function listVisible() {
  return forVisitors(await repo.findAll({ status: 'visible' }));
}

export async function getVisible(id: string) {
  const record = await repo.findById(id);
  if (!record || record.status !== 'visible') throw ApiError.notFound('Package not found');
  return (await forVisitors([record]))[0];
}

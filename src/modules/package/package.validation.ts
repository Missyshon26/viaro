import { z } from 'zod';

const objectId = z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid id');

export const idParamSchema = z.object({ id: objectId });

const vehicleLine = z.object({
  vehicleClass: z.string().trim().min(1).max(60),
  price: z.coerce.number().min(0).max(1_000_000),
});

const fields = {
  name: z.string().trim().min(2, 'Give the package a name').max(120),
  description: z.string().trim().max(2000),
  tourLength: z.string().trim().max(60),
  totalPersons: z.coerce.number().int().min(1).max(100),
  status: z.enum(['visible', 'hidden']),
  eventTypes: z.array(z.string().trim().min(1).max(60)).max(20),
  vehicles: z
    .array(vehicleLine)
    .max(30)
    .refine((lines) => new Set(lines.map((l) => l.vehicleClass)).size === lines.length, 'Each vehicle can be listed once'),
};

export const createPackageSchema = z.object({
  name: fields.name,
  description: fields.description.default(''),
  tourLength: fields.tourLength.default(''),
  totalPersons: fields.totalPersons.default(1),
  status: fields.status.default('visible'),
  eventTypes: fields.eventTypes.default([]),
  vehicles: fields.vehicles.default([]),
});

export const updatePackageSchema = z
  .object({
    name: fields.name,
    description: fields.description,
    tourLength: fields.tourLength,
    totalPersons: fields.totalPersons,
    status: fields.status,
    eventTypes: fields.eventTypes,
    vehicles: fields.vehicles,
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'Nothing to change');

export const listPackagesQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.enum(['visible', 'hidden']).optional(),
});

export type CreatePackageInput = z.infer<typeof createPackageSchema>;
export type UpdatePackageInput = z.infer<typeof updatePackageSchema>;
export type ListPackagesQuery = z.infer<typeof listPackagesQuerySchema>;

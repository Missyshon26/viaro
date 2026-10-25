import { api } from "./client";

/**
 * The vehicle catalogue.
 *
 * Backed by a collection rather than a constant, so operations owns it: changing a
 * class multiplier is a pricing decision and should not need a deploy, the same reason
 * city base fares are already editable here.
 */
export interface VehicleImage {
  /** Absolute url. Photos uploaded here also carry a `key`; older ones may not. */
  src: string;
  key?: string;
  alt: string;
  caption: string;
}

export interface VehicleClass {
  _id: string;
  /** Stored on every booking. Immutable once created. */
  value: string;
  label: string;
  detail?: string;
  seats: number;
  bags: number;
  /** Fare = city base fare × peak multiplier × hours × this. */
  multiplier: number;
  /** all · hourly (charters only) · transfer (point-to-point and airport only). */
  usage?: VehicleUsage;
  /** Hourly-charter multiplier when it differs from `multiplier`; null = same. */
  hourlyMultiplier?: number | null;
  /** Fixed transfer price, $. When set it replaces the multiplier for transfers. */
  flatRate?: number | null;
  /** Fixed hourly-charter price, $/hr. When set it replaces the multiplier for hourly. */
  hourlyRate?: number | null;
  /** Floor on the fare before surcharges, $. */
  minimumFare?: number | null;
  /** Charged per intermediate stop on a transfer; unset or 0 means stops are free. */
  stopFee?: number | null;
  /** The flat transfer rate covers this many miles; each mile beyond costs `perMileRate`. Both unset = flat however far. */
  baseMiles?: number | null;
  perMileRate?: number | null;
  images: VehicleImage[];
  active: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** `includeInactive` is honoured for admins only; the API ignores it for anyone else. */
export const listVehicleClasses = (includeInactive = false) =>
  api.get<VehicleClass[]>("/vehicle-classes", {
    query: includeInactive ? { includeInactive: true } : {},
  });

export type VehicleUsage = "all" | "hourly" | "transfer";

export const USAGE_LABEL: Record<VehicleUsage, string> = {
  all: "Transfers & hourly",
  transfer: "Transfers only",
  hourly: "Hourly only",
};

export interface VehicleClassInput {
  value?: string;
  label: string;
  detail?: string;
  seats: number;
  bags: number;
  multiplier: number;
  usage?: VehicleUsage;
  hourlyMultiplier?: number | null;
  flatRate?: number | null;
  hourlyRate?: number | null;
  minimumFare?: number | null;
  stopFee?: number | null;
  baseMiles?: number | null;
  perMileRate?: number | null;
  active?: boolean;
  sortOrder?: number;
  images?: VehicleImage[];
}

export const createVehicleClass = (input: VehicleClassInput & { value: string }) =>
  api.post<VehicleClass>("/admin/vehicle-classes", input);

/** `value` cannot be changed — it is the key every existing booking stored. */
export const updateVehicleClass = (id: string, input: Partial<Omit<VehicleClassInput, "value">>) =>
  api.patch<VehicleClass>(`/admin/vehicle-classes/${id}`, input);

export const deleteVehicleClass = (id: string) =>
  api.delete<VehicleClass>(`/admin/vehicle-classes/${id}`);

/* --------------------------------- photos ---------------------------------- */

/** The server accepts JPEG, PNG or WebP up to 5 MB, and ten photos per class. */
export const MAX_PHOTOS = 10;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Uploads one photo; resolves with the whole updated class. */
export const uploadVehiclePhoto = (id: string, file: File) => {
  const form = new FormData();
  form.append("file", file);
  return api.post<VehicleClass>(`/admin/vehicle-classes/${id}/images`, form);
};

export const updateVehiclePhoto = (
  id: string,
  key: string,
  input: { alt?: string; caption?: string; cover?: true },
) => api.patch<VehicleClass>(`/admin/vehicle-classes/${id}/images/${key}`, input);

export const removeVehiclePhoto = (id: string, key: string) =>
  api.delete<VehicleClass>(`/admin/vehicle-classes/${id}/images/${key}`);

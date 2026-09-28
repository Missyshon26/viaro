import { api } from "./client";

/**
 * The vehicle catalogue.
 *
 * Backed by a collection rather than a constant, so operations owns it: changing a
 * class multiplier is a pricing decision and should not need a deploy, the same reason
 * city base fares are already editable here.
 */
export interface VehicleImage {
  src: string;
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

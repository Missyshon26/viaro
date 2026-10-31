import { api } from "./client";

/**
 * Tour and event packages: a name, a picture and a fixed price per vehicle class. The booking
 * page lists the visible ones.
 */
export type PackageStatus = "visible" | "hidden";

export interface PackageVehicle {
  /** A vehicle class `value`, e.g. "suv". */
  vehicleClass: string;
  /** Fixed price in dollars for the whole package with this vehicle. */
  price: number;
}

export interface TourPackage {
  _id: string;
  name: string;
  description: string;
  tourLength: string;
  totalPersons: number;
  status: PackageStatus;
  eventTypes: string[];
  vehicles: PackageVehicle[];
  /** Absolute url; `key` is the stored file's name. */
  image: { src: string; key: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface PackageInput {
  name: string;
  description: string;
  tourLength: string;
  totalPersons: number;
  status: PackageStatus;
  eventTypes: string[];
  vehicles: PackageVehicle[];
}

export const listPackages = () => api.get<TourPackage[]>("/admin/packages");
export const createPackage = (input: PackageInput) => api.post<TourPackage>("/admin/packages", input);
export const updatePackage = (id: string, input: Partial<PackageInput>) =>
  api.patch<TourPackage>(`/admin/packages/${id}`, input);
export const deletePackage = (id: string) => api.delete<{ _id: string }>(`/admin/packages/${id}`);

/** The server accepts JPEG, PNG or WebP up to 5 MB. */
export const MAX_PACKAGE_IMAGE_BYTES = 5 * 1024 * 1024;
export const PACKAGE_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Replaces the package's picture; resolves with the whole updated package. */
export const uploadPackageImage = (id: string, file: File) => {
  const form = new FormData();
  form.append("file", file);
  return api.post<TourPackage>(`/admin/packages/${id}/image`, form);
};
export const removePackageImage = (id: string) => api.delete<TourPackage>(`/admin/packages/${id}/image`);

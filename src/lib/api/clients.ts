import { api, downloadFile } from "./client";
import { exportPath, filterQuery, type ClientAddress, type ClientFilters } from "@/lib/clients";
import type { Paginated, User } from "./types";

/**
 * The clients (customers) the operations team manages: list, add, edit, download.
 *
 * A client is a customer account. Operations adds one on someone's behalf and corrects
 * their details, but never sees or sets a password — the client is emailed a link to choose
 * their own.
 */
export interface Client extends User {
  /** How many bookings they have made, and when the latest one is for. */
  bookings: number;
  lastBookingAt: string | null;
}

export const listClients = (filters: ClientFilters, page = 1, limit = 50) =>
  api.get<Paginated<Client>>(`/admin/customers${filterQuery(filters, { page, limit })}`);

export interface NewClientInput {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address?: ClientAddress;
  sendInvite: boolean;
}

/** `inviteSent` is false when the email could not be sent, so the operator can follow up. */
export const createClient = (input: NewClientInput) =>
  api.post<{ user: User; inviteSent: boolean }>("/admin/customers", input);

export const updateClient = (id: string, input: Record<string, unknown>) =>
  api.patch<User>(`/admin/customers/${id}`, input);

/**
 * An admin correcting any account's details, whatever its role: customer, driver, company or
 * admin. The same fields as editing a client; the role itself is never changed.
 */
export const updateUser = (id: string, input: Record<string, unknown>) =>
  api.patch<User>(`/admin/users/${id}`, input);

/** The list, with the same filters the screen is showing, as a file the browser saves. */
export const downloadClients = (filters: ClientFilters, format: "xlsx" | "csv") =>
  downloadFile(exportPath(filters, format), `abl-clients.${format}`);

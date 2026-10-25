/**
 * The clients screen's pure logic: turning the add/edit form into what the API takes, and
 * the filters into a query string. No React and no fetching, so it can be tested on its own.
 */

export interface ClientAddress {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
}

export interface ClientFormValues {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  status: "active" | "suspended" | "pending_documents";
  /** Only meaningful when adding: send the set-your-password email. */
  sendInvite: boolean;
}

export interface ClientLike {
  name: string;
  firstName?: string;
  lastName?: string;
  email: string;
  phone: string;
  status: ClientFormValues["status"];
  address?: ClientAddress;
}

export const emptyClientForm = (): ClientFormValues => ({
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  line1: "",
  line2: "",
  city: "",
  state: "",
  postalCode: "",
  status: "active",
  sendInvite: true,
});

/** Accounts made before first/last names existed only have a full name; split it on the first space. */
export function splitName(name: string): { firstName: string; lastName: string } {
  const trimmed = name.trim().replace(/\s+/g, " ");
  const space = trimmed.indexOf(" ");
  return space === -1
    ? { firstName: trimmed, lastName: "" }
    : { firstName: trimmed.slice(0, space), lastName: trimmed.slice(space + 1) };
}

export function formFromClient(client: ClientLike): ClientFormValues {
  const names =
    client.firstName !== undefined || client.lastName !== undefined
      ? { firstName: client.firstName ?? "", lastName: client.lastName ?? "" }
      : splitName(client.name);
  return {
    ...names,
    email: client.email,
    phone: client.phone,
    line1: client.address?.line1 ?? "",
    line2: client.address?.line2 ?? "",
    city: client.address?.city ?? "",
    state: client.address?.state ?? "",
    postalCode: client.address?.postalCode ?? "",
    status: client.status,
    sendInvite: true,
  };
}

/** The address boxes as the API takes it: nothing when they are all empty, else as typed. */
export function addressOf(form: ClientFormValues): ClientAddress | null {
  const t = (s: string) => s.trim();
  const boxes = [form.line1, form.line2, form.city, form.state, form.postalCode].map(t);
  if (boxes.every((b) => b === "")) return null;
  return {
    line1: t(form.line1),
    ...(t(form.line2) ? { line2: t(form.line2) } : {}),
    city: t(form.city),
    state: t(form.state),
    postalCode: t(form.postalCode),
  };
}

export function createPayload(form: ClientFormValues) {
  const address = addressOf(form);
  return {
    firstName: form.firstName.trim(),
    lastName: form.lastName.trim(),
    email: form.email.trim(),
    phone: form.phone.trim(),
    ...(address ? { address } : {}),
    sendInvite: form.sendInvite,
  };
}

/**
 * Only what the operator actually changed. Sending the lot would re-save an unchanged
 * email (harmless) but also un-verify an unchanged phone on some code paths and, worse,
 * make "what did this person edit?" unanswerable. An empty object means nothing to save.
 */
export function updatePayload(form: ClientFormValues, client: ClientLike) {
  const before = formFromClient(client);
  const out: Record<string, unknown> = {};

  if (form.firstName.trim() !== before.firstName || form.lastName.trim() !== before.lastName) {
    out.firstName = form.firstName.trim();
    out.lastName = form.lastName.trim();
  }
  if (form.email.trim().toLowerCase() !== before.email.toLowerCase()) out.email = form.email.trim();
  if (form.phone.trim() !== before.phone) out.phone = form.phone.trim();
  if (form.status !== before.status) out.status = form.status;

  const now = addressOf(form);
  const was = addressOf(before);
  if (JSON.stringify(now) !== JSON.stringify(was)) out.address = now; // null removes it
  return out;
}

export interface ClientFilters {
  search: string;
  status: "" | ClientFormValues["status"];
  guest: "" | "true" | "false";
}

/** The query string for the list and the download — one function, so they can never disagree. */
export function filterQuery(filters: ClientFilters, extra: Record<string, string | number> = {}): string {
  const params = new URLSearchParams();
  if (filters.search.trim()) params.set("search", filters.search.trim());
  if (filters.status) params.set("status", filters.status);
  if (filters.guest) params.set("guest", filters.guest);
  for (const [key, value] of Object.entries(extra)) params.set(key, String(value));
  const text = params.toString();
  return text ? `?${text}` : "";
}

export const exportPath = (filters: ClientFilters, format: "xlsx" | "csv") =>
  `/admin/customers/export${filterQuery(filters, { format })}`;

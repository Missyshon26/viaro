import { z } from 'zod';

/**
 * Name and address helpers shared by the customer's own profile and the admin's client
 * screen, so the two cannot disagree about what a valid address is or how a full name is
 * made.
 */

export interface NameParts {
  firstName: string;
  lastName: string;
}

/**
 * Splits a full name on the FIRST space: "Mary Jane Watson" is first "Mary", last
 * "Jane Watson". Accounts made before first and last names existed only have the full
 * name, and this is how their profile form gets something sensible to show.
 */
export function splitName(name: string): NameParts {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  const space = trimmed.indexOf(' ');
  if (space === -1) return { firstName: trimmed, lastName: '' };
  return { firstName: trimmed.slice(0, space), lastName: trimmed.slice(space + 1) };
}

/** The display name every other screen, email and document uses. */
export function joinName(firstName?: string | null, lastName?: string | null): string {
  return [firstName, lastName]
    .map((p) => (p ?? '').trim())
    .filter(Boolean)
    .join(' ');
}

/* -------------------------------- address --------------------------------- */

export interface Address {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
}

/**
 * A postal address. Street, city, state and postcode are required together — half an
 * address is of no use on an invoice — and the second line (flat, suite) is optional.
 */
export const addressSchema = z.object({
  line1: z.string().trim().min(3, 'Enter the street address').max(120),
  line2: z.string().trim().max(120).optional(),
  city: z.string().trim().min(2, 'Enter the city').max(80),
  state: z.string().trim().min(2, 'Enter the state').max(40),
  postalCode: z
    .string()
    .trim()
    .min(3, 'Enter the postal code')
    .max(12)
    .regex(/^[A-Za-z0-9][A-Za-z0-9 -]*$/, 'Use letters, numbers and spaces only'),
});

/** One line, for a spreadsheet cell or an invoice: "123 Pine St, Apt 4, Seattle, WA 98101". */
export function formatAddress(address?: Partial<Address> | null): string {
  if (!address?.line1) return '';
  const cityLine = [address.city, [address.state, address.postalCode].filter(Boolean).join(' ')]
    .map((p) => (p ?? '').trim())
    .filter(Boolean)
    .join(', ');
  return [address.line1, address.line2, cityLine]
    .map((p) => (p ?? '').trim())
    .filter(Boolean)
    .join(', ');
}

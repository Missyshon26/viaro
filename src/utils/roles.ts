/** The four actors from the UML use-case diagram. Single source of truth for role strings. */
export const ROLES = ['customer', 'driver', 'admin', 'company'] as const;

export type UserRole = (typeof ROLES)[number];

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

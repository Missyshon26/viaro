import type { UserRole } from '../src/utils/roles';

/**
 * WHO MAY CALL WHAT — the declared intent for every route the app serves.
 *
 * This table is the specification, not a description: `authorization.spec.ts` asserts
 * the running app agrees with it, in both directions.
 *
 *   - a role NOT listed must get 403
 *   - a role listed must NOT get 403
 *   - every route the app serves must appear here (and vice versa)
 *
 * That last rule is the point of the file. Adding an endpoint without deciding who may
 * reach it fails the suite, so the decision can never be skipped silently.
 *
 * Two special values:
 *   PUBLIC   — no authentication at all (and no token still succeeds)
 *   ANY_ROLE — authGuard only; ownership is enforced in the service, not by role
 */
export const PUBLIC = 'PUBLIC' as const;
export const ANY_ROLE = 'ANY_ROLE' as const;

export type Allowed = UserRole[] | typeof PUBLIC | typeof ANY_ROLE;

export interface MatrixEntry {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  allowed: Allowed;
  /** Why, when the answer is not obvious from the path. */
  note?: string;
  /**
   * The response is held open and never completes (Server-Sent Events).
   *
   * The suite normally awaits the whole response to read its status, which for a stream
   * would hang until the test timed out. Marked entries are asserted on their headers
   * and then aborted instead — the guard decision has already been made by then, which
   * is the only thing this file is about.
   */
  streaming?: boolean;
}

export const MATRIX: MatrixEntry[] = [
  /* ---------------------------------- auth --------------------------------- */
  { method: 'POST', path: '/auth/register', allowed: PUBLIC },
  { method: 'POST', path: '/auth/login', allowed: PUBLIC },
  { method: 'POST', path: '/auth/guest', allowed: PUBLIC },
  { method: 'POST', path: '/auth/google', allowed: PUBLIC },
  { method: 'POST', path: '/auth/refresh', allowed: PUBLIC },
  { method: 'POST', path: '/auth/password/forgot', allowed: PUBLIC },
  { method: 'POST', path: '/auth/password/reset', allowed: PUBLIC },
  { method: 'POST', path: '/auth/logout', allowed: ANY_ROLE },
  { method: 'POST', path: '/auth/phone/send-code', allowed: ANY_ROLE },
  { method: 'POST', path: '/auth/phone/verify', allowed: ANY_ROLE },

  /* --------------------------------- users --------------------------------- */
  { method: 'GET', path: '/users/me', allowed: ANY_ROLE },
  { method: 'PATCH', path: '/users/me', allowed: ANY_ROLE },
  { method: 'DELETE', path: '/users/me', allowed: ANY_ROLE, note: 'soft delete, any role' },
  { method: 'POST', path: '/users/me/documents', allowed: ['driver'] },
  { method: 'GET', path: '/users/me/agreement', allowed: ['customer'] },
  { method: 'PUT', path: '/users/me/agreement', allowed: ['customer'] },
  { method: 'GET', path: '/users/me/favorites', allowed: ['customer'] },
  { method: 'POST', path: '/users/me/favorites/:driverId', allowed: ['customer'] },
  { method: 'DELETE', path: '/users/me/favorites/:driverId', allowed: ['customer'] },
  { method: 'GET', path: '/users/me/rides', allowed: ['customer'] },
  { method: 'GET', path: '/users/me/rides/:id/receipt', allowed: ['customer'] },

  /* -------------------------------- bookings -------------------------------- */
  { method: 'POST', path: '/bookings', allowed: ['customer'] },
  {
    method: 'POST',
    path: '/bookings/checkout/intent',
    allowed: ['customer'],
    note: 'card checkout step 1: price + PaymentIntent',
  },
  {
    method: 'POST',
    path: '/bookings/checkout',
    allowed: ['customer'],
    note: 'card checkout step 3: book once paid; payment ownership checked in completeCheckout',
  },
  {
    method: 'GET',
    path: '/bookings/:id',
    allowed: ['customer', 'admin', 'company'],
    note: 'ownership checked in loadOwnBooking for customers',
  },
  { method: 'PATCH', path: '/bookings/:id', allowed: ['customer'] },
  {
    method: 'GET',
    path: '/bookings/:id/documents/:kind',
    allowed: ['customer', 'admin'],
    note: 'invoice / receipt PDF; a customer only gets their own booking (checked in the service)',
  },
  { method: 'DELETE', path: '/bookings/:id', allowed: ['customer'] },
  { method: 'POST', path: '/bookings/:id/favorite-driver', allowed: ['customer'] },

  /* --------------------------------- trips ---------------------------------- */
  { method: 'GET', path: '/trips', allowed: ['customer', 'driver', 'admin', 'company'] },
  {
    method: 'GET',
    path: '/trips/:id',
    allowed: ['customer', 'driver', 'admin', 'company'],
    note: 'fareAmount stripped for drivers — spec §8 rule 2',
  },
  { method: 'POST', path: '/trips/:id/accept', allowed: ['driver'] },
  { method: 'POST', path: '/trips/:id/no-show', allowed: ['admin'] },
  { method: 'POST', path: '/trips/:id/no-show/revert', allowed: ['admin'] },
  { method: 'POST', path: '/trips/:id/enroute', allowed: ['driver'] },
  { method: 'POST', path: '/trips/:id/arrived', allowed: ['driver'] },
  { method: 'POST', path: '/trips/:id/start', allowed: ['driver'] },
  { method: 'POST', path: '/trips/:id/complete', allowed: ['driver'] },
  { method: 'POST', path: '/trips/:id/cancel', allowed: ['driver'] },
  { method: 'POST', path: '/trips/:id/rate', allowed: ['customer'] },
  {
    method: 'PATCH',
    path: '/trips/:id/status',
    allowed: ['admin'],
    note: 'operations override — settles money, so never the driver or the customer',
  },
  { method: 'PATCH', path: '/trips/:id/location', allowed: ['customer'] },
  { method: 'PATCH', path: '/trips/:id/vehicle-class', allowed: ['customer'] },
  { method: 'GET', path: '/trips/:id/chat/history', allowed: ['customer', 'driver', 'admin'] },
  { method: 'POST', path: '/trips/:id/chat/messages', allowed: ['customer', 'driver'] },

  /* ----------------------------- cancellation ------------------------------- */
  { method: 'POST', path: '/trips/:id/cancel/point-to-point', allowed: ['customer'] },
  { method: 'POST', path: '/trips/:id/cancel/airport', allowed: ['customer'] },
  { method: 'POST', path: '/trips/:id/cancel/hourly', allowed: ['customer'] },

  /* -------------------------------- pricing --------------------------------- */
  {
    method: 'GET',
    path: '/pricing/fare-estimate',
    allowed: PUBLIC,
    note: 'the booking form quotes before sign-in; only a signed-in customer is quoted their own discounts',
  },
  { method: 'POST', path: '/subscriptions', allowed: ['customer'] },
  // The plan catalogue: prices moved server-side, so customers read them from here.
  { method: 'GET', path: '/subscriptions/plans', allowed: ['customer'] },
  { method: 'GET', path: '/subscriptions/me', allowed: ['customer'] },
  { method: 'DELETE', path: '/subscriptions/me', allowed: ['customer'] },

  /* --------------------------------- driver --------------------------------- */
  { method: 'GET', path: '/drivers/me', allowed: ['driver'] },
  { method: 'PATCH', path: '/drivers/me/status', allowed: ['driver'] },
  { method: 'POST', path: '/drivers/apply', allowed: ['driver'] },
  { method: 'GET', path: '/drivers/me/documents', allowed: ['driver'] },
  { method: 'PATCH', path: '/drivers/me/documents/profile', allowed: ['driver'] },
  { method: 'POST', path: '/drivers/me/documents', allowed: ['driver'] },
  { method: 'DELETE', path: '/drivers/me/documents/:documentId', allowed: ['driver'] },
  {
    method: 'GET',
    path: '/drivers/documents/:documentId/file',
    allowed: ['driver', 'admin', 'company'],
    note: 'ownership re-checked in driver.documents.openFile',
  },

  /* -------------------------------- packages -------------------------------- */
  {
    method: 'GET',
    path: '/packages',
    allowed: PUBLIC,
    note: 'the booking page lists the visible packages before sign-in',
  },
  { method: 'GET', path: '/packages/:id', allowed: PUBLIC, note: 'a visible package; hidden ones are 404' },
  { method: 'GET', path: '/admin/event-types', allowed: ['admin'] },
  { method: 'POST', path: '/admin/event-types', allowed: ['admin'] },
  { method: 'PATCH', path: '/admin/event-types/:id', allowed: ['admin'] },
  { method: 'DELETE', path: '/admin/event-types/:id', allowed: ['admin'] },
  { method: 'GET', path: '/admin/packages', allowed: ['admin'] },
  { method: 'POST', path: '/admin/packages', allowed: ['admin'] },
  { method: 'GET', path: '/admin/packages/:id', allowed: ['admin'] },
  { method: 'PATCH', path: '/admin/packages/:id', allowed: ['admin'] },
  { method: 'DELETE', path: '/admin/packages/:id', allowed: ['admin'] },
  { method: 'POST', path: '/admin/packages/:id/image', allowed: ['admin'] },
  { method: 'DELETE', path: '/admin/packages/:id/image', allowed: ['admin'] },

  /* ---------------------------- vehicle catalogue --------------------------- */
  {
    method: 'GET',
    path: '/vehicle-classes',
    allowed: PUBLIC,
    note: 'the booking form is shown before sign-in; visitors get the catalogue without its pricing inputs',
  },
  { method: 'POST', path: '/admin/vehicle-classes', allowed: ['admin'] },
  { method: 'PATCH', path: '/admin/vehicle-classes/:id', allowed: ['admin'] },
  { method: 'DELETE', path: '/admin/vehicle-classes/:id', allowed: ['admin'] },
  { method: 'POST', path: '/admin/bookings', allowed: ['admin'] },
  { method: 'POST', path: '/admin/bookings/quote', allowed: ['admin'] },
  { method: 'POST', path: '/admin/bookings/:id/payment-link', allowed: ['admin'] },
  { method: 'POST', path: '/admin/bookings/:id/refund', allowed: ['admin'] },
  { method: 'POST', path: '/admin/bookings/:id/reject', allowed: ['admin'] },
  { method: 'POST', path: '/admin/bookings/:id/email-invoice', allowed: ['admin'] },
  { method: 'POST', path: '/admin/bookings/:id/calendar-sync', allowed: ['admin'] },
  { method: 'GET', path: '/admin/calendar/status', allowed: ['admin'] },
  { method: 'POST', path: '/admin/users/:id/agreement/review', allowed: ['admin'] },
  { method: 'POST', path: '/admin/bookings/journey', allowed: ['admin'] },
  { method: 'POST', path: '/admin/bookings/journey/quote', allowed: ['admin'] },
  { method: 'POST', path: '/admin/vehicle-classes/:id/images', allowed: ['admin'] },
  { method: 'PATCH', path: '/admin/vehicle-classes/:id/images/:key', allowed: ['admin'] },
  { method: 'DELETE', path: '/admin/vehicle-classes/:id/images/:key', allowed: ['admin'] },

  /* -------------------------------- dispatch -------------------------------- */
  { method: 'GET', path: '/dispatch/pool', allowed: ['driver', 'admin'] },
  { method: 'GET', path: '/admin/dispatch/pool', allowed: ['admin'] },
  {
    method: 'POST',
    path: '/admin/dispatch/:id/assign',
    allowed: ['admin'],
    note: 'UML «Assign Driver to Booking» — the diagram draws no actor but Admin on it',
  },
  {
    method: 'POST',
    path: '/admin/dispatch/:id/publish',
    allowed: ['admin'],
    note: 'manual retry of the otherwise-automatic broadcast',
  },

  /* --------------------------------- wallet --------------------------------- */
  { method: 'GET', path: '/wallet/me', allowed: ['customer', 'driver'] },
  {
    method: 'POST',
    path: '/wallet/withdraw',
    allowed: ['driver'],
    note: 'customers cannot withdraw — the design says otherwise, FRONTEND-STATUS §4',
  },
  { method: 'POST', path: '/wallet/use-credit', allowed: ['customer'] },
  {
    method: 'POST',
    path: '/wallet/release-credit',
    allowed: ['customer', 'admin'],
    note: 'undo for use-credit; the customer who applied it, or ops on their behalf',
  },

  /* ------------------------------- payments --------------------------------- */
  { method: 'POST', path: '/payments/webhook', allowed: PUBLIC, note: 'signature-verified' },
  { method: 'POST', path: '/payments/collect', allowed: ['admin', 'company'] },
  {
    method: 'GET',
    path: '/payments/methods',
    allowed: ['customer'],
    note: 'the card vault is under /payments, NOT /wallet',
  },
  { method: 'POST', path: '/payments/methods', allowed: ['customer'] },
  { method: 'DELETE', path: '/payments/methods/:id', allowed: ['customer'] },

  /* --------------------------------- events --------------------------------- */
  {
    method: 'GET',
    path: '/events/stream',
    allowed: ANY_ROLE,
    streaming: true,
    note: 'every role may open a stream; per-event addressing decides what they hear',
  },

  /* ----------------------------- notifications ------------------------------ */
  { method: 'GET', path: '/notifications', allowed: ANY_ROLE },
  { method: 'PATCH', path: '/notifications/:id/read', allowed: ANY_ROLE },

  /* --------------------------------- flight --------------------------------- */
  {
    method: 'GET',
    path: '/flight/:flightNumber',
    allowed: ['driver', 'admin', 'customer'],
    note: 'customers check their own flight from the booking form; rate-limited per user',
  },

  /* -------------------------------- support --------------------------------- */
  { method: 'POST', path: '/support/tickets', allowed: ['customer', 'driver', 'admin'] },
  { method: 'GET', path: '/support/tickets', allowed: ['customer', 'driver', 'admin'] },
  { method: 'GET', path: '/support/tickets/:id', allowed: ['customer', 'driver', 'admin'] },
  {
    method: 'POST',
    path: '/support/tickets/:id/messages',
    allowed: ['customer', 'driver', 'admin'],
  },
  { method: 'PATCH', path: '/support/tickets/:id', allowed: ['admin'], note: 'triage only' },

  /* -------------------------------- reports --------------------------------- */
  { method: 'GET', path: '/reports', allowed: ['driver', 'admin', 'company'] },
  { method: 'GET', path: '/reports/trips-completed', allowed: ['driver', 'admin', 'company'] },
  { method: 'GET', path: '/reports/earnings-payout', allowed: ['driver', 'admin', 'company'] },
  { method: 'GET', path: '/reports/monthly', allowed: ['driver'] },
  {
    method: 'GET',
    path: '/reports/cancellations-penalties',
    allowed: ['driver', 'admin', 'company'],
  },
  { method: 'GET', path: '/reports/exports/:jobId', allowed: ['driver', 'admin', 'company'] },
  {
    method: 'GET',
    path: '/reports/exports/:jobId/download',
    allowed: ['driver', 'admin', 'company'],
  },

  /* ------------------------ admin / company management ---------------------- */
  {
    method: 'POST',
    path: '/admin/drivers',
    allowed: ['company'],
    note: 'company-only: admin cannot create a driver',
  },
  { method: 'GET', path: '/admin/drivers', allowed: ['admin', 'company'] },
  { method: 'GET', path: '/admin/settings', allowed: ['admin'] },
  { method: 'PATCH', path: '/admin/settings/payout', allowed: ['admin'] },
  { method: 'PATCH', path: '/admin/settings', allowed: ['admin'] },
  { method: 'GET', path: '/settings/public', allowed: PUBLIC },
  { method: 'PATCH', path: '/admin/drivers/:id', allowed: ['admin', 'company'] },
  { method: 'GET', path: '/admin/drivers/penalties', allowed: ['admin', 'company'] },
  { method: 'GET', path: '/admin/dashboard/bookings', allowed: ['admin'] },
  { method: 'GET', path: '/admin/dashboard/summary', allowed: ['admin'] },
  { method: 'GET', path: '/admin/places/autocomplete', allowed: ['admin'] },
  { method: 'GET', path: '/admin/dashboard/journeys', allowed: ['admin'] },
  { method: 'GET', path: '/admin/dashboard/users', allowed: ['admin'] },
  { method: 'GET', path: '/admin/dashboard/users/:id', allowed: ['admin'] },
  { method: 'GET', path: '/admin/users/:id/agreement', allowed: ['admin'] },
  { method: 'GET', path: '/admin/customers', allowed: ['admin'] },
  { method: 'GET', path: '/admin/customers/export', allowed: ['admin'] },
  { method: 'POST', path: '/admin/customers', allowed: ['admin'] },
  { method: 'PATCH', path: '/admin/customers/:id', allowed: ['admin'] },
  // Platform subscription income — passenger revenue, not fleet revenue. Admin only.
  { method: 'GET', path: '/admin/revenue/subscriptions', allowed: ['admin'] },
  { method: 'POST', path: '/admin/pricing/city', allowed: ['admin'] },
  { method: 'GET', path: '/admin/pricing/city', allowed: ['admin'] },
  { method: 'PATCH', path: '/admin/pricing/city/:id', allowed: ['admin'] },
  { method: 'DELETE', path: '/admin/pricing/city/:id', allowed: ['admin'] },
];

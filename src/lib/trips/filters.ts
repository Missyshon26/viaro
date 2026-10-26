import type { Booking } from '../api/types';

export const emptyFilters = { from: '', to: '', vehicle: '', service: '', city: '', payment: '' };
export type TripFilters = typeof emptyFilters;

/** Match the platform's calendar day, independent of the operator's timezone. */
export function pickupDay(value: string): string {
  if (!value) return '';
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(value)) return value.slice(0, 10);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function matchesTripFilters(row: Booking, filters: TripFilters): boolean {
  const day = pickupDay(row.scheduledAt);
  return (!filters.from || day >= filters.from) && (!filters.to || (!!day && day <= filters.to))
    && (!filters.vehicle || row.vehicleClass === filters.vehicle)
    && (!filters.service || row.tripType === filters.service)
    && (!filters.city || row.city === filters.city)
    && (!filters.payment || (filters.payment === 'unpaid' ? !row.payment : row.payment?.status === filters.payment));
}

import { z } from 'zod';

/** Shared query shape for every paginated list endpoint. */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type PaginationQuery = z.infer<typeof paginationSchema>;

export function toSkipLimit({ page, limit }: PaginationQuery): { skip: number; limit: number } {
  return { skip: (page - 1) * limit, limit };
}

export interface Paginated<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export function paginated<T>(items: T[], total: number, q: PaginationQuery): Paginated<T> {
  return {
    items,
    page: q.page,
    limit: q.limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / q.limit)),
  };
}

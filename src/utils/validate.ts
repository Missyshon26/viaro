import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodType } from 'zod';

/**
 * Zod validation middleware. Each module keeps its schemas in *.validation.ts and mounts
 * them on the route, so a controller never sees unvalidated input.
 *
 * Note for Express 5: `req.query` and `req.params` are getter-only and cannot be
 * reassigned. Parsed output is therefore exposed on `req.validated`, which is also the
 * only place with correct types (coerced numbers, dates, defaults applied).
 */
export interface ValidatedRequest {
  body?: unknown;
  query?: unknown;
  params?: unknown;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      validated?: ValidatedRequest;
    }
  }
}

export interface ValidationSchemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const validated: ValidatedRequest = {};

      if (schemas.body) {
        validated.body = schemas.body.parse(req.body);
        req.body = validated.body; // body IS writable, keep it in sync for convenience
      }
      if (schemas.query) validated.query = schemas.query.parse(req.query);
      if (schemas.params) validated.params = schemas.params.parse(req.params);

      req.validated = validated;
      next();
    } catch (err) {
      next(err); // ZodError is translated to a 400 by errorHandler
    }
  };
}

/** Typed accessors — the schema guarantees the shape, so the cast is safe at the call site. */
export function body<T>(req: Request): T {
  return req.validated?.body as T;
}

export function query<T>(req: Request): T {
  return req.validated?.query as T;
}

export function params<T>(req: Request): T {
  return req.validated?.params as T;
}

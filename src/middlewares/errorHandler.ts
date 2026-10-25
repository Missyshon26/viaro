import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import { ZodError } from 'zod';
import { ApiError } from '../utils/ApiError';
import { isProduction } from '../config/env';
import { logger } from '../utils/logger';

interface ErrorBody {
  success: false;
  message: string;
  details?: unknown;
  stack?: string;
}

/** 404 catch-all — mounted after all routers, before the error handler. */
export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(ApiError.notFound(`Route ${req.method} ${req.originalUrl} not found`));
}

/**
 * Central error middleware — mounted LAST in app.ts.
 * Translates the error shapes this stack actually produces (Zod, Mongoose, JWT, ApiError)
 * into a consistent JSON envelope.
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  let statusCode = 500;
  let message = 'Internal server error';
  let details: unknown;

  if (err instanceof ApiError) {
    statusCode = err.statusCode;
    message = err.message;
    details = err.details;
  } else if (err instanceof ZodError) {
    statusCode = 400;
    message = 'Validation failed';
    details = err.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
  } else if (err instanceof mongoose.Error.ValidationError) {
    statusCode = 400;
    message = 'Validation failed';
    details = Object.values(err.errors).map((e) => ({ path: e.path, message: e.message }));
  } else if (err instanceof mongoose.Error.CastError) {
    statusCode = 400;
    message = `Invalid value for '${err.path}'`;
  } else if (isDuplicateKeyError(err)) {
    statusCode = 409;
    message = 'Resource already exists';
    details = err.keyValue;
  } else if (isClientError(err)) {
    /*
     * Errors that already carry their own 4xx status — body-parser's, chiefly.
     *
     * Malformed JSON and an oversized body are both the caller's doing, but they landed
     * in the generic branch below and were reported as 500s: "request entity too large"
     * claimed the server had failed when it had correctly refused a 2 MB payload. Honour
     * the status the thrower already decided on.
     */
    statusCode = err.status;
    message =
      err.type === 'entity.too.large'
        ? 'Request body is too large'
        : err.type === 'entity.parse.failed'
          ? 'Request body is not valid JSON'
          : err.message;
  } else if (err instanceof Error) {
    message = isProduction ? 'Internal server error' : err.message;
  }

  if (statusCode >= 500) {
    logger.error('Unhandled request error', err);
  }

  const body: ErrorBody = { success: false, message };
  if (details !== undefined) body.details = details;
  if (!isProduction && err instanceof Error) body.stack = err.stack;

  res.status(statusCode).json(body);
}

/**
 * An error that already knows it is the client's fault.
 *
 * express/body-parser attach `status` (and a `type` discriminator) to their own errors;
 * anything claiming a 4xx here is trusted, while a 5xx keeps falling through to the
 * generic handler so an internal failure can never mask itself as a client error.
 */
function isClientError(err: unknown): err is { status: number; message: string; type?: string } {
  if (typeof err !== 'object' || err === null) return false;
  const status = (err as { status?: unknown; statusCode?: unknown }).status;
  return typeof status === 'number' && status >= 400 && status < 500;
}

function isDuplicateKeyError(err: unknown): err is { code: number; keyValue: unknown } {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 11000
  );
}

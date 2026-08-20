import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { logger } from './logger';

/** An error with an intended HTTP status and an optional machine-readable code. */
export class AppError extends Error {
  status: number;
  code?: string;
  details?: unknown;

  constructor(status: number, message: string, options: { code?: string; details?: unknown } = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = options.code;
    this.details = options.details;
  }
}

export const badRequest = (msg: string, details?: unknown) =>
  new AppError(400, msg, { code: 'bad_request', details });
export const unauthorized = (msg = 'Unauthorized') => new AppError(401, msg, { code: 'unauthorized' });
export const forbidden = (msg = 'Forbidden') => new AppError(403, msg, { code: 'forbidden' });
export const notFound = (msg = 'Not found') => new AppError(404, msg, { code: 'not_found' });
export const conflict = (msg: string) => new AppError(409, msg, { code: 'conflict' });

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: `No route for ${req.method} ${req.path}` });
}

/** Central error handler. Everything leaves the API as `{ error, ... }`. */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'validation_error',
      details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
    return;
  }

  if (err instanceof AppError) {
    if (err.status >= 500) {
      logger.error(err.message, { path: req.path, status: err.status });
    }
    res.status(err.status).json({
      error: err.message,
      ...(err.code ? { code: err.code } : {}),
      ...(err.details !== undefined ? { details: err.details } : {}),
    });
    return;
  }

  const prismaCode = (err as { code?: string } | null)?.code;
  if (prismaCode === 'P2002') {
    res.status(409).json({ error: 'A record with that unique value already exists', code: 'conflict' });
    return;
  }
  if (prismaCode === 'P2025') {
    res.status(404).json({ error: 'Record not found', code: 'not_found' });
    return;
  }

  const message = err instanceof Error ? err.message : String(err);
  logger.error('Unhandled error', {
    path: req.path,
    method: req.method,
    message,
    stack: err instanceof Error ? err.stack : undefined,
  });
  res.status(500).json({ error: 'Internal server error', code: 'internal_error' });
}

/**
 * Express 4 does not forward rejected promises to the error handler, so async
 * route handlers are wrapped in this.
 */
export function asyncHandler<T extends Request = Request>(
  fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req as T, res, next)).catch(next);
  };
}

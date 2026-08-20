import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { logger } from '../logger';

declare module 'express-serve-static-core' {
  interface Request {
    requestId?: string;
  }
}

/** One structured line per request, with a correlation id echoed in the response. */
export function requestLog(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();
  req.requestId = randomUUID();
  res.setHeader('X-Request-Id', req.requestId);

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    const fields = {
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
    };
    if (res.statusCode >= 500) logger.error('request', fields);
    else if (res.statusCode >= 400) logger.warn('request', fields);
    else logger.info('request', fields);
  });

  next();
}

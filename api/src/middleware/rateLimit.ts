import rateLimit from 'express-rate-limit';
import type { Request } from 'express';
import { env } from '../env';

/**
 * Rate limit the public lead endpoints. Keyed by API key when present so one
 * noisy source can't starve the others behind a shared NAT.
 */
export const publicApiLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    const key = req.header('x-api-key');
    return key ? `key:${key}` : `ip:${req.ip ?? 'unknown'}`;
  },
  handler: (_req, res) => {
    res.status(429).json({ error: 'Rate limit exceeded', code: 'rate_limited' });
  },
});

/** A tighter limit on login, to slow credential stuffing. */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ error: 'Too many login attempts, try again later', code: 'rate_limited' });
  },
});

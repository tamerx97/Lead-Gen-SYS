import express, { Router } from 'express';
import { logger } from '../logger';

/**
 * A local stand-in for a buyer's CRM, so the full ping → post → deliver loop
 * works out of the box with no external service. Seeded buyers point here.
 *
 * It is NOT part of the product surface — delete the mount in `app.ts` for a
 * production deployment.
 */
export const mockRouter = Router();

interface MockDelivery {
  receivedAt: string;
  buyer: string;
  contentType: string;
  /** Parsed body for json/form; the raw string for xml and anything else. */
  body: unknown;
  /** Always the bytes as received, so xml deliveries are inspectable too. */
  raw: string;
}

const received: MockDelivery[] = [];
const MAX_KEPT = 200;

// The app-level json/urlencoded parsers have already run; this catches whatever
// they left untouched (notably XML) so every delivery is recorded verbatim.
const captureRaw = express.text({ type: '*/*', limit: '1mb' });

mockRouter.post('/buyer/:slug', captureRaw, (req, res) => {
  const entry: MockDelivery = {
    receivedAt: new Date().toISOString(),
    buyer: req.params.slug,
    contentType: req.header('content-type') ?? 'unknown',
    body: req.body,
    raw: typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {}),
  };
  received.unshift(entry);
  if (received.length > MAX_KEPT) received.length = MAX_KEPT;

  logger.info('mock buyer received lead', { buyer: req.params.slug });
  res.status(200).json({
    ok: true,
    buyer_reference: `MOCK-${Date.now().toString(36).toUpperCase()}`,
    message: `Lead accepted by mock buyer "${req.params.slug}"`,
  });
});

/** A buyer endpoint that always rejects, for exercising the failure path. */
mockRouter.post('/buyer-reject/:slug', captureRaw, (req, res) => {
  logger.info('mock buyer rejected lead', { buyer: req.params.slug });
  res.status(422).json({ ok: false, error: 'Mock buyer rejects everything' });
});

mockRouter.get('/deliveries', (_req, res) => {
  res.json({ count: received.length, deliveries: received });
});

mockRouter.delete('/deliveries', (_req, res) => {
  received.length = 0;
  res.json({ ok: true });
});

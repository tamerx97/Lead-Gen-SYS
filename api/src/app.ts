import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { env } from './env';
import { prisma } from './db';
import { errorHandler, notFoundHandler } from './errors';
import { adminAuth } from './middleware/auth';
import { requestLog } from './middleware/requestLog';
import { authRouter } from './routes/auth';
import { buyersRouter } from './routes/buyers';
import { campaignsRouter } from './routes/campaigns';
import { leadsRouter } from './routes/leads';
import { mockRouter } from './routes/mock';
import { pingsRouter } from './routes/pings';
import { publicRouter } from './routes/public';
import { settingsRouter } from './routes/settings';
import { sourcesRouter } from './routes/sources';
import { statsRouter } from './routes/stats';
import { verticalsRouter } from './routes/verticals';

export interface AppOptions {
  /** Mount the local mock-buyer endpoints. On by default outside production. */
  mockBuyer?: boolean;
}

export function createApp(options: AppOptions = {}): Express {
  const app = express();

  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(cookieParser());
  app.use(
    cors({
      origin: env.corsOrigins.length ? env.corsOrigins : true,
      credentials: true,
    })
  );
  app.use(requestLog);

  app.get('/health', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ ok: true, service: 'lead-gen-sys', db: 'up', time: new Date().toISOString() });
    } catch (err) {
      res.status(503).json({
        ok: false,
        db: 'down',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // ---- Public lead API (X-Api-Key) ------------------------------------
  app.use('/api', publicRouter);

  // ---- Admin auth ------------------------------------------------------
  app.use('/api/auth', authRouter);

  // ---- Management API (admin session) ----------------------------------
  app.use('/api/verticals', adminAuth, verticalsRouter);
  app.use('/api/sources', adminAuth, sourcesRouter);
  app.use('/api/buyers', adminAuth, buyersRouter);
  app.use('/api/campaigns', adminAuth, campaignsRouter);
  app.use('/api/leads', adminAuth, leadsRouter);
  app.use('/api/pings', adminAuth, pingsRouter);
  app.use('/api/stats', adminAuth, statsRouter);
  app.use('/api/settings', adminAuth, settingsRouter);

  // ---- Local mock buyer (development convenience, not product surface) ---
  if (options.mockBuyer ?? !env.isProduction) {
    app.use('/mock', mockRouter);
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

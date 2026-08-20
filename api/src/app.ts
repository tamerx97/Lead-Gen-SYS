import path from 'node:path';
import fs from 'node:fs';
import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { env } from './env';
import { prisma } from './db';
import { errorHandler, notFoundHandler } from './errors';
import { logger } from './logger';
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
  /** Serve a built dashboard from this directory. Defaults to env.SERVE_WEB_DIR. */
  serveWebDir?: string;
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

  // ---- Optionally serve the built dashboard from this same process ------
  // Set SERVE_WEB_DIR=../web/dist to run the whole product as one container /
  // one systemd unit, with no separate web server or CORS configuration.
  const webDir = options.serveWebDir ?? env.SERVE_WEB_DIR;
  if (webDir) {
    const resolved = path.resolve(webDir);
    if (!fs.existsSync(path.join(resolved, 'index.html'))) {
      throw new Error(
        `SERVE_WEB_DIR points at ${resolved}, which has no index.html. Run \`npm run build\` in /web first.`
      );
    }

    // Hashed assets are immutable; index.html must never be cached or users
    // keep booting an old bundle against a new API.
    app.use(
      express.static(resolved, {
        index: false,
        setHeaders: (res, filePath) => {
          if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          } else {
            res.setHeader('Cache-Control', 'no-cache');
          }
        },
      })
    );

    // SPA fallback for client-side routes (/leads, /playground, …). Anything
    // under /api or /health has already been handled above, and must still 404
    // as JSON rather than silently returning the app shell.
    app.get(/^\/(?!api\/|health$|mock\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(resolved, 'index.html'));
    });

    logger.info('serving dashboard', { dir: resolved });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

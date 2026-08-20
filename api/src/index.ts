import { createApp } from './app';
import { env } from './env';
import { prisma } from './db';
import { logger } from './logger';
import { expireStalePings } from './services/post';

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info('API listening', { port: env.PORT, env: env.NODE_ENV });
});

// Housekeeping: retire pings whose TTL lapsed, so the log and the fill-rate
// numbers stay honest without a separate worker process.
const sweeper = setInterval(() => {
  expireStalePings()
    .then((count) => {
      if (count > 0) logger.debug('expired stale pings', { count });
    })
    .catch((err) => logger.error('ping sweeper failed', { error: String(err) }));
}, 60_000);
sweeper.unref();

async function shutdown(signal: string): Promise<void> {
  logger.info('shutting down', { signal });
  clearInterval(sweeper);
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

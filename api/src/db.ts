import { PrismaClient } from '@prisma/client';

/**
 * A single Prisma client for the process. `globalThis` caching keeps `tsx watch`
 * from opening a new connection pool on every reload.
 */
declare global {
  // eslint-disable-next-line no-var
  var __leadgenPrisma: PrismaClient | undefined;
}

export const prisma =
  globalThis.__leadgenPrisma ??
  new PrismaClient({
    log: process.env.PRISMA_LOG === 'query' ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') globalThis.__leadgenPrisma = prisma;

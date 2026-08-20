import 'dotenv/config';
import { z } from 'zod';

const boolish = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  PORT: z.coerce.number().int().positive().default(4000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  JWT_SECRET: z.string().min(8).default('dev-only-insecure-secret-change-me'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  COOKIE_SECURE: boolish,
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(600),
  DELIVERY_TIMEOUT_MS: z.coerce.number().int().positive().default(8_000),
  DELIVERY_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  DELIVERY_BACKOFF_MS: z.coerce.number().int().min(0).default(500),
  SEED_ADMIN_EMAIL: z.string().default('admin@leadgen.local'),
  SEED_ADMIN_PASSWORD: z.string().default('admin12345'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  // Fail loudly at boot rather than at the first request.
  throw new Error(`Invalid environment configuration:\n${issues}\n\nCopy api/.env.example to api/.env and fill it in.`);
}

export const env = {
  ...parsed.data,
  isProduction: parsed.data.NODE_ENV === 'production',
  corsOrigins: parsed.data.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean),
};

if (env.isProduction && env.JWT_SECRET === 'dev-only-insecure-secret-change-me') {
  throw new Error('JWT_SECRET must be set to a real secret when NODE_ENV=production');
}

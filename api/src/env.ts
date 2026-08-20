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
  // Optional: absolute or relative path to the built dashboard (web/dist).
  // When set, the API also serves the SPA, so a deployment is a single process.
  SERVE_WEB_DIR: z.string().optional(),
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

/**
 * Secrets that are published in this repository, so anyone could forge a
 * session cookie with them. Catching only the code default is not enough: the
 * likeliest mistake is copying .env.example straight into production.
 */
const PUBLISHED_SECRETS = new Set([
  'dev-only-insecure-secret-change-me',
  'change-me-to-a-long-random-string',
  'changeme',
  'secret',
]);

const MIN_PRODUCTION_SECRET_LENGTH = 32;

if (env.isProduction) {
  const secret = env.JWT_SECRET.trim();
  if (PUBLISHED_SECRETS.has(secret)) {
    throw new Error(
      'JWT_SECRET is still set to a placeholder that is published in this repository.\n' +
        'Anyone could forge an admin session with it. Generate a real one:\n' +
        '  openssl rand -base64 48'
    );
  }
  if (secret.length < MIN_PRODUCTION_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET must be at least ${MIN_PRODUCTION_SECRET_LENGTH} characters when NODE_ENV=production ` +
        `(got ${secret.length}). Generate one with: openssl rand -base64 48`
    );
  }
}

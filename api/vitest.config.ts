import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/tests/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    // Keep test output readable; the app logs one JSON line per request.
    env: { LOG_LEVEL: 'error' },
  },
});

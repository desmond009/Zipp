import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        // Pure logic and services with in-memory fakes: no MongoDB, no Redis, milliseconds.
        test: {
          name: 'unit',
          include: ['test/unit/**/*.test.ts'],
        },
      },
      {
        // The real app (buildApp + app.inject) against a real MongoDB and Redis.
        test: {
          name: 'integration',
          include: ['test/integration/**/*.test.ts'],
          // Starts one in-memory MongoDB for the whole run.
          globalSetup: ['test/integration/global-setup.ts'],
          // Files share one Redis database, so run them one at a time.
          fileParallelism: false,
          testTimeout: 20_000,
          hookTimeout: 120_000, // first run downloads the mongod binary
        },
      },
    ],
  },
});

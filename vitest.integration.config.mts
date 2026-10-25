import { defineConfig } from 'vitest/config';

/**
 * Real flows against a real (in-memory) MongoDB — what the mocked unit suites cannot
 * prove: that documents actually persist with the new fields, that queries return them,
 * and that the HTTP routes hold together end to end.
 *
 * Kept apart from `npm test` because the first run downloads a mongod binary.
 *   npm run test:integration
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/integration/**/*.spec.ts'],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    // One database, one file at a time.
    fileParallelism: false,
  },
});

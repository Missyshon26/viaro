import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.spec.ts'],
    // Needs a downloaded mongod; run on its own with `npm run test:integration`.
    exclude: ['tests/integration/**', 'node_modules/**'],
    setupFiles: ['tests/setup.ts'],
    // The guard suite drives the real Express app; nothing here should ever hang.
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});

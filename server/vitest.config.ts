import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
    testTimeout: 10000,
    maxWorkers: 1,
    minWorkers: 1,
    fileParallelism: false,
    globalSetup: ['src/__tests__/globalSetup.ts'],
    env: {
      DATABASE_URL: 'file:./test.db',
      NODE_ENV: 'test',
    },
  },
});

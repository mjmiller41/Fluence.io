import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Pure-TS domain model: node environment enforces zero DOM dependencies.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});

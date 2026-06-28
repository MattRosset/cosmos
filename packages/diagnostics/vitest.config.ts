import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // jsdom: the dev-overlay is vanilla DOM and must be exercisable in tests.
    environment: 'jsdom',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      thresholds: {
        statements: 90,
      },
    },
  },
});

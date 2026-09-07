import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // Package-level stub for @react-three/postprocessing: a real WebGL2 EffectComposer
    // cannot init on test-renderer's mock GL. See test/setup-postprocessing.ts (TASK-104).
    setupFiles: ['./test/setup-postprocessing.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      thresholds: {
        statements: 90,
      },
    },
  },
});

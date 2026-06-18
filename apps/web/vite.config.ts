import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/** Preload the star catalog so fetch starts in parallel with JS (LCP critical path). */
function preloadStarPack(): Plugin {
  return {
    name: 'preload-star-pack',
    transformIndexHtml() {
      const manifestPath = resolve(__dirname, 'public/packs/manifest.json');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { binUrl: string };
      return [
        {
          injectTo: 'head-prepend',
          tag: 'link',
          attrs: {
            rel: 'preload',
            href: `/packs/${manifest.binUrl}`,
            as: 'fetch',
            crossorigin: '',
          },
        },
        {
          injectTo: 'head-prepend',
          tag: 'link',
          attrs: {
            rel: 'preload',
            href: '/packs/manifest.json',
            as: 'fetch',
            crossorigin: '',
          },
        },
      ];
    },
  };
}

export default defineConfig({
  plugins: [react(), preloadStarPack()],
  resolve: {
    dedupe: ['three'],
  },
  server: {
    port: 5173,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Keep three + R3F in one chunk — splitting examples (KTX2Loader) into
          // vendor-three duplicated ~24 KiB of three.core/module (Lighthouse).
          if (
            id.includes('/node_modules/three/') ||
            id.includes('/node_modules/@react-three/')
          ) {
            return 'vendor-r3f';
          }
          if (id.includes('/node_modules/react-dom/') || id.includes('/node_modules/react/')) {
            return 'vendor-react';
          }
        },
      },
    },
  },
});

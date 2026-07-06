import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Offline-first PWA (CLAUDE.md invariant 3). Workbox (generateSW) precaches the
// app shell AND the geometry WASM so a full offline reload works after one load.
export default defineConfig({
  // Workers are ES modules so `new Worker(new URL(...), { type: 'module' })`
  // (geometry-wasm client) bundles correctly.
  worker: { format: 'es' },
  build: { target: 'es2022' },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      strategies: 'generateSW',
      workbox: {
        // Precache the shell + WASM + icons. WASM matters: geometry must work offline.
        globPatterns: ['**/*.{js,css,html,wasm,svg,png,ico,woff2}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        cleanupOutdatedCaches: true,
      },
      includeAssets: ['icons/favicon.svg', 'icons/icon-192.png'],
      manifest: {
        name: 'LaserKerf',
        short_name: 'LaserKerf',
        description: 'Offline-first laser design, CAM, and machine control.',
        theme_color: '#0b0f14',
        background_color: '#0b0f14',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
});

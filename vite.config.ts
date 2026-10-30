/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  server: {
    host: true,
    port: 5173,
    // Reached from a phone over Tailscale as http://hive1:5173
    allowedHosts: ['hive1', '.ts.net'],
  },
  preview: { host: true, port: 4173 },
  // three.js alone is ~540 kB minified (~137 kB gzip); well within budget.
  build: { chunkSizeWarningLimit: 800 },
  plugins: [
    VitePWA({
      // 'prompt': a new version waits until main.ts finds a safe moment to
      // reload (respawn, page hidden, or the player asks on the pause screen)
      // instead of autoUpdate reloading mid-run.
      registerType: 'prompt',
      includeAssets: ['icons/*.png', 'icons/*.svg'],
      manifest: {
        name: 'Curbside',
        short_name: 'Curbside',
        description: 'Top-down open-world crime and driving.',
        display: 'fullscreen',
        orientation: 'landscape',
        background_color: '#111214',
        theme_color: '#111214',
        start_url: '.',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,glb,ktx2,json}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
    }),
  ],
  test: {
    include: ['tests/**/*.test.ts'],
  },
});

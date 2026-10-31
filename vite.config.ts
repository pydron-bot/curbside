/// <reference types="vitest/config" />
import { execSync } from 'node:child_process';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Shown in Settings and on the pause card (src/core/build.ts): the commit
// (GITHUB_SHA on the Pages workflow, else the local checkout) and UTC time.
function buildId(): string {
  let sha = process.env.GITHUB_SHA;
  if (!sha) {
    try {
      sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      sha = 'dev'; // no git (e.g. a source tarball)
    }
  }
  return `${sha.slice(0, 7)} ${new Date().toISOString().slice(0, 16).replace('T', ' ')}Z`;
}

/**
 * Names the destruction test's lazy files (Rapier's js and wasm, hashed) in
 * a meta tag, so src/render/rubbleLoader.ts can download them as soon as the
 * test is on but import (evaluate and instantiate) them only behind a pause.
 */
function rapierFilesMeta(): Plugin {
  return {
    name: 'curbside-rapier-files',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const files = Object.keys(ctx.bundle ?? {}).filter((f) => /(?:^|\/)(?:rapier|rubblePhysics)[\w-]*\.(?:js|wasm)$/.test(f));
        return files.length ? [{ tag: 'meta', attrs: { name: 'curbside-rapier', content: files.sort().join(' ') }, injectTo: 'head' }] : [];
      },
    },
  };
}

export default defineConfig({
  // The site path the game is served from: '/' locally, '/curbside/' when the
  // Pages workflow builds it for deeek.org/curbside/ (CURBSIDE_BASE).
  base: process.env.CURBSIDE_BASE ?? '/',
  define: { __BUILD__: JSON.stringify(buildId()) },
  server: {
    host: true,
    port: 5173,
    // Reached from a phone over Tailscale as http://hive1:5173
    allowedHosts: ['hive1', '.ts.net'],
  },
  preview: { host: true, port: 4173 },
  // Served as is in dev: pre-bundled, Rapier's classes and the glue its wasm
  // calls back into end up as two module copies, and the scratch-buffer
  // getters (rbTranslation) throw. Builds are unaffected.
  optimizeDeps: { exclude: ['@dimforge/rapier3d'] },
  // three.js alone is ~634 kB minified (~157 kB gzip); well within budget.
  // It gets a chunk of its own: game updates then don't re-download it, and
  // neither chunk trips the size warning.
  build: {
    chunkSizeWarningLimit: 800,
    // Apache-2.0 text for Rapier (and three, workbox-window) in dist/licenses.md.
    license: { fileName: 'licenses.md' },
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'three', test: /node_modules[\\/]three[\\/]/ },
            // Rapier (the destruction test) gets chunks of its own, kept out of the precache below.
            { name: 'rapier', test: /node_modules[\\/]@dimforge[\\/]/ },
          ],
        },
      },
    },
  },
  plugins: [
    rapierFilesMeta(),
    VitePWA({
      // 'prompt': a new version waits until main.ts finds a safe moment to
      // reload (respawn, page hidden, or the player asks on the pause screen)
      // instead of autoUpdate reloading mid-run.
      registerType: 'prompt',
      // globPatterns below already precaches public/icons; listing them here
      // too put every icon in the manifest twice.
      includeManifestIcons: false,
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
        // Only players who turn the destruction test on download Rapier (~0.8 MB
        // gzip), so it isn't precached; it's cached on first use instead. Setting
        // globIgnores replaces workbox's default, so node_modules stays listed.
        globIgnores: ['**/node_modules/**/*', '**/assets/rapier*'],
        runtimeCaching: [
          {
            urlPattern: /\/assets\/rapier[\w-]*\.(?:js|wasm)$/,
            // Hashed names: a cached file never goes stale.
            handler: 'CacheFirst',
            options: {
              cacheName: 'curbside-rapier',
              // A couple of versions' worth; old hashes age out.
              expiration: { maxEntries: 6 },
              cacheableResponse: { statuses: [200] },
              // A host that sends Vary (vite preview: Origin) would otherwise miss the cache offline; the names are hashed.
              matchOptions: { ignoreVary: true },
            },
          },
        ],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        // The default skips revisions for everything under assets/, assuming
        // hashed names, but the GLBs are copied there unhashed from public/:
        // with no revision an installed copy never re-downloads changed art.
        // Only Vite's hashed bundles may go without one.
        dontCacheBustURLsMatching: /^assets\/.+-[\w-]{8}\.(?:js|css)$/,
      },
    }),
  ],
  test: {
    include: ['tests/**/*.test.ts'],
  },
});

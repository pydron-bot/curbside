# Curbside — notes for Claude

Top-down open-world driving/crime game for the browser: three.js 0.186,
TypeScript (strict), Vite 8, vite-plugin-pwa, Vitest. Targets Safari on an
iPhone 15 Pro (landscape, touch) and desktop (keyboard/mouse/gamepad).

Read first: `README.md` (every system, its API and budgets), `docs/HANDOFF.md`
(current state and the to-do list), `docs/PLAN.md` (design and milestones),
`docs/BLENDER_TODO.md` (asset contracts with the Blender pipeline).

## Commands

```sh
npm ci                 # Node ≥ 22.12 (.nvmrc: 24)
npm run dev            # vite --host
npm test               # vitest
npm run build          # tsc --noEmit && vite build
CURBSIDE_BASE=/curbside/ npx vite build   # what the Pages deploy builds
```

## Rules of the codebase

- **Simulation emits, presentation subscribes.** Gameplay raises typed events
  on `src/core/events.ts`; audio, effects, HUD, heat and progression listen.
  Add fields to events compatibly and keep `GameAudio`'s exhaustive switch
  compiling.
- **main.ts is wiring.** Put logic in modules; pure logic (no three.js) goes
  with unit tests in `tests/`.
- **Never hard-code `/assets/...`.** Load files from `public/` with
  `publicUrl('assets/…')` (`src/core/paths.ts`); the game is served from
  `deeek.org/curbside/`.
- **Rendering goes through `Look`.** Call `look.render(camera)`, never
  `renderer.render`. People, cars, glows and props are instanced batches; add
  instances, not meshes. No real-time lights added or removed at runtime
  (fake light with `look.addGlowSource`), no shader compiles mid-play
  (precompile), `look.exposureBoost` instead of writing exposure. Budget on
  the iPhone profile: well under 150 draw calls; no per-frame allocation in
  hot paths.
- **Quality tiers** (`src/render/quality.ts`) and `DynamicResolution` own
  pixel ratio and effect levels; don't call `setPixelRatio` yourself.
- **GLB contracts** (material suffixes, bone/clip/root names) are in
  `docs/BLENDER_TODO.md`; the loaders depend on them.
- Comments are short and explain why; match the surrounding style.

## Shipping

Pushing to `main` deploys to https://deeek.org/curbside/ via
`.github/workflows/pages.yml` (it runs the tests first). Verify in a browser
before pushing: Playwright + SwiftShader, desktop 1280×720 and iPhone 15 Pro
landscape (852×393 @3x, also 852×340); `window.__ub` exposes the game
(`startGame()`, `fastForward(seconds)`, state).

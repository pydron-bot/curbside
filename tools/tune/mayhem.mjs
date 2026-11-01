/**
 * Heavy-mayhem harness: on the iPhone 15 Pro landscape profile (852×393,
 * dpr 3), blow up cars and building walls round the player (breaches, wall
 * and wreck fires, fire trucks), step real frames, and report what piles up:
 * live particles, an estimate of their transparent fill (each live quad's
 * area on screen, from the camera: screens of overdraw), glows, draw calls
 * and the census counts. SwiftShader can't time a GPU, so fill is the
 * yardstick; run it before and after a change with the same seed.
 *
 *   npx -y -p playwright@1.63.0 node tools/tune/mayhem.mjs [--tier medium|low|high|all] [--time day|night|both]
 *       [--seconds 36] [--seed 7] [--scenario mayhem|single] [--no-city-fires] [--shot dir]
 *       [--step 50] [--dpr 3]
 *
 * Frames are stepped `--step` ms apart (coarser runs faster on a busy
 * machine; emitters keep their rates per second). The fill is a share of
 * the screen, so `--dpr 1` (a smaller canvas, faster) gives the same
 * numbers but the pixel ratio.
 *
 * The dev server must be up (npm run dev); URL overrides the address.
 * --scenario single blows up one car (normal play: the budgets must leave it be).
 * --no-city-fires puts the fire scene's fires out as they start: the
 * effects as they were before the living city (94dfe03), for comparison.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { args, launch, playwright } from './lib.mjs';

const URL = process.env.URL ?? 'http://localhost:5173/';
const opt = args({ tier: 'all', time: 'both', seconds: 36, seed: 7, 'no-city-fires': false, shot: '', scenario: 'mayhem', dpr: 3, step: 50 });
const TIERS = opt.tier === 'all' ? ['medium', 'low'] : [opt.tier];
const TIMES = opt.time === 'both' ? ['day', 'night'] : [opt.time];
const STEP_MS = opt.step;

const browser = await launch();
const { devices } = await playwright();
const iphone = devices['iPhone 15 Pro landscape'];
if (opt.shot) mkdirSync(opt.shot, { recursive: true });

const rows = [];
for (const tier of TIERS) {
  for (const time of TIMES) {
    const ctx = await browser.newContext({ ...iphone, viewport: { width: 852, height: 393 }, deviceScaleFactor: opt.dpr, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('pageerror:', e.message));
    await page.addInitScript(
      ({ tier, seed }) => {
        let s = seed;
        Math.random = () => {
          s = (s + 0x6d2b79f5) | 0;
          let t = Math.imul(s ^ (s >>> 15), 1 | s);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
        const t0 = Date.UTC(2026, 0, 1);
        Date.now = () => t0;
        // Frames only when the harness steps them (__ub.stepFrame).
        window.requestAnimationFrame = () => 0;
        localStorage.setItem('curbside.settings', JSON.stringify({ quality: tier, godMode: true, destruction: 'auto', perfOverlay: 'full' }));
      },
      { tier, seed: opt.seed },
    );
    await page.goto(URL);
    await page.waitForFunction(() => window.__ub, null, { timeout: 90000 });
    await page.waitForTimeout(1500);
    const r = await page.evaluate(
      async ({ time, seconds, stepMs, cityFires, wantShot, single }) => {
        const u = window.__ub;
        // Rapier loads behind the title in a real frame (stubbed here): load it now, then play.
        u.destruction.preload();
        await u.destruction.whenReady();
        u.startGame();
        for (let i = 0; i < 20; i++) u.stepFrame(stepMs);
        u.look.time.hour = time === 'night' ? 23 : 13;
        const fires = u.cityLife.scenes.find((s) => s.board && s.crews)?.board;
        const me = u.player.position;
        const px = me.x;
        const pz = me.z;
        // The three building faces nearest the player: a rocket at each (breach + wall fire).
        const faces = [];
        for (const b of u.city.buildings) {
          const cx = Math.max(b.minX, Math.min(px, b.maxX));
          const cz = Math.max(b.minZ, Math.min(pz, b.maxZ));
          const d = Math.hypot(cx - px, cz - pz);
          if (d < 2 || d > 30) continue;
          const nx = cx === b.minX ? -1 : cx === b.maxX ? 1 : 0;
          const nz = cz === b.minZ ? -1 : cz === b.maxZ ? 1 : 0;
          faces.push({ x: cx + nx * 0.6, z: cz + nz * 0.6, d });
        }
        faces.sort((a, b) => a.d - b.d);
        const walls = faces.slice(0, 3);
        const cars = () =>
          u.vehicles
            .filter((v) => v !== u.player.driving && !v.damage.wrecked)
            .map((v) => ({ v, d: Math.hypot(v.sim.x - px, v.sim.z - pz) }))
            .filter((c) => c.d < 32)
            .sort((a, b) => a.d - b.d);
        // A car blowing up as the damage system does it: wrecked first (its wreck burns and smokes), then the blast.
        const boom = (v) => {
          v.damage.health = 0;
          v.damage.wrecked = true;
          u.explode(v);
        };
        const blast = (x, z) => u.events.emit({ type: 'explosion', x, z, distance: Math.hypot(x - px, z - pz), byPlayer: true, source: 'rocket' });

        /** Live particles' area on screen over the screen's: what the GPU fills. */
        const cam = u.rig.camera;
        const canvas = u.renderer.domElement;
        const poolFill = (pool) => {
          const vi = cam.matrixWorldInverse.elements;
          const p = cam.projectionMatrix.elements;
          const W = canvas.width;
          const H = canvas.height;
          let area = 0;
          let n = 0;
          for (let i = 0; i < pool.capacity; i++) {
            if (!pool.alive[i]) continue;
            const t = pool.age[i] / pool.life[i];
            const e = 1 - (1 - t) * (1 - t);
            const size = pool.size0[i] + (pool.size1[i] - pool.size0[i]) * e;
            const x = pool.x[i];
            const y = pool.y[i];
            const z = pool.z[i];
            const vx = vi[0] * x + vi[4] * y + vi[8] * z + vi[12];
            const vy = vi[1] * x + vi[5] * y + vi[9] * z + vi[13];
            const vz = vi[2] * x + vi[6] * y + vi[10] * z + vi[14];
            const w = -vz;
            if (w <= 0.1) continue;
            const ndcX = (p[0] * vx) / w;
            const ndcY = (p[5] * vy) / w;
            const ppm = ((p[5] / w) * H) / 2;
            const half = (size * ppm) / Math.min(W, H);
            if (Math.abs(ndcX) > 1 + half * 2 || Math.abs(ndcY) > 1 + half * 2) continue;
            let long = size;
            if (pool.flags[i] & 1) long += Math.hypot(pool.vx[i], pool.vy[i], pool.vz[i]) * pool.stretch[i];
            area += long * size * ppm * ppm;
            n++;
          }
          return { area: area / (W * H), n };
        };

        const samples = [];
        const out = {};
        const steps = Math.round((seconds * 1000) / stepMs);
        const first = Math.round(500 / stepMs);
        for (let k = 0; k < steps; k++) {
          const t = (k * stepMs) / 1000;
          if (single) {
            // Normal play: one car blowing up near you.
            if (k === first) for (const c of cars().slice(0, 1)) boom(c.v);
          } else if (k === first) {
            for (const w of walls) blast(w.x, w.z);
            for (const c of cars().slice(0, 4)) boom(c.v);
          }
          if (single) {
            // nothing more
          } else if (k === Math.round(8000 / stepMs)) for (const c of cars().slice(0, 2)) boom(c.v);
          else if (k === Math.round(16000 / stepMs)) {
            for (const c of cars().slice(0, 2)) boom(c.v);
            if (walls[0]) blast(walls[0].x, walls[0].z);
          }
          if (!cityFires && fires) for (const f of fires.fires) f.alive = false;
          u.stepFrame(stepMs);
          if (k % Math.round(500 / stepMs) === 0 && t > 0.5) {
            const c = u.census.fill(out);
            const hot = poolFill(u.effects.hot);
            const soft = poolFill(u.effects.soft);
            samples.push({
              t: Math.round(t * 10) / 10,
              dc: u.renderer.info.render.calls,
              hot: c.hot,
              soft: c.soft,
              big: c.big,
              estFill: Math.round(c.fill * 100) / 100,
              screenFill: Math.round((hot.area + soft.area) * 100) / 100,
              hotFill: Math.round(hot.area * 100) / 100,
              softFill: Math.round(soft.area * 100) / 100,
              glows: c.glows,
              glowFill: Math.round(c.glowFill * 100) / 100,
              fires: c.fires,
              firesSeen: c.firesSeen,
              burning: c.burning,
              rubble: c.rubble,
              rubbleDrawn: c.rubbleDrawn,
              people: `${c.peopleSeen}/${c.people}`,
              cars: `${c.carsSeen}/${c.cars}`,
              kinds: c.kinds,
            });
          }
        }
        // The frame at the end, copied in the same task as its render (no preserved drawing buffer).
        let shot = null;
        if (wantShot) {
          u.stepFrame(stepMs);
          shot = canvas.toDataURL('image/jpeg', 0.8);
        }
        return { shot, walls: walls.length, breaches: u.destruction.stats().breaches, rapier: u.destruction.stats().rapier, samples, tier: u.resolution.summary(), viewArea: Math.round(u.effects.viewArea) };
      },
      { time, seconds: opt.seconds, stepMs: STEP_MS, cityFires: !opt['no-city-fires'], wantShot: !!opt.shot, single: opt.scenario === 'single' },
    );
    if (r.shot) writeFileSync(path.join(opt.shot, `mayhem-${tier}-${time}.jpg`), Buffer.from(r.shot.split(',')[1], 'base64'));
    await ctx.close();

    const s = r.samples;
    const peak = (k) => Math.max(...s.map((x) => x[k]));
    const mean = (k) => Math.round((s.reduce((a, x) => a + x[k], 0) / s.length) * 100) / 100;
    const row = {
      tier,
      time,
      res: r.tier,
      view: r.viewArea,
      walls: `${r.breaches}/${r.walls} ${r.rapier}`,
      'hot pk': peak('hot'),
      'soft pk': peak('soft'),
      'big pk': peak('big'),
      'fill pk': peak('screenFill'),
      'fill avg': mean('screenFill'),
      'est pk': peak('estFill'),
      'smoke fill pk': peak('softFill'),
      'glows pk': peak('glows'),
      'glowFill pk': peak('glowFill'),
      'dc pk': peak('dc'),
      'fires pk': peak('fires'),
      'rubble pk': peak('rubbleDrawn'),
    };
    rows.push(row);
    console.log(JSON.stringify(row));
    if (process.env.VERBOSE) for (const x of s) console.log(JSON.stringify(x));
  }
}
await browser.close();
console.table(rows);

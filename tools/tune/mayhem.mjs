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
 *       [--seconds 36] [--seed 7] [--scenario mayhem|single|drive|pursuit] [--no-city-fires] [--shot dir]
 *       [--shots 0.4,3,17] [--fx auto|off|on] [--fx-scale 0.25] [--step 50] [--dpr 3]
 *
 * Frames are stepped `--step` ms apart (coarser runs faster on a busy
 * machine; emitters keep their rates per second). The fill is a share of
 * the screen, so `--dpr 1` (a smaller canvas, faster) gives the same
 * numbers but the pixel ratio.
 *
 * The dev server must be up (npm run dev); URL overrides the address.
 * --scenario single blows up one car (normal play: the budgets must leave it be);
 * drive boards the nearest car and drives it round (a weaver bot that
 * handbrakes into turns: tyre smoke, skids), nothing blown up; pursuit
 * drives the same way at 5 stars with the city's busy scenes started round
 * it every 5 s (a race, a chase, an accident, a fight, a tow, a turf war,
 * a fire: the TEST menu's starter, past the holds and the wanted cap, so a
 * worst case), for the draw calls with police and scene cars at once.
 * --shot saves the last frame to that directory, or with --shots the frames
 * at those seconds (same seed, same moments: before/after comparisons).
 * Smoke work is the soft particles' fragment work in full-resolution screens:
 * their fill, or when they're drawn offscreen (lowResFx.ts) fill × scale² ×
 * 1.25 (colour plus the depth output) plus the composite's tiles. --fx off
 * keeps them with the scene (the path before), on forces offscreen; with
 * --shots each moment is saved both ways from the very same frame
 * (…-full.jpg, …-low.jpg) as well as as played; --fx-scale tries another
 * offscreen scale (dev server only). JS ms is the median
 * wall time of a whole stepped frame and of look.render alone (SwiftShader:
 * the GPU's share isn't in it).
 * --no-city-fires puts the fire scene's fires out as they start: the
 * effects as they were before the living city (94dfe03), for comparison.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { args, launch, playwright } from './lib.mjs';

const URL = process.env.URL ?? 'http://localhost:5173/';
const opt = args({ tier: 'all', time: 'both', seconds: 36, seed: 7, 'no-city-fires': false, shot: '', shots: '', scenario: 'mayhem', fx: 'auto', 'fx-scale': 0, dpr: 3, step: 50 });
const SHOTS = String(opt.shots || '')
  .split(',')
  .filter(Boolean)
  .map(Number);
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
      async ({ time, seconds, stepMs, cityFires, wantShot, shotsAt, single, drive, pursuit, fx, fxScale }) => {
        const u = window.__ub;
        // Rapier loads behind the title in a real frame (stubbed here): load it now, then play.
        u.destruction.preload();
        await u.destruction.whenReady();
        u.startGame();
        for (let i = 0; i < 20; i++) u.stepFrame(stepMs);
        u.look.time.hour = time === 'night' ? 23 : 13;
        if (u.look.lowFx) u.look.lowFx.mode = fx;
        if (fxScale) {
          // Try another offscreen scale on every tier (the dev server serves the game's own module).
          const q = await import('/src/render/quality.ts');
          for (const t of Object.values(q.QUALITY_TIERS)) if (t.fxScale < 1) t.fxScale = fxScale;
        }
        // Wall time of look.render alone (the step's includes the sim).
        const render = u.look.render.bind(u.look);
        const renderTimes = [];
        u.look.render = (cam) => {
          const t0 = performance.now();
          render(cam);
          renderTimes.push(performance.now() - t0);
        };
        if (drive) {
          // The nearest car, and a weaver: steer past the nearest traffic, handbrake into big turns.
          const near = u.vehicles
            .filter((v) => !v.damage.wrecked)
            .map((v) => ({ v, d: Math.hypot(v.sim.x - u.player.position.x, v.sim.z - u.player.position.z) }))
            .sort((a, b) => a.d - b.d)[0];
          if (near) u.progress.board(near.v);
          const ctl = { throttle: 0, steer: 0, handbrake: false, boost: false };
          const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
          u.input.readVehicle = (car) => {
            const me = u.player.driving;
            car = car ?? me?.sim;
            if (!car) return ctl;
            let best = null;
            let bd = 90;
            for (const v of u.vehicles) {
              if (v === me || v.damage?.wrecked || v.sim.y > 0.5) continue;
              const d = Math.hypot(v.sim.x - car.x, v.sim.z - car.z);
              if (d < bd && d > 6) {
                bd = d;
                best = v;
              }
            }
            const tx = best ? best.sim.x + Math.cos(best.sim.heading) * 3 : car.x;
            const tz = best ? best.sim.z - Math.sin(best.sim.heading) * 3 : car.z + 10;
            const err = wrap(Math.atan2(tx - car.x, tz - car.z) - car.heading);
            const sp = Math.hypot(car.vx, car.vz);
            ctl.steer = Math.max(-1, Math.min(1, -err * 2.2));
            ctl.throttle = 1;
            ctl.handbrake = sp > 9 && Math.abs(err) > 0.7;
            ctl.boost = false;
            return ctl;
          };
        }
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
        const shots = [];
        const out = {};
        const stepTimes = [];
        const lowFx = u.look.lowFx;
        let lowFrames = 0;
        let smokeWorkSum = 0;
        let smokeFillSum = 0;
        const steps = Math.round((seconds * 1000) / stepMs);
        const first = Math.round(500 / stepMs);
        const SCENES = ['race', 'chaseCar', 'accident', 'fight', 'tow', 'turf', 'fire'];
        let nextScene = 0;
        if (pursuit) u.progress.progress.data.tutorial = 3;
        for (let k = 0; k < steps; k++) {
          const t = (k * stepMs) / 1000;
          if (pursuit) {
            if (k === first) u.heat.wanted.force(5);
            else if (k > first && u.heat.wanted.level < 5 && !u.player.arrested) u.heat.wanted.force(5);
            if (u.player.driving) u.player.driving.damage.health = u.player.driving.damage.maxHealth;
            if (k >= first && k % Math.round(5000 / stepMs) === 0) u.testTools.scene(SCENES[nextScene++ % SCENES.length]);
          }
          if (drive) {
            // nothing blown up
          } else if (single) {
            // Normal play: one car blowing up near you.
            if (k === first) for (const c of cars().slice(0, 1)) boom(c.v);
          } else if (k === first) {
            for (const w of walls) blast(w.x, w.z);
            for (const c of cars().slice(0, 4)) boom(c.v);
          }
          if (single || drive) {
            // nothing more
          } else if (k === Math.round(8000 / stepMs)) for (const c of cars().slice(0, 2)) boom(c.v);
          else if (k === Math.round(16000 / stepMs)) {
            for (const c of cars().slice(0, 2)) boom(c.v);
            if (walls[0]) blast(walls[0].x, walls[0].z);
          }
          if (!cityFires && fires) for (const f of fires.fires) f.alive = false;
          const t0 = performance.now();
          u.stepFrame(stepMs);
          stepTimes.push(performance.now() - t0);
          // The soft particles' fragment work this frame, full-resolution screens.
          const st = lowFx?.stats;
          const smokeFill = poolFill(u.effects.soft).area;
          const smokeWork = st?.active ? smokeFill * st.scale * st.scale * 1.25 + st.share : smokeFill;
          if (st?.active) lowFrames++;
          smokeWorkSum += smokeWork;
          smokeFillSum += smokeFill;
          const tNext = ((k + 1) * stepMs) / 1000;
          for (const at of shotsAt) {
            // The frame just drawn, copied in the same task as its render (no preserved drawing buffer).
            if (!(at > t && at <= tNext)) continue;
            shots.push({ at, name: '', url: canvas.toDataURL('image/jpeg', 0.85) });
            if (!lowFx) continue;
            // The same frame drawn both ways (a redraw: nothing moves).
            const was = lowFx.mode;
            for (const [mode, name] of [['off', '-full'], ['on', '-low']]) {
              lowFx.mode = mode;
              render(u.rig.camera);
              shots.push({ at, name, url: canvas.toDataURL('image/jpeg', 0.85) });
            }
            lowFx.mode = was;
          }
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
              smokeWork: Math.round(smokeWork * 100) / 100,
              low: st?.active ? 1 : 0,
              lowFill: st ? Math.round(st.fill * 100) / 100 : 0,
              lowShare: st ? Math.round(st.share * 100) / 100 : 0,
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
              busy: u.cityLife.busyRunning?.() ?? 0,
              units: u.heat.police.units.length,
            });
          }
        }
        // The frame at the end, copied in the same task as its render (no preserved drawing buffer).
        let shot = null;
        if (wantShot) {
          u.stepFrame(stepMs);
          shot = canvas.toDataURL('image/jpeg', 0.8);
        }
        stepTimes.sort((a, b) => a - b);
        const n = stepTimes.length;
        return {
          shot,
          shots,
          // Median: a busy machine's stalls swamp a mean.
          jsMs: Math.round(stepTimes[Math.floor(n / 2)] * 10) / 10,
          jsP95: Math.round(stepTimes[Math.floor(n * 0.95)] * 10) / 10,
          renderMs: Math.round(renderTimes.sort((a, b) => a - b)[Math.floor(renderTimes.length / 2)] * 10) / 10,
          lowShare: Math.round((100 * lowFrames) / n),
          smokeWorkAvg: Math.round((smokeWorkSum / n) * 100) / 100,
          smokeFillAvg: Math.round((smokeFillSum / n) * 100) / 100,
          lowSize: lowFx ? `${lowFx.stats.width}x${lowFx.stats.height}` : '-',
          walls: walls.length, breaches: u.destruction.stats().breaches, rapier: u.destruction.stats().rapier, samples, tier: u.resolution.summary(), viewArea: Math.round(u.effects.viewArea) };
      },
      {
        time,
        seconds: opt.seconds,
        stepMs: STEP_MS,
        cityFires: !opt['no-city-fires'],
        wantShot: !!opt.shot && !SHOTS.length,
        shotsAt: opt.shot ? SHOTS : [],
        single: opt.scenario === 'single',
        drive: opt.scenario === 'drive' || opt.scenario === 'pursuit',
        pursuit: opt.scenario === 'pursuit',
        fx: opt.fx,
        fxScale: opt['fx-scale'],
      },
    );
    if (r.shot) writeFileSync(path.join(opt.shot, `mayhem-${tier}-${time}.jpg`), Buffer.from(r.shot.split(',')[1], 'base64'));
    for (const sh of r.shots) writeFileSync(path.join(opt.shot, `${opt.scenario}-${tier}-${time}-${sh.at}s${sh.name}.jpg`), Buffer.from(sh.url.split(',')[1], 'base64'));
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
      'smoke fill avg': r.smokeFillAvg,
      'smoke work pk': peak('smokeWork'),
      'smoke work avg': r.smokeWorkAvg,
      'low %': r.lowShare,
      low: r.lowSize,
      'glows pk': peak('glows'),
      'glowFill pk': peak('glowFill'),
      'dc pk': peak('dc'),
      'dc avg': mean('dc'),
      'js ms': r.jsMs,
      'js p95': r.jsP95,
      'render ms': r.renderMs,
      'fires pk': peak('fires'),
      'rubble pk': peak('rubbleDrawn'),
      'busy pk': peak('busy'),
      'units pk': peak('units'),
    };
    rows.push(row);
    console.log(JSON.stringify(row));
    if (process.env.VERBOSE) for (const x of s) console.log(JSON.stringify(x));
  }
}
await browser.close();
console.table(rows);

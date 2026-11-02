/**
 * Sun shadow harness: on the iPhone 15 Pro landscape profile, step real
 * frames by day, at dusk, at dawn and at night, standing still and driving,
 * and report the shadow pass alone: draw calls and triangles per frame
 * (mean, p95, max), the frames that redraw the static cache and what they
 * cost, and the redraws a second by reason (look.shadowStats).
 *
 *   npx -y -p playwright@1.63.0 node tools/tune/shadows.mjs [--tier medium] [--seconds 6]
 *       [--times day,dusk,dawn,night] [--scenarios park,drive] [--step 16.67] [--seed 7]
 *
 * The dev server must be up (npm run dev); URL overrides the address.
 */
import { args, launch, pct, playwright } from './lib.mjs';

const URL = process.env.URL ?? 'http://localhost:5173/';
const opt = args({ tier: 'medium', seconds: 6, times: 'day,dusk,dawn,night', scenarios: 'park,drive', step: 1000 / 60, seed: 7 });
const HOURS = { day: 13, dusk: 19.3, dawn: 6.1, night: 23 };

const browser = await launch();
const { devices } = await playwright();
const iphone = devices['iPhone 15 Pro landscape'];
const rows = [];
for (const scenario of String(opt.scenarios).split(',')) {
  for (const time of String(opt.times).split(',')) {
    const ctx = await browser.newContext({ ...iphone, viewport: { width: 852, height: 393 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
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
        window.requestAnimationFrame = () => 0;
        localStorage.setItem('curbside.settings', JSON.stringify({ quality: tier, godMode: true }));
      },
      { tier: opt.tier, seed: opt.seed },
    );
    await page.goto(URL);
    await page.waitForFunction(() => window.__ub, null, { timeout: 90000 });
    await page.waitForTimeout(1500);
    const r = await page.evaluate(
      async ({ hour, scenario, seconds, stepMs }) => {
        const u = window.__ub;
        u.startGame();
        for (let i = 0; i < 20; i++) u.stepFrame(stepMs);
        u.look.time.set(hour);
        if (scenario === 'drive') {
          const near = u.vehicles
            .filter((v) => !v.damage.wrecked)
            .map((v) => ({ v, d: Math.hypot(v.sim.x - u.player.position.x, v.sim.z - u.player.position.z) }))
            .sort((a, b) => a.d - b.d)[0];
          if (near) u.progress.board(near.v);
          const ctl = { throttle: 1, steer: 0, handbrake: false, boost: false };
          // Straight on, turning at the end of a street (a slow circle when blocked).
          u.input.readVehicle = () => {
            const car = u.player.driving?.sim;
            if (car) ctl.steer = Math.hypot(car.vx, car.vz) < 4 ? 0.6 : 0;
            return ctl;
          };
        }
        // Settle (the cache's first draw, the window's size) before measuring.
        for (let i = 0; i < 60; i++) u.stepFrame(stepMs);
        const sm = u.renderer.shadowMap;
        const info = u.renderer.info.render;
        const stats = u.look.shadowStats ?? { staticRenders: 0, reasons: {} }; // none before the cache
        const frames = [];
        let cur = null;
        const inner = sm.render;
        sm.render = function (...a) {
          const c0 = info.calls;
          const t0 = info.triangles;
          inner.apply(this, a);
          cur.calls += info.calls - c0;
          cur.tris += info.triangles - t0;
        };
        const before = { n: stats.staticRenders, ...stats.reasons };
        const n = Math.round((seconds * 1000) / stepMs);
        let speed = 0;
        for (let i = 0; i < n; i++) {
          cur = { calls: 0, tris: 0, redraw: false };
          const s0 = stats.staticRenders;
          u.stepFrame(stepMs);
          cur.redraw = stats.staticRenders !== s0;
          frames.push(cur);
          const car = u.player.driving?.sim;
          if (car) speed += Math.hypot(car.vx, car.vz) / n;
        }
        sm.render = inner;
        const reasons = {};
        for (const k of Object.keys(stats.reasons)) reasons[k] = stats.reasons[k] - before[k];
        return { frames, reasons, redraws: stats.staticRenders - before.n, speed };
      },
      { hour: HOURS[time], scenario, seconds: opt.seconds, stepMs: opt.step },
    );
    const f = r.frames;
    const calls = f.map((x) => x.calls);
    const tris = f.map((x) => x.tris);
    const red = f.filter((x) => x.redraw);
    const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    const k = (x) => `${Math.round(x / 1000)}k`;
    const row = {
      scenario,
      time,
      speed: r.speed.toFixed(1),
      'redraws/s': (r.redraws / opt.seconds).toFixed(1),
      reasons: Object.entries(r.reasons)
        .filter(([, v]) => v)
        .map(([key, v]) => `${key} ${v}`)
        .join(', '),
      calls: `${mean(calls).toFixed(1)} / ${pct(calls, 95)} / ${Math.max(...calls)}`,
      tris: `${k(mean(tris))} / ${k(pct(tris, 95))} / ${k(Math.max(...tris))}`,
      'redraw frame': red.length ? `${mean(red.map((x) => x.calls)).toFixed(0)} calls, ${k(mean(red.map((x) => x.tris)))} (max ${k(Math.max(...red.map((x) => x.tris)))})` : '-',
    };
    rows.push(row);
    console.log(JSON.stringify(row));
    await ctx.close();
  }
}
await browser.close();
console.log('\ncalls and tris: mean / p95 / max per frame, shadow pass only');
console.table(rows);

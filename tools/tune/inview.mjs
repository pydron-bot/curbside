/**
 * In-view harness (V2-01): how much of the living city a driving player
 * actually sees. A bot drives the iPhone 15 Pro landscape view (852×393)
 * through scripted free roam (no stars: anything it picks up is cleared),
 * then a 2-star pursuit (kept at 2, evading the police like heat.mjs), and
 * the game's own meter (systems/inViewMeter.ts, `__ub.inView()`) reports per
 * scene kind: seconds in view, how many started, how many were seen and how
 * many ended unseen, plus the gaps between incidents coming into view.
 *
 *   npx -y -p playwright@1.63.0 node tools/tune/inview.mjs [--roam 1200] [--pursuit 300] [--stars 2] [--seed 1] [--view 852x393]
 *
 * The sim runs with fastForward in 1/8 s chunks; between chunks the
 * harness moves the camera (rig.update, which only frames do in play) and
 * the clock (look.time.update), so "on screen" and night/day are as played.
 * The dev server must be up (npm run dev); URL overrides the address.
 */
import { args, launch, pct } from './lib.mjs';

const URL = process.env.URL ?? 'http://localhost:5173/curbside/';
const opt = args({ roam: 1200, pursuit: 300, stars: 2, seed: 1, view: '852x393' });
const [W, H] = String(opt.view).split('x').map(Number);

const browser = await launch();
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('pageerror', (e) => console.error('pageerror:', e.message));
await page.addInitScript((seed) => {
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
  localStorage.setItem('curbside.settings', JSON.stringify({ godMode: true }));
}, opt.seed);
await page.goto(URL);
await page.waitForFunction(() => window.__ub, null, { timeout: 90000 });
await page.waitForTimeout(1500);

await page.evaluate(() => {
  const u = window.__ub;
  u.startGame();
  // Past the first-run tutorial (its pointers hold the loud scenes off).
  u.progress.progress.data.tutorial = 3;
  const B = 64;
  const MAX = 8;
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const ctl = { throttle: 0, steer: 0, handbrake: false, boost: false };
  const bot = (window.__bot = { node: null, from: null, stuck: 0, backing: 0, last: 0, evade: false });
  // Police pressure toward a node (only while evading); a little noise so free roam wanders.
  const pressure = (x, z) => {
    let p = Math.random() * 0.002;
    if (!bot.evade) return p;
    for (const unit of u.heat.police.units) {
      const v = unit.vehicle;
      if (!v || unit.dismissed) continue;
      p += 1 / Math.max(Math.hypot(v.sim.x - x, v.sim.z - z), 10);
    }
    return p;
  };
  const choose = (at, from) => {
    let best = null;
    let bp = Infinity;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = [at[0] + dx, at[1] + dz];
      if (Math.abs(n[0]) > MAX || Math.abs(n[1]) > MAX) continue;
      if (from && n[0] === from[0] && n[1] === from[1]) continue;
      const p = pressure(n[0] * B, n[1] * B);
      if (p < bp) {
        bp = p;
        best = n;
      }
    }
    return best;
  };
  u.input.readVehicle = (car) => {
    car = car ?? u.player.driving?.sim;
    if (!car) return ctl;
    const dt = Math.min(0.1, Math.max(0, u.simTime - bot.last));
    bot.last = u.simTime;
    if (!bot.node) {
      bot.from = [Math.round(car.x / B), Math.round(car.z / B)];
      bot.node = choose(bot.from, null);
    }
    let tx = bot.node[0] * B;
    let tz = bot.node[1] * B;
    let dist = Math.hypot(tx - car.x, tz - car.z);
    if (dist < 12) {
      const next = choose(bot.node, bot.from);
      bot.from = bot.node;
      bot.node = next;
      tx = next[0] * B;
      tz = next[1] * B;
      dist = Math.hypot(tx - car.x, tz - car.z);
    }
    const hx = (tx - car.x) / (dist || 1);
    const hz = (tz - car.z) / (dist || 1);
    const err = wrap(Math.atan2(tx - hz * 4 - car.x, tz + hx * 4 - car.z) - car.heading);
    const sp = Math.hypot(car.vx, car.vz);
    bot.stuck = sp < 1.5 ? bot.stuck + dt : 0;
    if (bot.stuck > 1.2) {
      bot.backing = 1;
      bot.stuck = 0;
    }
    if (bot.backing > 0) {
      bot.backing -= dt;
      ctl.throttle = -1;
      ctl.steer = err > 0 ? 1 : -1;
      ctl.handbrake = ctl.boost = false;
      return ctl;
    }
    ctl.steer = Math.max(-1, Math.min(1, -err * 2.4));
    // Free roam at town speed; flat out when evading.
    const top = bot.evade ? 30 : 17;
    ctl.throttle = dist < 30 && sp > 14 ? -1 : Math.abs(err) > 1 && sp > 12 ? 0 : sp > top ? 0 : 1;
    ctl.handbrake = false;
    ctl.boost = bot.evade && Math.abs(err) < 0.2 && dist > 40;
    return ctl;
  };
  // One segment: `seconds` of driving at `stars` (0: cleared as it comes), the meter from zero.
  window.__segment = (seconds, stars) => {
    const m = u.cityLife.inViewMeter;
    m.clear();
    bot.evade = stars > 0;
    const board = () => {
      const p = u.player.position;
      const ix = Math.max(-6, Math.min(6, Math.round(p.x / B)));
      const iz = Math.max(-6, Math.min(6, Math.round(p.z / B)));
      const car = u.progress.spawnCar('sedan', 0x2266ff, ix * B + 4, iz * B - 12, Math.PI);
      u.progress.board(car);
      Object.assign(bot, { node: null, from: null, stuck: 0, backing: 0, last: u.simTime });
    };
    if (!u.player.driving) board();
    u.heat.wanted.force(stars);
    const step = 1 / 8;
    const gaps = [];
    let wasQuiet = 0;
    let boards = 0;
    for (let t = 0; t < seconds; t += step) {
      u.fastForward(step);
      u.look.time.update(step);
      const p = u.player.position;
      const v = u.player.driving?.sim;
      u.rig.update(step, p.x, p.z, v ? v.vx : 0, v ? v.vz : 0);
      if (u.player.driving) u.player.driving.damage.health = u.player.driving.damage.maxHealth;
      const lvl = u.heat.wanted.level;
      if (!u.player.arrested && !u.player.driving && u.player.alive) {
        board();
        boards++;
      }
      if (lvl !== stars && !u.player.arrested && u.player.alive) u.heat.wanted.force(stars);
      if (m.quiet === 0 && wasQuiet > 0) gaps.push(wasQuiet);
      wasQuiet = m.quiet;
    }
    return { report: u.inView(), gaps, boards, hour: u.look.time.hour };
  };
});

const segments = [
  ['FREE ROAM', opt.roam, 0],
  [`${opt.stars}-STAR PURSUIT`, opt.pursuit, opt.stars],
];
for (const [name, seconds, stars] of segments) {
  if (!seconds) continue;
  const r = await page.evaluate(([s, k]) => window.__segment(s, k), [seconds, stars]);
  const rep = r.report;
  const min = rep.played / 60;
  console.log(`\n${name}  ${Math.round(rep.played)} s (${min.toFixed(1)} min), seed ${opt.seed}, view ${W}x${H}, ended at hour ${r.hour.toFixed(1)}${r.boards ? `, re-boarded ${r.boards}×` : ''}`);
  console.log(
    `  incident in view ${Math.round(rep.anyInView)} s (${Math.round((100 * rep.anyInView) / Math.max(1, rep.played))}%) · came into view ${r.gaps.length}× after a quiet spell · gap median ${Math.round(pct(r.gaps, 50)) || '-'} s, p90 ${Math.round(pct(r.gaps, 90)) || '-'} s · longest quiet ${Math.round(rep.longestQuiet)} s · quiet ≥90 s ${rep.longQuiets}×`,
  );
  console.table(
    Object.fromEntries(
      rep.rows.map((x) => [x.kind, { 'in view s': x.seconds, 's/min': Math.round((x.seconds / min) * 10) / 10, started: x.started, seen: x.seen, 'ended unseen': x.unseen }]),
    ),
  );
}
await browser.close();

/**
 * Chaos Run bot harness: plays N seeded runs per bot through the real game
 * and prints score percentiles, medal rates, how runs ended and points by
 * category. A relative check for scoring and CHAOS_MEDALS changes (run it
 * before and after with the same seeds), never an absolute verdict: the bots
 * are a lower bound and model no combo play.
 *
 *   npx -y -p playwright@1.63.0 node tools/tune/chaos.mjs [runs=20] [--bot rammer|weaver|drifter|all] [--seed 1]
 *
 * Bots (they replace input.readVehicle):
 *   rammer  - steers at the nearest car, full throttle, nitro on the straight.
 *   weaver  - aims 3 m beside the nearest car: close passes for near misses.
 *   drifter - the rammer, with the handbrake in any turn over ~35 degrees.
 */
import { args, openGame, pct } from './lib.mjs';

const opt = args({ bot: 'all', seed: 1 });
const RUNS = opt._[0] ?? 20;
const BOTS = opt.bot === 'all' ? ['rammer', 'weaver', 'drifter'] : [opt.bot];

const { browser, page } = await openGame();
await page.evaluate(() => window.__ub.startGame());

for (const bot of BOTS) {
  await page.evaluate((kind) => {
    const u = window.__ub;
    const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
    const ctl = { throttle: 0, steer: 0, handbrake: false, boost: false };
    let stuck = 0;
    let backing = 0;
    let last = u.simTime;
    u.input.readVehicle = (car) => {
      const me = u.player.driving;
      car = car ?? me?.sim;
      if (!car) return ctl;
      const dt = Math.min(0.1, Math.max(0, u.simTime - last));
      last = u.simTime;
      let best = null;
      let bd = 90;
      for (const v of u.vehicles) {
        if (v === me || v.damage?.wrecked || v.sim.y > 0.5) continue;
        const d = Math.hypot(v.sim.x - car.x, v.sim.z - car.z);
        if (d < bd) {
          bd = d;
          best = v;
        }
      }
      let tx = 0;
      let tz = 0;
      if (best) {
        tx = best.sim.x;
        tz = best.sim.z;
        if (kind === 'weaver') {
          // 3 m to the target's right: a close pass, not a hit.
          tx += Math.cos(best.sim.heading) * 3;
          tz -= Math.sin(best.sim.heading) * 3;
        }
      }
      const err = wrap(Math.atan2(tx - car.x, tz - car.z) - car.heading);
      const sp = Math.hypot(car.vx, car.vz);
      // Nose in a wall: back off for a second, swinging round.
      stuck = sp < 1.5 ? stuck + dt : 0;
      if (stuck > 1.5) {
        backing = 1;
        stuck = 0;
      }
      if (backing > 0) {
        backing -= dt;
        ctl.throttle = -1;
        ctl.steer = err > 0 ? 1 : -1;
        ctl.handbrake = false;
        ctl.boost = false;
        return ctl;
      }
      ctl.steer = Math.max(-1, Math.min(1, -err * 2.2));
      ctl.throttle = 1;
      ctl.handbrake = sp > 9 && Math.abs(err) > (kind === 'drifter' ? 0.6 : 1.1);
      ctl.boost = Math.abs(err) < 0.3;
      return ctl;
    };
  }, bot);

  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    const r = await page.evaluate((seed) => {
      const u = window.__ub;
      window.__seed(seed);
      const cats = {};
      let end = null;
      const offA = u.events.on('award', (e) => (cats[e.award.kind] = (cats[e.award.kind] ?? 0) + e.award.points));
      const offE = u.events.on('activityEnd', (e) => {
        if (e.kind === 'chaosRun') end = e;
      });
      u.frontDoor.play(u.progress.chaos.titleMode);
      for (let t = 0; t < 400 && !end; t++) {
        u.fastForward(1);
        // The run's ending (slow-mo, then results) is clocked by the HUD, which fastForward doesn't draw.
        if (u.progress.chaos.phase === 'ending') u.progress.chaos.hud(1);
      }
      offA();
      offE();
      return { end, cats };
    }, opt.seed * 1000 + i);
    if (!r.end) {
      console.error(`${bot} run ${i}: no end within 400 s`);
      continue;
    }
    runs.push(r);
  }

  const scores = runs.map((r) => r.end.score ?? 0);
  const count = (f) => runs.filter(f).length;
  const cats = {};
  for (const r of runs) for (const [k, v] of Object.entries(r.cats)) cats[k] = (cats[k] ?? 0) + v;
  const total = Object.values(cats).reduce((a, b) => a + b, 0) || 1;
  const k = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));
  console.log(`\n${bot.toUpperCase()}  ${runs.length} runs (seeds ${opt.seed * 1000}..${opt.seed * 1000 + RUNS - 1})`);
  console.log(`  score  p25 ${k(pct(scores, 25))} · median ${k(pct(scores, 50))} · p75 ${k(pct(scores, 75))} · max ${k(Math.max(...scores))}`);
  console.log(`  medals gold ${count((r) => r.end.medal === 'gold')} · silver ${count((r) => r.end.medal === 'silver')} · bronze ${count((r) => r.end.medal === 'bronze')} · none ${count((r) => !r.end.medal)}`);
  console.log(`  ended  time ${count((r) => r.end.end === 'time')} · wasted ${count((r) => r.end.end === 'wasted')} · busted ${count((r) => r.end.end === 'busted')}`);
  console.log(`  bonus time median ${pct(runs.map((r) => r.end.bonusTime ?? 0), 50)} s`);
  console.log(
    `  points ${Object.entries(cats)
      .sort((a, b) => b[1] - a[1])
      .map(([c, v]) => `${c} ${Math.round((100 * v) / total)}%`)
      .join(' · ')}`,
  );
}

await browser.close();

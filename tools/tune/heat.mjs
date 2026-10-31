/**
 * 5-star chase harness: N seeded chases through the real game (bullets,
 * rams, crash damage, the helicopter) with an evading bot, and how they end.
 * For A/B runs of a heat knob (HELI_SHIFT, CAR_SHOT_EVERY, SPAWN_EVERY, ...)
 * with the same seeds, never an absolute verdict: the bot drives worse than a
 * person and doesn't use resprays.
 *
 *   npx -y -p playwright@1.63.0 node tools/tune/heat.mjs [chases=20] [--stars 5] [--secs 180] [--tough] [--seed 1]
 *
 * Each chase: a fresh run, a sports car at a random inner crossing, 3 stars
 * for 10 s so units are on the street (not a cold force(5)), then --stars.
 * The bot drives junction to junction and at each picks the exit with the
 * least police and helicopter pressure, never straight back; it backs off
 * walls. --tough keeps the car's health topped up, isolating the evasion
 * rules from the damage model.
 */
import { args, openGame, pct } from './lib.mjs';

const opt = args({ stars: 5, secs: 180, tough: false, seed: 1 });
const CHASES = opt._[0] ?? 20;

const { browser, page } = await openGame();
await page.evaluate(() => window.__ub.startGame());

await page.evaluate(() => {
  const u = window.__ub;
  const B = 64;
  const MAX = 8;
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const ctl = { throttle: 0, steer: 0, handbrake: false, boost: false };
  const bot = (window.__bot = { node: null, from: null, stuck: 0, backing: 0, last: 0 });
  const pressure = (x, z) => {
    let p = 0;
    for (const unit of u.heat.police.units) {
      const v = unit.vehicle;
      if (!v || unit.dismissed) continue;
      const d = Math.hypot(v.sim.x - x, v.sim.z - z);
      if (d < 200) p += 1 / Math.max(d, 10);
    }
    const h = u.heat.police.heli;
    if (h.active && !h.leaving) p += 2 / Math.max(Math.hypot(h.spotX - x, h.spotZ - z), 10);
    return p;
  };
  const nearestNode = (x, z) => [Math.round(x / B), Math.round(z / B)];
  const choose = (at, from) => {
    let best = null;
    let bp = Infinity;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = [at[0] + dx, at[1] + dz];
      if (Math.abs(n[0]) > MAX || Math.abs(n[1]) > MAX) continue;
      if (from && n[0] === from[0] && n[1] === from[1]) continue;
      const p = pressure(n[0] * B, n[1] * B) + Math.random() * 0.002;
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
      bot.from = nearestNode(car.x, car.z);
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
    // Keep right of the centreline.
    const hx = (tx - car.x) / (dist || 1);
    const hz = (tz - car.z) / (dist || 1);
    const ax = tx - hz * 4;
    const az = tz + hx * 4;
    const err = wrap(Math.atan2(ax - car.x, az - car.z) - car.heading);
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
      ctl.handbrake = false;
      ctl.boost = false;
      return ctl;
    }
    ctl.steer = Math.max(-1, Math.min(1, -err * 2.4));
    // Slow for the junction ahead (it will turn: corners at ~13 m/s).
    ctl.throttle = dist < 30 && sp > 14 ? -1 : Math.abs(err) > 1 && sp > 12 ? 0 : 1;
    ctl.handbrake = false;
    ctl.boost = Math.abs(err) < 0.2 && dist > 40;
    return ctl;
  };
});

const runs = [];
for (let i = 0; i < CHASES; i++) {
  const r = await page.evaluate(
    ({ seed, stars, secs, tough }) => {
      const u = window.__ub;
      window.__seed(seed);
      u.startGame();
      // A sports car at a random inner crossing.
      const ix = Math.floor(Math.random() * 11) - 5;
      const iz = Math.floor(Math.random() * 11) - 5;
      const car = u.progress.spawnCar('sports', 0x2266ff, ix * 64 + 4, iz * 64 - 12, Math.PI);
      u.progress.board(car);
      Object.assign(window.__bot, { node: null, from: null, stuck: 0, backing: 0, last: u.simTime });
      const out = { first: {}, end: 'held', endAt: secs, crashes: 0, crashImpact: 0, shots: 0, heliSeen: 0, minLevel: stars };
      const offs = [
        u.events.on('busted', () => (out.end = out.end === 'held' ? 'busted' : out.end)),
        u.events.on('playerDied', () => (out.end = out.end === 'held' ? 'wasted' : out.end)),
        u.events.on('crash', (e) => {
          if (!e.involvesPlayer) return;
          out.crashes++;
          out.crashImpact += e.impact;
        }),
        u.events.on('bulletHit', (e) => {
          if (e.byPlayer) return;
          const c = u.player.driving?.sim;
          if (e.target === 'player' || (c && e.target === 'vehicle' && Math.hypot(e.x - c.x, e.z - c.z) < 3)) out.shots++;
        }),
      ];
      // Build up: units on the street at 3 stars first.
      u.heat.wanted.force(3);
      u.fastForward(10);
      u.heat.wanted.force(stars);
      const dt = 0.25;
      for (let t = 0; t < secs && out.end === 'held'; t += dt) {
        u.fastForward(dt);
        if (tough && u.player.driving) u.player.driving.damage.health = u.player.driving.damage.maxHealth;
        if (!u.player.driving && out.end === 'held') out.end = 'wrecked';
        // Busted or wasted clears the stars: that's no escape.
        if (out.end !== 'held') {
          out.endAt = Math.round(t);
          break;
        }
        if (u.heat.police.heli.sees) out.heliSeen += dt;
        const lvl = u.heat.wanted.level;
        out.minLevel = Math.min(out.minLevel, lvl);
        for (let s = stars - 1; s >= 0; s--) if (lvl <= s && out.first[s] === undefined) out.first[s] = Math.round(t);
        if (lvl === 0) {
          out.end = 'escaped';
          out.endAt = Math.round(t);
        }
      }
      for (const off of offs) off();
      return out;
    },
    { seed: opt.seed * 1000 + i, stars: opt.stars, secs: opt.secs, tough: opt.tough === true },
  );
  runs.push(r);
}

const n = runs.length;
const count = (f) => runs.filter(f).length;
const s = opt.stars;
console.log(`\n${s}-STAR CHASES  ${n} (seeds ${opt.seed * 1000}..${opt.seed * 1000 + n - 1}), ${opt.secs} s each${opt.tough ? ', tough car' : ''}`);
console.log(`  ended   escaped ${count((r) => r.end === 'escaped')} · busted ${count((r) => r.end === 'busted')} · wasted ${count((r) => r.end === 'wasted')} · car lost ${count((r) => r.end === 'wrecked')} · still wanted ${count((r) => r.end === 'held')}`);
for (let k = s - 1; k >= 0; k--) {
  const ts = runs.map((r) => r.first[k]).filter((t) => t !== undefined);
  console.log(`  ≤${k} star${k === 1 ? '' : 's'}  ${ts.length}/${n}${ts.length ? `, median at ${pct(ts, 50)} s` : ''}`);
}
console.log(`  ending  median at ${pct(runs.filter((r) => r.end !== 'held').map((r) => r.endAt), 50) || '-'} s`);
console.log(`  per chase: crashes median ${pct(runs.map((r) => r.crashes), 50)} (impact ${pct(runs.map((r) => Math.round(r.crashImpact)), 50)}) · shots taken median ${pct(runs.map((r) => r.shots), 50)} · heli on you median ${pct(runs.map((r) => r.heliSeen), 50)} s`);

await browser.close();

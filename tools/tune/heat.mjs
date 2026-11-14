/**
 * 5-star chase harness: N seeded chases through the real game (bullets,
 * rams, crash damage, the helicopter) with an evading bot, and how they end.
 * For A/B runs of a heat knob (HELI_SHIFT, CAR_SHOT_EVERY, SPAWN_EVERY, ...)
 * with the same seeds, never an absolute verdict: the bot drives worse than a
 * person and doesn't use resprays.
 *
 *   npx -y -p playwright@1.63.0 node tools/tune/heat.mjs [chases=20] [--stars 5] [--secs 180] [--tough] [--perks] [--seed 1]
 *     [--wheels] [--lielow] [--believed]
 *
 * Each chase: a fresh run, a sports car at a random inner crossing, 3 stars
 * for 10 s so units are on the street (not a cold force(5)), then --stars.
 * The bot drives junction to junction and at each picks the exit with the
 * least police and helicopter pressure, never straight back; it backs off
 * walls. --tough keeps the car's health topped up, isolating the evasion
 * rules from the damage model. --perks plays with every CRED perk maxed
 * (game/cred.ts), to check 5 stars stay a threat at the top end.
 *
 * The ways out (heat.md), each a bot habit to measure what it's worth:
 * "Lost" is what the radar shows: wanted, and the police don't know where you
 * are (the search ring is up). --wheels: lost, NEW WHEELS not on yet and no
 * unit within 60 m, it stops by a parked car within 25 m it hasn't used,
 * waits 2 s (out, across, in) and takes it. --lielow: lost with no unit within
 * 70 m, it heads for the nearest hideout outside the search ring (a car park
 * within 90 m, else an alley it fits within 70 m), junction to junction to
 * the road at its mouth, then in, and stops until it's seen (then backs out)
 * or clean. --believed: lost, it also steers away
 * from where the police think it is (the radar's search ring).
 *
 * --lost starts each chase with the police already shaken off: after the
 * build-up the car is put, stopped, at a junction 4–5 blocks from where they
 * last saw it (they don't know). The phase the ways out are for, without the
 * bot's luck at breaking line of sight in the first place; compare habits on it.
 */
import { args, openGame, pct } from './lib.mjs';

const opt = args({ stars: 5, secs: 180, tough: false, perks: false, seed: 1, wheels: false, lielow: false, believed: false, lost: false });
const habits = { wheels: opt.wheels === true, lielow: opt.lielow === true, believed: opt.believed === true };
const CHASES = opt._[0] ?? 20;

const { browser, page } = await openGame();
await page.evaluate(() => window.__ub.startGame());
if (opt.perks === true) {
  await page.evaluate(() => {
    const c = window.__ub.progress.progress.data.cred;
    for (const id of ['tough', 'vest', 'bodywork', 'nitro', 'slippery', 'ghost', 'hustler', 'banker']) c.perks[id] = 4;
    c.picked = 32;
    c.total = 1e6;
  });
}

await page.evaluate((habits) => {
  const u = window.__ub;
  const B = 64;
  const MAX = 8;
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const ctl = { throttle: 0, steer: 0, handbrake: false, boost: false };
  const bot = (window.__bot = { node: null, from: null, stuck: 0, backing: 0, last: 0, hide: null, hideCool: 0, swap: 0, swapCar: null, used: new Set() });
  const lost = () => u.heat.wanted.level > 0 && !u.heat.police.target.known;
  const unitsBeyond = (x, z, r) => {
    for (const unit of u.heat.police.units) if (unit.vehicle && !unit.dismissed && Math.hypot(unit.vehicle.sim.x - x, unit.vehicle.sim.z - z) < r) return false;
    return true;
  };
  // A hideout to drive into: a car park within 200 m, else an alley at least 3.4 m wide within
  // 120 m whose end opens onto a road. Out: a point on the road 7 m beyond its mouth; in: 4 m deep.
  const searchR = () => Math.min(140, 20 + 7 * u.heat.police.lostFor);
  const ROAD = (v) => Math.abs(v - Math.round(v / B) * B);
  const hideoutNear = (x, z) => {
    let best = null;
    let bd = Infinity;
    for (const h of u.heat.hideouts.list) {
      const w = h.maxX - h.minX;
      const l = h.maxZ - h.minZ;
      const cx = (h.minX + h.maxX) / 2;
      const cz = (h.minZ + h.maxZ) / 2;
      const d = Math.hypot(cx - x, cz - z);
      let spot = null;
      if (h.kind === 'carPark') {
        if (d > 90) continue;
        // In from the side nearest the car, off the road along it.
        const alongX = Math.abs(x - cx) > Math.abs(z - cz);
        const sx = Math.sign((alongX ? x - cx : z - cz) || 1);
        const edge = alongX ? (sx > 0 ? h.maxX : h.minX) : sx > 0 ? h.maxZ : h.minZ;
        spot = alongX
          ? { outX: edge + sx * 10, outZ: cz, inX: edge - sx * 8, inZ: cz }
          : { outX: cx, outZ: edge + sx * 10, inX: cx, inZ: edge - sx * 8 };
        spot.cost = d * 0.6;
      } else {
        if (d > 70 || Math.min(w, l) < 3.4) continue;
        const alongZ = l > w;
        // The end that opens onto a road (the interior edge is 11 m off a road's centreline).
        for (const end of alongZ ? [h.minZ, h.maxZ] : [h.minX, h.maxX]) {
          if (Math.abs(ROAD(end) - 11) > 2.5) continue;
          const dir = end === (alongZ ? h.minZ : h.minX) ? -1 : 1;
          spot = alongZ
            ? { outX: cx, outZ: end + dir * 7, inX: cx, inZ: end - dir * 4 }
            : { outX: end + dir * 7, outZ: cz, inX: end - dir * 4, inZ: cz };
          spot.cost = d;
          break;
        }
      }
      // Not where they're looking: outside the search ring (heat.md, WHERE THEY THINK YOU ARE).
      const t = u.heat.police.target;
      if (spot && Math.hypot(cx - t.x, cz - t.z) < searchR() + 15) spot = null;
      if (spot && spot.cost < bd) {
        bd = spot.cost;
        best = { ...spot, entering: false };
      }
    }
    return best;
  };
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
    // Where they think you are: away from the search ring's centre.
    const t = u.heat.police.target;
    if (habits.believed && lost()) p += 1.5 / Math.max(Math.hypot(t.x - x, t.z - z), 10);
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
      // Heading for a car park to lie low in: the junction nearest it.
      const p = bot.hide
        ? Math.hypot(n[0] * B - bot.hide.outX, n[1] * B - bot.hide.outZ)
        : pressure(n[0] * B, n[1] * B) + Math.random() * 0.002;
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
    // Swapping cars: stopped while it gets out, across and in (the harness loop boards).
    if (bot.swap > 0) {
      ctl.throttle = Math.hypot(car.vx, car.vz) > 0.5 ? -1 : 0;
      ctl.steer = 0;
      ctl.handbrake = true;
      ctl.boost = false;
      return ctl;
    }
    // Lying low: out of sight, into the nearest hideout (heat.hideouts: a car park, or an alley wide
    // enough for the car), from the road at its mouth, and stop there until seen or clean.
    if (habits.lielow) {
      bot.hideCool -= dt;
      if (bot.hide && (u.heat.police.seen || u.heat.wanted.level === 0)) {
        bot.log?.push(`t=${u.simTime.toFixed(1)} hide off (${u.heat.police.seen ? 'seen' : 'clean'}) at (${car.x.toFixed(0)}, ${car.z.toFixed(0)}) entering ${bot.hide.entering} inside ${u.heat.hideout !== null}`);
        // Found in there: back out the way it came in.
        if (bot.hide.entering) bot.backing = 1.5;
        bot.hide = null;
        bot.hideCool = 2;
        bot.node = null;
      }
      if (!bot.hide && bot.hideCool <= 0 && lost() && unitsBeyond(car.x, car.z, 70)) {
        bot.hide = hideoutNear(car.x, car.z);
        if (bot.hide) {
          bot.node = null;
          bot.hides++;
          bot.log?.push(`t=${u.simTime.toFixed(1)} hide → (${bot.hide.outX.toFixed(0)}, ${bot.hide.outZ.toFixed(0)}) from (${car.x.toFixed(0)}, ${car.z.toFixed(0)})`);
        }
      }
      const hd = bot.hide;
      if (hd && Math.hypot(hd.outX - car.x, hd.outZ - car.z) < (hd.entering ? 60 : 30)) {
        const sp = Math.hypot(car.vx, car.vz);
        const inside = u.heat.hideout !== null;
        if (inside) bot.inside += dt;
        if (inside && bot.log && (bot.logIn = (bot.logIn ?? 0) - dt) <= 0) {
          bot.logIn = 1;
          bot.log.push(`t=${u.simTime.toFixed(1)} inside ${u.heat.hideout.kind} speed ${sp.toFixed(1)} entering ${hd.entering} to (${(hd.entering ? hd.inX : hd.outX).toFixed(0)}, ${(hd.entering ? hd.inZ : hd.outZ).toFixed(0)}) at (${car.x.toFixed(0)}, ${car.z.toFixed(0)}) lyingLow ${u.heat.wanted.lyingLow} seen ${u.heat.police.seen}`);
        }
        // Out on the road at its mouth first, then straight in along its length.
        if (!hd.entering && Math.hypot(hd.outX - car.x, hd.outZ - car.z) < 5) {
          hd.entering = true;
          bot.log?.push(`t=${u.simTime.toFixed(1)} entering`);
        }
        const gx = hd.entering ? hd.inX : hd.outX;
        const gz = hd.entering ? hd.inZ : hd.outZ;
        const e = wrap(Math.atan2(gx - car.x, gz - car.z) - car.heading);
        ctl.steer = Math.max(-1, Math.min(1, -e * 2.4));
        ctl.boost = false;
        if (hd.entering && inside && Math.hypot(gx - car.x, gz - car.z) < 4) {
          ctl.throttle = sp > 0.3 ? -1 : 0;
          ctl.handbrake = true;
        } else {
          const cap = hd.entering ? 4 : 8;
          ctl.throttle = sp > cap ? -1 : Math.abs(e) > 1.2 ? 0.25 : 0.6;
          ctl.handbrake = false;
        }
        return ctl;
      }
    }
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
}, habits);

const runs = [];
for (let i = 0; i < CHASES; i++) {
  const r = await page.evaluate(
    ({ seed, stars, secs, tough, trace, habits, startLost }) => {
      const u = window.__ub;
      window.__seed(seed);
      u.startGame();
      // A sports car at a random inner crossing.
      const ix = Math.floor(Math.random() * 11) - 5;
      const iz = Math.floor(Math.random() * 11) - 5;
      const car = u.progress.spawnCar('sports', 0x2266ff, ix * 64 + 4, iz * 64 - 12, Math.PI);
      u.progress.board(car);
      Object.assign(window.__bot, { node: null, from: null, stuck: 0, backing: 0, last: u.simTime });
      const out = { first: {}, end: 'held', endAt: secs, crashes: 0, crashImpact: 0, shots: 0, heliSeen: 0, minLevel: stars, dmgTotal: 0, dmgWalls: 0, dmgShots: 0, trace: [], carShots: 0, lyingLow: 0, newWheels: 0, paid: 0 };
      let lastShot = '';
      const lost = () => u.heat.wanted.level > 0 && !u.heat.police.target.known;
  const unitsBeyond = (x, z, r) => {
    for (const unit of u.heat.police.units) if (unit.vehicle && !unit.dismissed && Math.hypot(unit.vehicle.sim.x - x, unit.vehicle.sim.z - z) < r) return false;
    return true;
  };
      const nearestUnit = (x, z) => {
        let d = Infinity;
        for (const unit of u.heat.police.units) if (unit.vehicle && !unit.dismissed) d = Math.min(d, Math.hypot(unit.vehicle.sim.x - x, unit.vehicle.sim.z - z));
        return d;
      };
      const bot = window.__bot;
      bot.used = new Set([car]);
      bot.swap = 0;
      bot.hide = null;
      bot.hideCool = 0;
      bot.hides = 0;
      bot.log = trace ? out.trace : null;
      bot.inside = 0;
      // NEW WHEELS habit: lost for 2 s, a parked car close by that it hasn't used: stop, wait 2 s, take it.
      const wheels = (dt) => {
        const own = u.player.driving;
        if (!own) return;
        if (bot.swap > 0) {
          if ((bot.swap -= dt) > 0) return;
          if (bot.swapCar && !bot.swapCar.damage.wrecked) {
            bot.used.add(bot.swapCar);
            u.progress.board(bot.swapCar);
            if (u.heat.wanted.newWheels) out.newWheels++;
            Object.assign(bot, { node: null, from: null, stuck: 0, backing: 0 });
          }
          bot.swapCar = null;
          return;
        }
        if (!lost() || u.heat.wanted.newWheels || nearestUnit(own.sim.x, own.sim.z) < 60) return;
        let best = null;
        let bd = 25;
        for (const v of u.vehicles) {
          if (!v.parked || v.police || v.damage.wrecked || v === own || bot.used.has(v)) continue;
          const d = Math.hypot(v.sim.x - own.sim.x, v.sim.z - own.sim.z);
          if (d < bd) {
            bd = d;
            best = v;
          }
        }
        if (!best) return;
        bot.swapCar = best;
        bot.swap = 2;
      };
      // Damage split (estimated): walls from the crash table (systems/damage.ts: (impact − 6) × 2.6 × the
      // player's share × BODYWORK), bullets at 8 × 0.45 a hit, cars (rams, PITs, traffic) the rest.
      const wallHit = (impact) => Math.max(0, impact - 6) * 2.6 * (u.heat.crashShare ?? 0.6) * (u.player.driving?.damage.taken ?? 1);
      const offs = [
        u.progress.progress.onCash((c) => {
          if (c.reason === 'getaway') out.paid += c.amount;
        }),
        u.events.on('busted', () => (out.end = out.end === 'held' ? 'busted' : out.end)),
        u.events.on('playerDied', () => (out.end = out.end === 'held' ? 'wasted' : out.end)),
        u.events.on('crash', (e) => {
          if (!e.involvesPlayer) return;
          out.crashes++;
          out.crashImpact += e.impact;
          if (e.against === 'static' && live) out.dmgWalls += wallHit(e.impact);
          if (trace) out.trace.push(`  crash ${e.against} ${e.impact.toFixed(1)} m/s at t≈${(u.simTime - t0).toFixed(1)}`);
        }),
        u.events.on('explosion', (e) => {
          const c = u.player.driving?.sim;
          if (trace && c && Math.hypot(e.x - c.x, e.z - c.z) < 15) out.trace.push(`  explosion ${Math.hypot(e.x - c.x, e.z - c.z).toFixed(1)} m away at t≈${(u.simTime - t0).toFixed(1)}${e.police ? ' (police car)' : ''}`);
        }),
        u.events.on('shot', (e) => {
          if (e.byPlayer || !live) return;
          let car = false;
          for (const unit of u.heat.police.units) if (unit.vehicle && Math.hypot(unit.vehicle.sim.x - e.x, unit.vehicle.sim.z - e.z) < 3) car = true;
          lastShot = car ? 'car' : 'foot';
        }),
        u.events.on('bulletHit', (e) => {
          if (e.byPlayer) return;
          const c = u.player.driving?.sim;
          if (e.target === 'player' || (c && e.target === 'vehicle' && Math.hypot(e.x - c.x, e.z - c.z) < 3)) {
            out.shots++;
            if (lastShot === 'car') out.carShots++;
            if (c && live && e.target === 'vehicle') out.dmgShots += 3.6 * (u.player.driving?.damage.taken ?? 1);
          }
        }),
      ];
      const t0 = u.simTime + 10;
      let live = false;
      // Build up: units on the street at 3 stars first.
      u.heat.wanted.force(3);
      u.fastForward(10);
      u.heat.wanted.force(stars);
      if (startLost) {
        // Past the fresh call's 8 s of tracking first (systems/wanted.ts RESPONSE_GRACE).
        if (stars > 3) u.fastForward(8.5);
      }
      if (startLost && u.player.driving) {
        // Shaken off: 4–5 blocks from the last sighting, stopped at a junction, out of anyone's sight.
        const c = u.player.driving.sim;
        const t = u.heat.police.target;
        const sx = Math.random() < 0.5 ? 1 : -1;
        const sz = Math.random() < 0.5 ? 1 : -1;
        const jx = Math.max(-7, Math.min(7, Math.round(t.x / 64) + sx * (4 + Math.floor(Math.random() * 2))));
        const jz = Math.max(-7, Math.min(7, Math.round(t.z / 64) + sz * (Math.random() < 0.5 ? 0 : 1)));
        c.x = jx * 64 + 4;
        c.z = jz * 64 - 6;
        c.vx = c.vz = c.yawRate = 0;
        Object.assign(u.player.driving.prev, c);
        // Lost just over 2 s ago: past the radio's tracking after a sighting (game/heat.ts TRACK_AFTER_SIGHTING).
        u.heat.wanted.unseen = 2.1;
        Object.assign(window.__bot, { node: null, from: null, stuck: 0, backing: 0 });
      }
      live = true;
      if (trace) out.trace.push(`start ${Math.round(u.player.driving?.damage.health ?? 0)} HP`);
      const dt = 0.25;
      for (let t = 0; t < secs && out.end === 'held'; t += dt) {
        const before = u.player.driving;
        const h0 = before ? before.damage.health : 0;
        const wasBurning = before?.damage.burning;
        u.fastForward(dt);
        if (trace && before && h0 - before.damage.health > 3) out.trace.push(`t=${t} hp ${Math.round(h0)}→${Math.round(before.damage.health)}${before.damage.burning ? ' BURNING' : ''} speed ${Math.hypot(before.sim.vx, before.sim.vz).toFixed(1)}`);
        if (before && !wasBurning) out.dmgTotal += Math.max(0, h0 - before.damage.health);
        if (tough && u.player.driving) u.player.driving.damage.health = u.player.driving.damage.maxHealth;
        if (!u.player.driving && out.end === 'held') {
          out.end = 'wrecked';
          out.lost = before ? (before.damage.wrecked ? 'blew up' : before.damage.burning ? 'on fire' : `out at ${Math.round(before.damage.health)} HP`) : '?';
        }
        // Busted or wasted clears the stars: that's no escape.
        if (out.end !== 'held') {
          out.endAt = Math.round(t);
          break;
        }
        if (u.heat.police.heli.sees) out.heliSeen += dt;
        if (u.heat.wanted.lyingLow) out.lyingLow += dt;
        if (habits.wheels) wheels(dt);
        const lvl = u.heat.wanted.level;
        out.minLevel = Math.min(out.minLevel, lvl);
        for (let s = stars - 1; s >= 0; s--) if (lvl <= s && out.first[s] === undefined) out.first[s] = Math.round(t);
        if (lvl === 0) {
          out.end = 'escaped';
          out.endAt = Math.round(t);
        }
      }
      for (const off of offs) off();
      out.hides = bot.hides;
      out.inside = bot.inside;
      return out;
    },
    { seed: opt.seed * 1000 + i, stars: opt.stars, secs: opt.secs, tough: opt.tough === true, trace: !!process.env.TRACE, habits, startLost: opt.lost === true },
  );
  for (const line of r.trace) console.log(`  #${i} ${line}`);
  runs.push(r);
}

const n = runs.length;
if (process.env.VERBOSE) for (const [i, r] of runs.entries()) console.log(`  #${i} ${r.end} at ${r.endAt} s${r.lost ? ` (${r.lost})` : ''}, min ${r.minLevel}★`);
const count = (f) => runs.filter(f).length;
const s = opt.stars;
const habitList = Object.keys(habits).filter((k) => habits[k]);
console.log(`\n${s}-STAR CHASES  ${n} (seeds ${opt.seed * 1000}..${opt.seed * 1000 + n - 1}), ${opt.secs} s each${opt.tough ? ', tough car' : ''}${opt.perks ? ', every perk maxed' : ''}${habitList.length ? `, habits: ${habitList.join(', ')}` : ''}${opt.lost ? ', starting lost' : ''}`);
console.log(`  ended   escaped ${count((r) => r.end === 'escaped')} · busted ${count((r) => r.end === 'busted')} · wasted ${count((r) => r.end === 'wasted')} · car lost ${count((r) => r.end === 'wrecked')} · still wanted ${count((r) => r.end === 'held')}`);
for (let k = s - 1; k >= 0; k--) {
  const ts = runs.map((r) => r.first[k]).filter((t) => t !== undefined);
  console.log(`  ≤${k} star${k === 1 ? '' : 's'}  ${ts.length}/${n}${ts.length ? `, median at ${pct(ts, 50)} s` : ''}`);
}
console.log(`  ending  median at ${pct(runs.filter((r) => r.end !== 'held').map((r) => r.endAt), 50) || '-'} s`);
// How long the car (and the driver) lasted: an escape or a chase still going at the end counts as the whole run.
const lasted = runs.map((r) => (r.end === 'escaped' || r.end === 'held' ? opt.secs : r.endAt));
console.log(`  lasted  median ${pct(lasted, 50)} s (p25 ${pct(lasted, 25)}, p75 ${pct(lasted, 75)}; escapes and chases still going count as ${opt.secs} s)`);
const sum = (f) => runs.reduce((a, r) => a + f(r), 0);
const dTot = sum((r) => r.dmgTotal) || 1;
const dWall = Math.min(dTot, sum((r) => r.dmgWalls));
const dShot = Math.min(dTot - dWall, sum((r) => r.dmgShots));
if (!opt.tough) console.log(`  damage  ${Math.round(dTot / n)} HP a chase: walls ~${Math.round((100 * dWall) / dTot)}% · bullets ~${Math.round((100 * dShot) / dTot)}% · cars (rams, PITs, traffic) ~${Math.round((100 * (dTot - dWall - dShot)) / dTot)}%`);
if (habits.wheels || habits.lielow) console.log(`  habits  NEW WHEELS taken ${sum((r) => r.newWheels)} times (in ${count((r) => r.newWheels > 0)} chases) · hideouts tried ${sum((r) => r.hides ?? 0)}, ${Math.round(sum((r) => r.inside ?? 0))} s inside · lying low median ${pct(runs.map((r) => Math.round(r.lyingLow)), 50)} s a chase (max ${Math.max(...runs.map((r) => Math.round(r.lyingLow)))})`);
const paid = runs.filter((r) => r.end === 'escaped').map((r) => r.paid);
if (paid.length) console.log(`  GOT AWAY paid median $${pct(paid, 50)} (${paid.join(', ')})`);
console.log(`  per chase: crashes median ${pct(runs.map((r) => r.crashes), 50)} (impact ${pct(runs.map((r) => Math.round(r.crashImpact)), 50)}) · shots taken median ${pct(runs.map((r) => r.shots), 50)} (${Math.round((100 * sum((r) => r.carShots)) / (sum((r) => r.shots) || 1))}% from cars) · heli on you median ${pct(runs.map((r) => r.heliSeen), 50)} s`);

await browser.close();

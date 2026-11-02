/**
 * RACE CRASHER and VAN NICKED (V2-12) through the real game, headless.
 *
 * Races: a street race begun beside the spawn (no police), a sports car
 * put in the oncoming lane beside its leader, rolling, and a bot that
 * drives the route junction to junction (slowing for the turns, nitro on
 * the straights). Reported: joined, won or beaten, how long, the prize
 * pulled up and its driver out, and the player getting into it through
 * the real enter button (no carjack).
 * Vans: the ice cream van forced open beside the player, its queue left to
 * fill, then taken through the real enter button (a carjack) and driven
 * straight off by a bot. Reported: the queue, the chase starting, VAN
 * NICKED paid, how close the nearest chaser got, when they'd all given up,
 * and the stars (the carjack's own, nothing from the chase).
 *
 *   npx -y -p playwright@1.63.0 node tools/tune/crashers.mjs [runs=6] [--vans 6] [--seed 1]
 */
import { args, openGame } from './lib.mjs';

const opt = args({ vans: 6, seed: 1 });
const RUNS = opt._[0] ?? 6;

const { browser, page } = await openGame();
await page.evaluate(() => window.__ub.startGame());

/** Press the enter button for one frame (the real boardVehicle: carjack and all). */
const pressEnter = () =>
  page.evaluate(() => {
    const u = window.__ub;
    const real = u.input.consumeAction.bind(u.input);
    let once = true;
    u.input.consumeAction = () => {
      if (!once) return real();
      once = false;
      return true;
    };
    u.stepFrame();
    u.input.consumeAction = real;
  });

const races = [];
for (let i = 0; i < RUNS; i++) {
  const r = await page.evaluate(
    ({ seed }) => {
      const u = window.__ub;
      window.__seed(seed);
      u.startGame();
      u.fastForward(5);
      const p = u.player;
      const rs = u.cityLife.races;
      if (!rs.begin()) return { seed, result: 'no race' };
      const race = rs.races[0];
      race.police = Infinity;
      const lead = race.racers[0].v;
      const h = lead.sim.heading;
      const fx = Math.sin(h);
      const fz = Math.cos(h);
      // The oncoming lane, beside the leader and a little back: on the race's road, its way.
      const car = u.progress.spawnCar('sports', 0x22ccff, lead.sim.x + fz * 7.5 - fx * 4, lead.sim.z - fx * 7.5 - fz * 4, h);
      car.sim.vx = fx * 16;
      car.sim.vz = fz * 16;
      u.progress.board(car);
      const route = race.route;
      const ctl = { throttle: 1, steer: 0, handbrake: false, boost: false };
      window.__read ??= u.input.readVehicle;
      const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
      u.input.readVehicle = (s) => {
        s = s ?? p.driving?.sim;
        if (!s) return ctl;
        const c = race.crasher;
        const k = Math.min(c ? c.next : 0, route.length - 1);
        const n = route[k];
        let tx = n.ix * 64;
        let tz = n.iz * 64;
        if (c && c.next >= route.length) {
          tx = s.x + Math.sin(s.heading) * 20;
          tz = s.z + Math.cos(s.heading) * 20;
        }
        const diff = wrap(Math.atan2(tx - s.x, tz - s.z) - s.heading);
        const d = Math.hypot(tx - s.x, tz - s.z);
        const turn = k + 1 < route.length && route[k + 1].dir !== n.dir;
        const want = turn && d < 40 ? 13 : 40;
        const v = Math.hypot(s.vx, s.vz);
        ctl.steer = Math.max(-1, Math.min(1, -diff * 2.5));
        ctl.throttle = v < want ? 1 : -0.6;
        ctl.boost = want > 20 && Math.abs(diff) < 0.12;
        return ctl;
      };
      const out = { seed, result: 'not joined', racers: race.racers.length, legs: route.length, joinedAt: -1, time: -1, stamp: null, prize: false, handed: -1, tookIt: false, carjack: false };
      const offs = [u.events.on('stamp', (e) => (out.stamp = e.id)), u.events.on('carjack', () => (window.__cj = true))];
      for (let t = 0; t < 70; t += 0.25) {
        u.fastForward(0.25);
        if (out.joinedAt < 0 && race.crasher) out.joinedAt = t;
        if (race.crasher?.out) {
          out.result = race.crasher.won ? 'won' : 'beaten';
          out.time = Math.round(t);
          // A frame: the stamp's shown there (Stamps.step).
          if (race.crasher.won) u.stepFrame();
          break;
        }
        if (!rs.races.includes(race)) {
          out.result = race.crasher ? 'race over' : 'not joined';
          break;
        }
      }
      u.input.readVehicle = window.__read;
      const pz = rs.prize;
      out.prize = !!pz;
      if (pz) {
        for (let t = 0; t < 20 && !pz.handed; t += 0.25) {
          u.fastForward(0.25);
          if (pz.handed) out.handed = Math.round(t * 10) / 10;
        }
        if (!pz.handed) out.prizeState = { finishing: pz.finishing, speed: Math.round(Math.hypot(pz.v.sim.vx, pz.v.sim.vz) * 10) / 10, ai: !!pz.v.ai, still: pz.still, toPlayer: Math.round(Math.hypot(pz.v.sim.x - p.position.x, pz.v.sim.z - p.position.z)) };
        // Out, and beside its door.
        p.exit();
        const s = pz.v.sim;
        p.ped.x = s.x + Math.cos(s.heading) * 1.6;
        p.ped.z = s.z - Math.sin(s.heading) * 1.6;
        // How far past the finish (the last junction) it pulled up, m.
        const last = route[route.length - 1];
        out.prizeFromLine = Math.round(Math.hypot(s.x - last.ix * 64, s.z - last.iz * 64));
      }
      window.__cj = false;
      window.__offs = offs;
      window.__prize = pz?.v ?? null;
      return out;
    },
    { seed: opt.seed + i },
  );
  if (r.prize) {
    await pressEnter();
    r.tookIt = await page.evaluate(() => window.__ub.player.driving === window.__prize && window.__prize !== null);
  }
  r.carjack = await page.evaluate(() => {
    for (const off of window.__offs ?? []) off();
    return window.__cj;
  });
  races.push(r);
  console.log(JSON.stringify(r));
}

const vans = [];
for (let i = 0; i < opt.vans; i++) {
  const ok = await page.evaluate(
    ({ seed }) => {
      const u = window.__ub;
      window.__seed(seed);
      u.startGame();
      u.fastForward(5);
      const p = u.player;
      if (p.driving) p.exit();
      const ice = u.cityLife.scenes.find((s) => s.kind === 'iceCream');
      if (!ice.force()) return false;
      const van = ice.vans[ice.vans.length - 1];
      // Let the queue fill.
      u.fastForward(6);
      window.__van = van.v;
      window.__queued = van.queue.members.length;
      const s = van.v.sim;
      // At the driver's door (left of travel).
      p.ped.x = s.x + Math.cos(s.heading) * 1.7;
      p.ped.z = s.z - Math.sin(s.heading) * 1.7;
      u.fastForward(0.1);
      return true;
    },
    { seed: 200 + opt.seed + i },
  );
  if (!ok) {
    vans.push({ result: 'no van' });
    continue;
  }
  await pressEnter();
  const r = await page.evaluate(() => {
    const u = window.__ub;
    const p = u.player;
    const van = window.__van;
    const n = u.cityLife.vanNicked;
    const out = { queued: window.__queued, took: p.driving === van, handed: n.chasers.length, chase: -1, paid: false, stamp: null, closest: Infinity, allGone: -1, starsAtTake: u.heat.wanted.level, starsMax: 0, calls: 0 };
    const offs = [
      u.events.on('award', (e) => e.award.kind === 'vanNicked' && (out.paid = true)),
      u.events.on('stamp', (e) => (out.stamp = e.id)),
      u.events.on('street', (e) => e.what === 'witnessCall' && out.calls++),
    ];
    const ctl = { throttle: 0.55, steer: 0, handbrake: false, boost: false };
    window.__read ??= u.input.readVehicle;
    u.input.readVehicle = () => ctl;
    for (let t = 0; t < 30; t += 0.25) {
      u.fastForward(0.25);
      if (out.chase < 0 && n.chasing) {
        out.chase = t;
        u.stepFrame();
      }
      for (const ch of n.chasers) out.closest = Math.min(out.closest, Math.hypot(ch.c.agent.s.x - van.sim.x, ch.c.agent.s.z - van.sim.z));
      out.starsMax = Math.max(out.starsMax, u.heat.wanted.level);
      if (out.chase >= 0 && n.chasers.length === 0) {
        out.allGone = t;
        break;
      }
    }
    out.closest = Math.round(out.closest * 10) / 10;
    out.gaveUp = n.counts.gaveUp;
    u.input.readVehicle = window.__read;
    for (const off of offs) off();
    return out;
  });
  vans.push(r);
  console.log(JSON.stringify(r));
}

const won = races.filter((r) => r.result === 'won');
console.log(
  `\nraces: ${races.length} · joined ${races.filter((r) => r.joinedAt >= 0).length} · won ${won.length} · beaten ${races.filter((r) => r.result === 'beaten').length} · prize handed ${won.filter((r) => r.handed >= 0).length} · taken without a carjack ${won.filter((r) => r.tookIt && !r.carjack).length}`,
);
const took = vans.filter((r) => r.took);
console.log(
  `vans: ${vans.length} · taken ${took.length} · chased ${took.filter((r) => r.chase >= 0).length} · paid ${took.filter((r) => r.paid).length} · all gave up ${took.filter((r) => r.allGone >= 0).length} · chase stars above the carjack's ${took.filter((r) => r.starsMax > Math.max(1, r.starsAtTake)).length}`,
);
await browser.close();

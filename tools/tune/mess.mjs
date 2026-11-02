/**
 * Your Mess, Their Problem (V2-10): does the player's own crash become a
 * scene you can see? N seeded runs through the real game: a fresh run,
 * traffic left to fill in, then a car put in the lane behind a calm driver
 * 40–90 m from the spawn and driven flat out into its back by a bot. The
 * adopted crash is followed for 70 s: the driver out, the patrol on site,
 * the tow called, the DOMINO awards, and how long the driver stood at the
 * player's window (within 8 m: on screen, as the camera follows the player;
 * fastForward doesn't move the camera, so the view itself isn't asked).
 * --shots N: N more runs of the gunfire chain (a pistol shot by the player
 * on the bus, as combat sends it) on foot by a parked car: alarm, call,
 * patrol.
 *
 *   npx -y -p playwright@1.63.0 node tools/tune/mess.mjs [runs=8] [--shots 4] [--seed 1]
 */
import { args, openGame } from './lib.mjs';

const opt = args({ shots: 4, seed: 1 });
const RUNS = opt._[0] ?? 8;

const { browser, page } = await openGame();
await page.evaluate(() => window.__ub.startGame());

const crashes = [];
for (let i = 0; i < RUNS; i++) {
  const r = await page.evaluate(
    ({ seed }) => {
      const u = window.__ub;
      window.__seed(seed);
      u.startGame();
      u.fastForward(20);
      const p = u.player;
      const at = p.position;
      const acc = u.cityLife.accidents;
      // A calm driver on a straight, moving, 40–90 m off.
      const cand = u.vehicles.find((v) => {
        if (!v.ai || v.ai.mood !== 'calm' || v.scene || v.police || v.ambient || v.parked || v.ai.phase !== 'approach') return false;
        const d = Math.hypot(v.sim.x - at.x, v.sim.z - at.z);
        return d > 40 && d < 90 && Math.hypot(v.sim.vx, v.sim.vz) > 4 && ['sedan', 'compact', 'taxi', 'sports', 'muscle'].includes(v.archetype);
      });
      if (!cand) return { seed, result: 'no car' };
      const h = cand.sim.heading;
      const car = u.progress.spawnCar('muscle', 0x2266ff, cand.sim.x - Math.sin(h) * 14, cand.sim.z - Math.cos(h) * 14, h);
      car.sim.vx = cand.sim.vx + Math.sin(h) * 12;
      car.sim.vz = cand.sim.vz + Math.cos(h) * 12;
      u.progress.board(car);
      const ctl = { throttle: 1, steer: 0, handbrake: false, boost: false };
      window.__read ??= u.input.readVehicle;
      const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
      u.input.readVehicle = (s) => {
        s = s ?? p.driving?.sim;
        if (!s) return ctl;
        ctl.steer = Math.max(-1, Math.min(1, -wrap(Math.atan2(cand.sim.x - s.x, cand.sim.z - s.z) - s.heading) * 2.5));
        ctl.throttle = acc.mine.length ? 0 : 1;
        ctl.handbrake = acc.mine.length > 0;
        return ctl;
      };
      const out = { seed, result: 'missed', impact: 0, verdict: null, out: -1, patrol: -1, tow: -1, dominoes: [], near: 0 };
      const offs = [
        u.events.on('crash', (e) => {
          if (e.involvesPlayer && e.against === 'vehicle') out.impact = Math.max(out.impact, Math.round(e.impact * 10) / 10);
        }),
        u.events.on('award', (e) => {
          if (e.award.kind === 'domino') out.dominoes.push(e.award.label);
        }),
      ];
      for (let t = 0; t < 4 && !acc.mine.length; t += 0.1) u.fastForward(0.1);
      out.verdict = acc.verdict;
      const m = acc.mine[0];
      if (m) {
        out.result = 'adopted';
        for (let t = 0; t < 70; t += 0.25) {
          u.fastForward(0.25);
          if (out.out < 0 && m.driver) out.out = Math.round(t);
          if (out.patrol < 0 && m.phase === 'statement') out.patrol = Math.round(t);
          if (out.tow < 0 && m.towed) out.tow = Math.round(t);
          const d = m.driver?.agent.s;
          if (d && Math.hypot(d.x - p.position.x, d.z - p.position.z) < 8) out.near += 0.25;
          if (!acc.mine.includes(m)) break;
        }
      }
      u.input.readVehicle = window.__read;
      for (const off of offs) off();
      return out;
    },
    { seed: opt.seed + i },
  );
  crashes.push(r);
  console.log(JSON.stringify(r));
}

const shots = [];
for (let i = 0; i < opt.shots; i++) {
  const r = await page.evaluate(
    ({ seed }) => {
      const u = window.__ub;
      window.__seed(seed);
      u.startGame();
      u.fastForward(20);
      const p = u.player;
      if (p.driving) p.exit();
      const s = u.cityLife.shotsFired;
      // Stand beside a parked car with people about.
      const car = u.vehicles.find((v) => v.parked && v.mesh.root.visible && Math.hypot(v.sim.x - p.ped.x, v.sim.z - p.ped.z) < 120);
      if (car) Object.assign(p.ped, { x: car.sim.x + Math.cos(car.sim.heading) * 3, z: car.sim.z - Math.sin(car.sim.heading) * 3 });
      u.fastForward(3);
      const out = { seed, parked: !!car, links: [], dominoes: [], called: false, arrived: false };
      const offs = [
        u.events.on('domino', (e) => e.root === 'player' && out.links.push(`${e.what}×${e.depth}`)),
        u.events.on('award', (e) => e.award.kind === 'domino' && out.dominoes.push(e.award.label)),
      ];
      u.events.emit({ type: 'shot', x: p.ped.x, z: p.ped.z, dirX: 0, dirZ: 1, weapon: 'pistol', byPlayer: true });
      for (let t = 0; t < 60 && s.call; t += 0.25) u.fastForward(0.25);
      out.called = s.counts.called > 0;
      out.arrived = s.counts.arrived > 0;
      out.stars = u.heat.wanted.level;
      for (const off of offs) off();
      return out;
    },
    { seed: 100 + opt.seed + i },
  );
  shots.push(r);
  console.log(JSON.stringify(r));
}

const adopted = crashes.filter((r) => r.result === 'adopted');
console.log(
  `\ncrashes: ${crashes.length} · adopted ${adopted.length} · driver out ${adopted.filter((r) => r.out >= 0).length} · patrol ${adopted.filter((r) => r.patrol >= 0).length} · tow ${adopted.filter((r) => r.tow >= 0).length} · driver at your window in ${adopted.filter((r) => r.near > 0).length}`,
);
console.log(`shots: ${shots.length} · called ${shots.filter((r) => r.called).length} · patrol ${shots.filter((r) => r.arrived).length}`);
await browser.close();

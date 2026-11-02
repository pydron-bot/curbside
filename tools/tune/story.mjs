/**
 * Story harness: plays KEEP IT LOUD's jobs 4–6 through the real game, from
 * the payphone to the debrief, and says how each went. A bot drives (it
 * replaces input.readVehicle, as the Chaos Run bots do); the TEST tools jump
 * to the job and teleport across town between the parts that matter.
 *
 *   npx -y -p playwright@1.63.0 node tools/tune/story.mjs [--job s4|s5|s6|all] [--seed 1] [--shot dir]
 *
 * s4 NINETY-NINE PROBLEMS: a car near the Shift's truck, follow it until
 *   it's caught standing (a light, traffic) and lets Doreen's van go (after
 *   45 s, block it: the car put in its lane ahead); get in the van, drive
 *   the last stretch to Doreen; the van's health at the end.
 * s5 RIBBON CUTTING: a muscle car 60 m from the ribbon, ram the limo until
 *   it's wrecked (after 150 s, blow it up: said so).
 * s6 QUIETEST CITY: a muscle car by the coach; follow it for a lap of its
 *   tour (170 s: the crossings it takes, the race, fire and turf flare-up
 *   started on its route), then stay by it ramming the traffic round it;
 *   after 360 s any points short of 5,000 are added as awards beside the
 *   coach (said so: the real ones are counted). The police are kept off
 *   throughout (BUSTED ends any job; a bot doesn't run).
 * The seed is Math.random's; the game's own generators run off a fixed
 * clock, but timing still varies run to run.
 * Then PROGRESS: the main story's and the Night Shift's rows, each with a bar
 * (--shot saves the page as a screenshot).
 *
 * The dev server must be up (npm run dev); URL overrides the address.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { args, openGame } from './lib.mjs';

const opt = args({ job: 'all', seed: 1, shot: '' });
const JOBS = opt.job === 'all' ? ['s4', 's5', 's6'] : [opt.job];
const IDS = { s4: 's4-problems', s5: 's5-ribbon', s6: 's6-quietest' };

const { browser, page } = await openGame();
await page.evaluate((seed) => {
  window.__seed(seed);
  const u = window.__ub;
  u.startGame();
  u.fastForward(1);
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const ctl = { throttle: 0, steer: 0, handbrake: false, boost: false };
  // The bot: drive at `target` (stop within `stop` m of it), or with `ram` at the nearest car to hit.
  const bot = { target: null, stop: 0, ram: null, stuck: 0, backing: 0, last: u.simTime };
  u.input.readVehicle = (car) => {
    const me = u.player.driving;
    car = car ?? me?.sim;
    ctl.throttle = ctl.steer = 0;
    ctl.handbrake = ctl.boost = false;
    if (!car) return ctl;
    const dt = Math.min(0.1, Math.max(0, u.simTime - bot.last));
    bot.last = u.simTime;
    let t = bot.target;
    if (bot.ram) t = bot.ram();
    if (!t) {
      // Nothing to go for: stand still.
      ctl.throttle = Math.hypot(car.vx, car.vz) > 0.5 ? -1 : 0;
      return ctl;
    }
    const d = Math.hypot(t.x - car.x, t.z - car.z);
    const err = wrap(Math.atan2(t.x - car.x, t.z - car.z) - car.heading);
    const sp = Math.hypot(car.vx, car.vz);
    if (!bot.ram && d < bot.stop) {
      ctl.throttle = sp > 0.5 ? -1 : 0;
      return ctl;
    }
    bot.stuck = sp < 1.5 ? bot.stuck + dt : 0;
    if (bot.stuck > 1.5) {
      bot.backing = 1;
      bot.stuck = 0;
    }
    if (bot.backing > 0) {
      bot.backing -= dt;
      ctl.throttle = -1;
      ctl.steer = err > 0 ? 1 : -1;
      return ctl;
    }
    ctl.steer = Math.max(-1, Math.min(1, -err * 2.2));
    // Ease off near a stop.
    ctl.throttle = bot.ram ? 1 : Math.min(1, (d - bot.stop) / 25 + 0.2);
    ctl.handbrake = sp > 9 && Math.abs(err) > 1.1;
    ctl.boost = !!bot.ram && Math.abs(err) < 0.3;
    return ctl;
  };
  const mm = u.progress.missions;
  // Banners (MISSION FAILED and why), for the report.
  const banners = [];
  const banner = u.progress.ui.banner.bind(u.progress.ui);
  u.progress.ui.banner = (text, tone, sub, ...rest) => {
    if (tone === 'fail') banners.push(`${text}: ${sub}`);
    return banner(text, tone, sub, ...rest);
  };
  window.__story = {
    banners,
    bot,
    mm,
    car: (tag) => mm.cars.get(tag)?.v ?? null,
    /** The card up (a call or a debrief): its kicker, then CONTINUE / LET'S GO. */
    card() {
      const btn = document.querySelector('.dlg-ok');
      if (!btn || btn.closest('[hidden]')) return null;
      const kicker = document.querySelector('.dlg-card .prog-sub')?.textContent ?? '';
      btn.click();
      return kicker;
    },
    /** Jump to a job (the TEST tools), walk up to its ringing phone, answer, LET'S GO. */
    answer(id) {
      if (u.player.driving) u.player.exit();
      const said = u.testTools.jumpTo(id);
      const job = mm.missions.find((m) => m.id === id);
      const phone = u.testTools.phones.get(job.phone);
      Object.assign(u.player.ped, { x: phone.x + 20, z: phone.z, vx: 0, vz: 0 });
      u.fastForward(0.3);
      Object.assign(u.player.ped, { x: phone.x, z: phone.z, vx: 0, vz: 0 });
      u.fastForward(0.3);
      const kicker = this.card();
      u.fastForward(0.2);
      return { said, kicker, running: mm.running?.id ?? null, hour: u.look.time.hour, cars: [...mm.cars.keys()].join() };
    },
    /** A car of `archetype` for the player near (x, z). */
    carAt(x, z, archetype) {
      if (u.player.driving) u.player.exit();
      u.testTools.teleport(x, z);
      u.testTools.spawn(archetype);
      return u.player.driving !== null;
    },
  };
}, opt.seed);

const ff = (s) => page.evaluate((s) => window.__ub.fastForward(s), s);
const results = [];

for (const j of JOBS) {
  const id = IDS[j];
  const t0 = Date.now();
  const r = await page.evaluate((id) => window.__story.answer(id), id);
  console.log(`${id}: ${r.said} · call ${r.kicker} · running ${r.running} · ${r.hour.toFixed(1)}h · cars ${r.cars}`);
  let out;
  if (j === 's4') out = await s4();
  else if (j === 's5') out = await s5();
  else out = await s6();
  const end = await page.evaluate((id) => {
    const s = window.__story;
    const kicker = s.card();
    return { kicker, passed: window.__ub.progress.progress.data.missions.includes(id), running: s.mm.running?.id ?? null, failed: s.banners.splice(0).join(' / ') };
  }, id);
  results.push({ id, ...out, ...end, wall: ((Date.now() - t0) / 1000).toFixed(0) + ' s' });
  console.log(results.at(-1));
}

// PROGRESS: both arcs' rows, each with a bar.
const rows = await page.evaluate(() => {
  window.__ub.progress.openStats();
  return [...document.querySelectorAll('#progress .stat')].map((el) => ({ label: el.querySelector('span')?.textContent, value: el.querySelector('b')?.textContent, bar: !!el.querySelector('.stat-bar') }));
});
const arcs = rows.filter((r) => /^(Main story|Night Shift$)/.test(r.label ?? ''));
console.log('PROGRESS', arcs);
if (opt.shot) {
  mkdirSync(opt.shot, { recursive: true });
  await page.screenshot({ path: path.join(opt.shot, 'progress.png') });
}
const ok = results.every((r) => r.passed) && arcs.length === 2 && arcs.every((r) => r.bar);
console.log(ok ? 'ALL PASSED' : 'NOT ALL PASSED');
await browser.close();
process.exit(ok ? 0 : 1);

async function s4() {
  const start = await page.evaluate(() => {
    const s = window.__story;
    const truck = s.car('shifttow');
    const parked = truck.ai === null;
    s.trail = [];
    // Come at it from 80 m back down the kerb, in a car.
    const h = truck.sim.heading;
    s.carAt(truck.sim.x - Math.sin(h) * 80, truck.sim.z - Math.cos(h) * 80, 'sedan');
    return { parked };
  });
  let caught = null;
  let blocked = false;
  for (let t = 0; t < 120 && caught === null; t += 0.5) {
    caught = await page.evaluate(([t, blocked]) => {
      const s = window.__story;
      const u = window.__ub;
      const truck = s.car('shifttow');
      if (s.mm.hook === null) return t;
      if (blocked) {
        // Parked across its way: wait for it.
        u.fastForward(0.5);
        return null;
      }
      // A few metres off the van's back (it's on the hook, behind the truck): 17 m behind the truck.
      const h = truck.sim.heading;
      s.bot.target = { x: truck.sim.x - Math.sin(h) * 17, z: truck.sim.z - Math.cos(h) * 17 };
      s.bot.stop = 3;
      u.fastForward(0.5);
      const me = u.player.position;
      if (t % 5 === 0) s.trail.push(`${t}s ${Math.hypot(truck.sim.vx, truck.sim.vz).toFixed(1)}m/s ${Math.hypot(truck.sim.x - me.x, truck.sim.z - me.z).toFixed(0)}m`);
      return null;
    }, [t, blocked]);
    if (caught === null && t === 45 && !blocked) {
      blocked = true;
      // Never caught at a light: put the car in its lane ahead (it stops behind it).
      await page.evaluate(() => {
        const s = window.__story;
        const truck = s.car('shifttow');
        const h = truck.sim.heading;
        window.__ub.testTools.teleport(truck.sim.x + Math.sin(h) * 14, truck.sim.z + Math.cos(h) * 14);
        s.bot.target = null;
      });
    }
  }
  const mid = await page.evaluate(() => {
    const s = window.__story;
    const u = window.__ub;
    const van = s.car('doreenvan');
    if (!van) return { over: s.banners.join(' / ') };
    const woke = s.car('shifttow').ai !== null;
    s.bot.target = null;
    if (u.player.driving) u.player.exit();
    u.progress.board(van);
    u.fastForward(0.3);
    return { woke, step: s.mm.run?.index ?? null, health: van.damage.health / van.damage.maxHealth, trail: s.trail.join(' · ') };
  });
  // The last stretch to Doreen, driven.
  const drove = await page.evaluate(() => {
    const s = window.__story;
    const u = window.__ub;
    const home = s.mm.run?.step;
    if (!home || home.kind !== 'deliver') return 'not on the deliver step';
    u.testTools.teleport(home.x - 45, home.z);
    s.bot.target = { x: home.x, z: home.z };
    s.bot.stop = 2.5;
    for (let t = 0; t < 40 && s.mm.running; t += 0.25) u.fastForward(0.25);
    return s.mm.running ? 'still running' : 'done';
  });
  const health = await page.evaluate(() => {
    const v = window.__ub.player.driving;
    return v ? +(v.damage.health / v.damage.maxHealth).toFixed(3) : null;
  });
  return { ...start, caughtAfter: caught, blocked, ...mid, drove, vanHealth: health };
}

async function s5() {
  const start = await page.evaluate(() => {
    const s = window.__story;
    const limo = s.car('lulllimo');
    const parked = limo.ai === null;
    const inCar = s.carAt(limo.sim.x - 60, limo.sim.z, 'muscle');
    s.bot.target = null;
    s.bot.ram = () => {
      const l = s.car('lulllimo');
      return l && !l.damage.wrecked ? l.sim : null;
    };
    return { parked, inCar };
  });
  let t = 0;
  let woke = false;
  const trail = [];
  for (; t < 150; t += 1) {
    const st = await page.evaluate(() => {
      const s = window.__story;
      const u = window.__ub;
      u.fastForward(1);
      // A bot doesn't run from the police: keep them off (BUSTED ends any job).
      if (u.heat.wanted.level > 0) u.testTools.clearWanted();
      const l = s.car('lulllimo');
      const me = u.player.position;
      return { running: s.mm.running !== null, woke: l ? l.ai !== null : true, health: l ? Math.round(l.damage.health) : null, far: l ? Math.round(Math.hypot(l.sim.x - me.x, l.sim.z - me.z)) : null, car: u.player.driving?.archetype ?? 'on foot' };
    });
    if (t % 10 === 0) trail.push(`${t}s ${st.health}hp ${st.far}m ${st.car}`);
    woke ||= st.woke;
    if (!st.running) break;
  }
  const blown = t >= 150;
  if (blown) await page.evaluate(() => window.__ub.explode(window.__story.car('lulllimo')));
  await page.evaluate(() => {
    window.__story.bot.ram = null;
    window.__ub.fastForward(3);
  });
  return { ...start, woke, rammedFor: `${t} s`, blownUp: blown, limo: trail.join(' · ') };
}

async function s6() {
  await page.evaluate(() => {
    const s = window.__story;
    const u = window.__ub;
    const coach = s.car('coach');
    s.carAt(coach.sim.x, coach.sim.z + 40, 'muscle');
    // Real points: a car ever on the scoreboard while near the coach.
    s.real = 0;
    u.events.on('award', (e) => {
      if (s.mm.running?.id === 's6-quietest') s.real += e.award.points;
    });
    s.featured = new Set();
    // What the street saw while the job ran (a race, a fire, a turf flare-up...).
    s.street = new Set();
    u.events.on('street', (e) => {
      if (s.mm.running?.id === 's6-quietest') s.street.add(e.what);
    });
    s.crossings = [];
  });
  let st = null;
  let at = null;
  for (let t = 0; t < 360; t += 1) {
    // First a lap of the tour just following (the scenes start along it), then the mayhem.
    const ram = t >= 170;
    st = await page.evaluate((ram) => {
      const s = window.__story;
      const u = window.__ub;
      const coach = s.car('coach');
      const c = s.mm.cars.get('coach');
      const me = u.player.position;
      const far = Math.hypot(coach.sim.x - me.x, coach.sim.z - me.z);
      // Stay with it; near it, hit whatever's round it (not the coach).
      s.bot.ram = null;
      s.bot.target = { x: coach.sim.x, z: coach.sim.z };
      s.bot.stop = 18;
      if (ram && far < 60) {
        let best = null;
        let bd = 40;
        for (const v of u.vehicles) {
          if (v === coach || v === u.player.driving || v.damage.wrecked || !v.mesh.root.visible) continue;
          const d = Math.hypot(v.sim.x - coach.sim.x, v.sim.z - coach.sim.z);
          if (d < bd) {
            bd = d;
            best = v;
          }
        }
        if (best) s.bot.ram = () => (best.damage.wrecked ? null : best.sim);
      }
      // Way off (stuck behind something): back beside it.
      if (far > 110) u.testTools.teleport(coach.sim.x + 25, coach.sim.z);
      // Out of the car (wrecked, thrown out): another.
      if (!u.player.driving && u.player.alive) s.carAt(coach.sim.x + 25, coach.sim.z, 'muscle');
      u.fastForward(1);
      if (u.heat.wanted.level > 0) u.testTools.clearWanted();
      if (u.cityLife.featured) s.featured.add(u.cityLife.featured);
      const ai = coach.ai;
      if (ai) {
        const key = `${ai.ix},${ai.iz}`;
        if (s.crossings.at(-1) !== key) s.crossings.push(key);
      }
      return { running: s.mm.running !== null, mayhem: s.mm.run?.mayhem ?? null, real: s.real, leg: c?.leg, pending: s.mm.scenes.pending.length, far: Math.round(far), car: u.player.driving?.archetype ?? 'on foot' };
    }, ram);
    if (!st.running) {
      at = t;
      break;
    }
    if (t === 169 || t === 260) console.log(`  ${t} s: ${JSON.stringify(st)}`);
  }
  const topped = st.running ? 5000 - (st.mayhem ?? 0) : 0;
  if (st.running)
    await page.evaluate((pts) => {
      const s = window.__story;
      const u = window.__ub;
      const coach = s.car('coach');
      if (u.player.driving) u.testTools.teleport(coach.sim.x + 20, coach.sim.z);
      u.events.emit({ type: 'award', award: { kind: 'boom', label: 'HARNESS', points: pts, multiplier: 1 } });
      u.fastForward(0.2);
    }, topped);
  const tour = await page.evaluate(() => {
    const s = window.__story;
    s.bot.ram = null;
    s.bot.target = null;
    return { featured: [...s.featured], street: [...s.street].join(' '), crossings: s.crossings.join(' ') };
  });
  return { endedAt: at === null ? null : `${at} s`, counted: st.mayhem, realPoints: st.real, toppedUp: topped, scenesLeft: st.pending, ...tour };
}

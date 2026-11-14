// node tools/look/lookSheet.mjs <outdir> [--port 5351] [--only name] [--tag BEFORE] [--set key=value ...]
//
// The V3 look sheet: a fixed set of views at the phone profile (852×393,
// iPhone 15 Pro landscape), one PNG each plus `sheet.png` (all of them,
// labelled) and `metrics.json`. Per view, worked out from the camera and the
// city data (not by eye): the player's size on screen (CSS px across the
// bounding box of a standing person at the player's spot, at the drawn
// people scale) and the share of the frame that is roof (a grid of rays
// through the screen against every building box). Also draw calls and
// programs. A veteran save (no cold open) and time frozen.
// `--set peopleScale=1.35` sets LOOK sliders (live values, not saved).
import { createRequire } from 'module';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
const pw = createRequire(import.meta.url)('playwright');

const argv = process.argv.slice(2);
const dir = argv[0];
if (!dir) throw new Error('usage: lookSheet.mjs <outdir> [--port N] [--only name] [--tag TEXT] [--set key=value]');
const flag = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i > 0 ? argv[i + 1] : def;
};
const PORT = Number(flag('port', 5351));
const ONLY = flag('only', '');
const TAG = flag('tag', '');
/** Tint what the roof metric counts (roof pink, wall cyan) on the sheet's pictures. */
const MASK = argv.includes('--mask');
const SETS = argv.flatMap((a, i) => (a === '--set' ? [argv[i + 1]] : [])).map((s) => s.split('=')).map(([k, v]) => [k, Number(v)]);
mkdirSync(dir, { recursive: true });

const SPAWN = null;
const DOWNTOWN = [0, 8];
const NEON = [224, -248];
const DAY = 13;
const DUSK = 18.7;
const NIGHT = 22;

/**
 * [name, label, setup]: setup runs in the page with (ctx) where ctx.at is a
 * spot (null: the spawn), and returns seconds to fast-forward. On-foot views
 * come first; `car` gets the player into a sports car for the rest.
 */
const VIEWS = [
  ['foot-day', 'On foot, Neon Mile, 13:00', { at: NEON, hour: DAY }],
  ['foot-night', 'On foot, Neon Mile, 22:00', { at: NEON, hour: NIGHT }],
  ['garden-day', 'On foot by a roof garden, 13:00', { at: SPAWN, hour: DAY, garden: true }],
  ['hostile-day', 'On foot, 2 stars and three armed locals, 13:00', { at: DOWNTOWN, hour: DAY, wanted: 2, ff: 5, hostile: 3 }],
  ['spawn-day', 'Car, spawn, 13:00', { at: SPAWN, hour: DAY, car: true }],
  ['spawn-dusk', 'Car, spawn, 18:42', { at: SPAWN, hour: DUSK }],
  ['spawn-night', 'Car, spawn, 22:00', { at: SPAWN, hour: NIGHT }],
  ['downtown-day', 'Car, downtown (0, 8), 13:00', { at: DOWNTOWN, hour: DAY }],
  ['downtown-dusk', 'Car, downtown, 18:42', { at: DOWNTOWN, hour: DUSK }],
  ['downtown-night', 'Car, downtown, 22:00', { at: DOWNTOWN, hour: NIGHT }],
  ['neon-day', 'Car, Neon Mile (224, -248), 13:00', { at: NEON, hour: DAY }],
  ['neon-dusk', 'Car, Neon Mile, 18:42', { at: NEON, hour: DUSK }],
  ['neon-night', 'Car, Neon Mile, 22:00', { at: NEON, hour: NIGHT }],
  ['rain', 'Car, downtown, rain, 13:00', { at: DOWNTOWN, hour: DAY, rain: true, ff: 6 }],
  ['blast', 'Car, a car blown up ahead, Neon Mile, 21:00', { at: NEON, hour: 21, blast: true }],
  ['chase-night', 'Car, 4-star chase, spawn, 22:00', { at: SPAWN, hour: NIGHT, wanted: 4, ff: 9 }],
];

const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ ...pw.devices['iPhone 15 Pro landscape'], viewport: { width: 852, height: 393 }, serviceWorkers: 'block' });
await ctx.addInitScript(() => {
  localStorage.setItem('curbside.settings', JSON.stringify({ testTools: true }));
  // A veteran: the cold open has run, side modes open.
  localStorage.setItem('curbside.save', JSON.stringify({ v: 1, opening: true, unlocks: ['sideModes'] }));
});
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('ERR', String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 300));
});
await page.goto(`http://localhost:${PORT}/?renderScale=0.5`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ub, null, { timeout: 180000 });
await page.evaluate(() => window.__ub.startGame());
await page.waitForFunction(() => window.__ub.look.props.loaded, null, { timeout: 180000 });
const spawn = await page.evaluate((sets) => {
  const u = window.__ub;
  for (const [k, v] of sets) if (k in u.lookTuning.look) u.lookTuning.set(k, v);
  u.testTools.god(); // nobody dies mid-sheet
  u.fastForward(3);
  const p = u.player.position;
  return [p.x, p.z];
}, SETS);
console.log(`spawn at (${spawn[0].toFixed(1)}, ${spawn[1].toFixed(1)})`);

const results = [];
let inCar = false;
for (const [name, label, v] of VIEWS) {
  const skip = ONLY && !name.includes(ONLY);
  if (v.car && !inCar) {
    await page.evaluate(([x, z]) => {
      const u = window.__ub;
      u.testTools.clearWanted();
      // The hostile view's gunmen go back to their day.
      for (const c of u.population.crowd) if (c.agent.role === 'civilian' && (c.agent.mode === 'shoot' || c.agent.mode === 'fight')) Object.assign(c.agent, { temper: 'calm', mode: 'walk', provoked: false });
      u.testTools.teleport(x, z);
      u.fastForward(0.5);
      u.testTools.spawn('sports');
    }, spawn);
    inCar = true;
  }
  if (skip) continue;
  const at = v.at ?? spawn;
  await page.evaluate(([x, z, v]) => {
    const u = window.__ub;
    u.testTools.clearWanted();
    u.testTools.setRain(v.rain ? 'on' : 'off');
    if (v.garden) {
      // The biggest low roof garden within 150 m of the spawn: stand on the pavement west of it.
      let best = null;
      u.look.plans.forEach((pl, i) => {
        const b = u.city.buildings[i];
        const area = (b.maxX - b.minX) * (b.maxZ - b.minZ);
        const d = Math.hypot((b.minX + b.maxX) / 2 - x, (b.minZ + b.maxZ) / 2 - z);
        if (pl.roof === 'garden' && b.height < 20 && d < 150 && (!best || area > best.area)) best = { b, area };
      });
      if (best) {
        x = best.b.minX - 3;
        z = (best.b.minZ + best.b.maxZ) / 2;
      }
    }
    u.testTools.teleport(x, z);
    u.testTools.setHour(v.hour, 'x');
    u.look.time.speed = 0;
    u.fastForward(1.5);
    if (v.wanted) u.testTools.wanted(v.wanted);
    u.fastForward(v.ff ?? 0.3);
    if (v.hostile) {
      // The nearest locals draw on the player.
      const p = u.player.position;
      const near = u.population.crowd.filter((c) => c.agent.role === 'civilian' && c.agent.mode !== 'down').sort((a, b) => (a.agent.s.x - p.x) ** 2 + (a.agent.s.z - p.z) ** 2 - ((b.agent.s.x - p.x) ** 2 + (b.agent.s.z - p.z) ** 2));
      near.slice(0, v.hostile).forEach((c, i) => {
        // Brought in round the player (the crowd keeps to off-screen pavements), then they draw.
        const a = (i / v.hostile) * Math.PI * 2 + 0.6;
        Object.assign(c.agent.s, { x: p.x + Math.cos(a) * 7, z: p.z + Math.sin(a) * 5, vx: 0, vz: 0 });
        Object.assign(c.prev, c.agent.s);
        Object.assign(c.agent, { temper: 'armed', mode: 'shoot', provoked: true, timer: 30 });
      });
      u.fastForward(0.6);
    }
    // The camera settled at its resting height (it eases over seconds of real time, ~1 fps here).
    const p0 = u.player.position;
    u.rig.snapTo(p0.x, p0.z, u.rig.opts.minHeight);
    u.fastForward(0.1);
    if (v.blast) {
      // The nearest car in reach goes up, and a blast beside the player; shot at once (the fireball is short).
      const p = u.player.position;
      const car = u.vehicles.filter((c) => c !== u.player.driving && c.mesh?.root?.visible && !c.damage.wrecked && Math.hypot(c.sim.x - p.x, c.sim.z - p.z) < 20)[0];
      if (car) u.explode(car);
      u.effects.explode(p.x + 8, p.z - 4);
    }
  }, [at[0], at[1], v]);
  await page.waitForTimeout(v.blast ? 150 : 2500);
  const file = path.join(dir, `${name}.png`);
  await page.screenshot({ path: file, scale: 'css', timeout: 180000 });
  const m = await page.evaluate(measure);
  const row = { name, label, ...m };
  if (!MASK) delete row.grid;
  results.push(row);
  console.log(`${name.padEnd(15)} hostile ${m.hostiles} h ${m.height} wall ${m.wallPct}% player ${String(m.playerPx).padStart(3)} px  roof ${String(m.roofPct).padStart(3)}%  calls ${m.calls}  programs ${m.programs}  ${m.tier}`);
}
await ctx.close();
writeFileSync(path.join(dir, 'metrics.json'), JSON.stringify({ tag: TAG, sets: Object.fromEntries(SETS), views: results.map(({ grid, ...r }) => r) }, null, 2));

// The sheet: three across, a label bar under each.
const COLS = 3;
const W = 852;
const H = 393;
const BAR = 26;
const sheet = await browser.newPage({ viewport: { width: 400, height: 300 } });
const cells = results.map((r) => ({ ...r, src: `data:image/png;base64,${readFileSync(path.join(dir, `${r.name}.png`)).toString('base64')}` }));
const png = await sheet.evaluate(
  async ({ cells, COLS, W, H, BAR, TAG, MASK }) => {
    const rows = Math.ceil(cells.length / COLS);
    const top = TAG ? 40 : 0;
    const c = document.createElement('canvas');
    c.width = COLS * W;
    c.height = top + rows * (H + BAR);
    const g = c.getContext('2d');
    g.fillStyle = '#111';
    g.fillRect(0, 0, c.width, c.height);
    if (TAG) {
      g.fillStyle = '#fff';
      g.font = 'bold 26px sans-serif';
      g.fillText(TAG, 12, 29);
    }
    for (let i = 0; i < cells.length; i++) {
      const r = cells[i];
      const img = new Image();
      img.src = r.src;
      await img.decode();
      const x = (i % COLS) * W;
      const y = top + Math.floor(i / COLS) * (H + BAR);
      g.drawImage(img, x, y, W, H);
      if (MASK && r.grid) {
        const cw = W / r.gx;
        const chh = H / r.gy;
        for (let k = 0; k < r.grid.length; k++) {
          const t = r.grid[k];
          if (t === '.') continue;
          g.fillStyle = t === 'r' ? 'rgba(255,0,160,0.35)' : 'rgba(0,220,255,0.35)';
          g.fillRect(x + (k % r.gx) * cw, y + Math.floor(k / r.gx) * chh, cw, chh);
        }
      }
      g.fillStyle = '#fff';
      g.font = 'bold 15px sans-serif';
      g.fillText(r.label, x + 8, y + H + 18);
      g.fillStyle = '#ffd34d';
      const stats = `player ${r.playerPx} px · roof ${r.roofPct}% · ${r.calls} calls · ${r.programs} prog`;
      g.fillText(stats, x + W - 8 - g.measureText(stats).width, y + H + 18);
    }
    return c.toDataURL('image/png');
  },
  { cells, COLS, W, H, BAR, TAG, MASK },
);
writeFileSync(path.join(dir, 'sheet.png'), Buffer.from(png.split(',')[1], 'base64'));
await browser.close();
console.log(`sheet: ${path.join(dir, 'sheet.png')}`);

/** In the page: the numbers for the view now on screen. */
function measure() {
  const u = window.__ub;
  const cam = u.rig.camera;
  cam.updateMatrixWorld();
  const V = cam.position.constructor;
  const canvas = u.renderer.domElement;
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  // The player as a standing person: a box 0.55 m across, 0.32 m deep, 1.75 m tall, at the drawn scale.
  const s = u.lookTuning?.look?.peopleScale ?? 1;
  const p = u.player.position;
  const heading = u.player.driving ? u.player.driving.sim.heading : u.player.ped.heading;
  const ca = Math.cos(heading);
  const sa = Math.sin(heading);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const q = new V();
  for (const ax of [-0.275, 0.275])
    for (const az of [-0.16, 0.16])
      for (const ay of [0, 1.75]) {
        const lx = ax * s;
        const lz = az * s;
        q.set(p.x + lx * ca + lz * sa, ay * s, p.z - lx * sa + lz * ca).project(cam);
        const sx = ((q.x + 1) / 2) * cw;
        const sy = ((1 - q.y) / 2) * ch;
        minX = Math.min(minX, sx);
        maxX = Math.max(maxX, sx);
        minY = Math.min(minY, sy);
        maxY = Math.max(maxY, sy);
      }
  const playerPx = Math.round(Math.max(maxX - minX, maxY - minY));

  // Roof share: rays through a grid of the screen, first hit against every building box near the view.
  const view = u.rig.visibleGround({ minX: 0, minZ: 0, maxX: 0, maxZ: 0 });
  const near = u.city.buildings.filter((b) => b.maxX > view.minX - 40 && b.minX < view.maxX + 40 && b.maxZ > view.minZ - 40 && b.minZ < view.maxZ + 40);
  const o = cam.position;
  const d = new V();
  const GX = 107;
  const GY = 49;
  let roof = 0;
  let grid = '';
  let wall = 0;
  for (let j = 0; j < GY; j++) {
    for (let i = 0; i < GX; i++) {
      d.set(((i + 0.5) / GX) * 2 - 1, 1 - ((j + 0.5) / GY) * 2, 0.5).unproject(cam).sub(o).normalize();
      let best = d.y < 0 ? -o.y / d.y : Infinity;
      let kind = 0;
      for (const b of near) {
        // Slab test; which slab we entered through says roof (y) or wall.
        let t0 = -Infinity;
        let t1 = Infinity;
        let enter = 0;
        const slabs = [
          [o.x, d.x, b.minX, b.maxX, 1],
          [o.y, d.y, 0, b.height, 2],
          [o.z, d.z, b.minZ, b.maxZ, 1],
        ];
        let miss = false;
        for (const [oo, dd, lo, hi, k] of slabs) {
          if (Math.abs(dd) < 1e-9) {
            if (oo < lo || oo > hi) miss = true;
            continue;
          }
          let a = (lo - oo) / dd;
          let c = (hi - oo) / dd;
          if (a > c) [a, c] = [c, a];
          if (a > t0) {
            t0 = a;
            enter = k;
          }
          if (c < t1) t1 = c;
        }
        if (miss || t0 > t1 || t0 < 0 || t0 >= best) continue;
        best = t0;
        kind = enter;
      }
      grid += kind === 2 ? 'r' : kind === 1 ? 'w' : '.';
      if (kind === 2) roof++;
      else if (kind === 1) wall++;
    }
  }
  const info = u.renderer.info;
  return {
    playerPx,
    roofPct: Math.round((100 * roof) / (GX * GY)),
    wallPct: Math.round((100 * wall) / (GX * GY)),
    height: Math.round(u.rig.currentHeight * 10) / 10,
    calls: info.render.calls,
    programs: info.programs.length,
    tier: u.resolution?.tier ?? u.resolution?.quality ?? '',
    driving: !!u.player.driving,
    hostiles: u.population.crowd.filter((c) => c.model.hostile > 0 && c.model.root.visible).length,
    peopleScale: s,
    grid,
    gx: GX,
    gy: GY,
  };
}

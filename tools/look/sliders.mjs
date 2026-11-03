// node sliders.mjs <outdir> <phone|desktop> [key ...]
// Every LOOK slider pushed to its ends at a spot and hour where it shows:
// prints how much of the picture each changed, against the frame-to-frame
// change with nothing moved (animation, traffic), and checks no program
// compiled while they moved. Saves the low/high pairs in <outdir>.
import { createRequire } from 'module';
import { mkdirSync } from 'fs';
const pw = createRequire(import.meta.url)('playwright');
const [outDir, prof, ...only] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const phone = prof === 'phone';

// Where and when each group shows. arts (224, -248), downtown (0, 8).
const NIGHT = { x: 224, z: -248, h: 22 };
const DOWNTOWN_NIGHT = { x: 0, z: 8, h: 22 };
const NOON = { x: 224, z: -248, h: 12.5 };
const PLACES = {
  sky: { nightBrightness: NIGHT, moonlight: NIGHT, nightFill: NIGHT, nightHue: NIGHT, dawnBrightness: { ...NOON, h: 6.2 }, dawnWarmth: { ...NOON, h: 6.4 }, dayBrightness: NOON, sunlight: NOON, skyBlue: NOON, goldenBrightness: { ...NOON, h: 18.2 }, goldenWarmth: { ...NOON, h: 18.2 }, sunsetPink: { ...NOON, h: 19.6 }, sunsetColour: { ...NOON, h: 19.6 }, duskBrightness: { ...NOON, h: 19.9 }, dayHaze: NOON, nightHaze: NIGHT, shadowDarkness: NOON, carShine: NOON },
  grade: { exposure: NOON, saturation: NOON, darkSaturation: NIGHT, violetShadows: NIGHT, roseHighlights: NOON, pinkMids: NOON, contrast: NOON },
  night: { neon: NIGHT, neonHalos: NIGHT, windows: DOWNTOWN_NIGHT, lamps: NIGHT, lampWhite: NIGHT, wetSheen: NIGHT, neonReflect: NIGHT, headlights: { ...NIGHT, car: true }, underglow: { ...NIGHT, car: true }, searchlights: DOWNTOWN_NIGHT, steam: NIGHT, sirenWash: { ...NIGHT, car: true, sirens: true }, bloom: NIGHT },
  day: { cloudShadow: { ...NOON, preset: { cloudCover: 2 } }, cloudCover: NOON, flyerShadow: { ...NOON, flyer: true }, glints: { ...NOON, h: 16 }, treeSway: { ...NOON, park: true }, dapple: { ...NOON, park: true }, fountains: { ...NOON, fountain: true }, sprinklers: { ...NOON, sprinkler: true }, rainbow: { ...NOON, fountain: true }, mist: { ...NOON, h: 6.4, mistSpot: true }, mistSpread: { ...NOON, h: 6.4 }, gullSize: { ...NOON, gull: true }, streetArt: NOON, billboards: { x: 0, z: 8, h: 12.5 } },
};

const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctxOpt = phone ? { ...pw.devices['iPhone 15 Pro landscape'], viewport: { width: 852, height: 393 }, deviceScaleFactor: 1 } : { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 };
const ctx = await browser.newContext({ ...ctxOpt, serviceWorkers: 'block' });
await ctx.addInitScript(() => {
  localStorage.setItem('curbside.settings', JSON.stringify({ testTools: true }));
  localStorage.removeItem('curbside.look');
});
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('ERR', String(e)));
page.on('console', (m) => {
  if (m.type() === 'error' || /shader|program/i.test(m.text())) console.log('CONSOLE', m.text().slice(0, 400));
});
await page.goto(`http://localhost:5343/?renderScale=0.5`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ub, null, { timeout: 180000 });
await page.evaluate(() => window.__ub.startGame());
await page.waitForFunction(() => window.__ub.look.props.loaded, null, { timeout: 180000 });
await page.evaluate(() => window.__ub.fastForward(2));

/** Mean absolute difference of two PNG screenshots, 0..255, in the page (hiding the HUD isn't needed: it's the same in both). */
async function diff(a, b) {
  return page.evaluate(
    async ([a, b]) => {
      const load = async (s) => {
        const img = new Image();
        img.src = `data:image/png;base64,${s}`;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        return g.getImageData(0, 0, c.width, c.height).data;
      };
      const [x, y] = await Promise.all([load(a), load(b)]);
      let s = 0;
      for (let i = 0; i < x.length; i += 4) s += Math.abs(x[i] - y[i]) + Math.abs(x[i + 1] - y[i + 1]) + Math.abs(x[i + 2] - y[i + 2]);
      return s / (x.length / 4) / 3;
    },
    [a.toString('base64'), b.toString('base64')],
  );
}

async function place(p) {
  await page.evaluate((p) => {
    const u = window.__ub;
    u.testTools.setRain('off');
    let { x, z } = p;
    if (p.fountain && u.parkWater?.fountains?.length) ({ x, z } = u.parkWater.fountains[0]);
    if (p.sprinkler && u.parkWater?.sprinklers?.length) ({ x, z } = u.parkWater.sprinklers[0]);
    if (p.gull && u.gulls?.gulls?.length) ({ cx: x, cz: z } = u.gulls.gulls[0]);
    if (p.park && u.parkWater?.sprinklers?.length) ({ x, z } = u.parkWater.sprinklers[0]);
    u.testTools.teleport(x, z);
    if (p.car) {
      u.testTools.getIn = true;
      u.testTools.spawn('sports');
    }
    u.testTools.holdClock(p.h);
    u.fastForward(2);
    if (p.sirens) {
      const pl = u.player.ped;
      const vs = u.vehicles.filter((v) => v.mesh?.root?.visible).sort((a, b) => (a.sim.x - pl.x) ** 2 + (a.sim.z - pl.z) ** 2 - ((b.sim.x - pl.x) ** 2 + (b.sim.z - pl.z) ** 2));
      for (const v of vs.slice(0, 3)) v.mesh.siren = true;
      if (u.player.driving) u.player.driving.mesh.siren = true;
    }
  }, p);
  await page.waitForTimeout(800);
}

let flyer = false;
const shot = async () => {
  // A plane crosses in seconds: put it back over the player for each shot.
  if (flyer) await page.evaluate(() => {
    const u = window.__ub;
    const pl = u.player.position;
    u.look.flyovers.sendNow('plane', pl.x, pl.z, 0.6, 0);
  });
  await page.waitForTimeout(500);
  return page.screenshot({ timeout: 180000 });
};

const programsAt = () => page.evaluate(() => window.__ub.renderer.info.programs.length);
let lastPlace = '';
const rows = [];
const programs0 = await programsAt();
for (const [, keys] of Object.entries(PLACES)) {
  for (const [key, p] of Object.entries(keys)) {
    if (only.length && !only.includes(key)) continue;
    const tag = JSON.stringify(p);
    if (tag !== lastPlace) {
      await place(p);
      lastPlace = tag;
    }
    flyer = !!p.flyer;
    if (p.preset) await page.evaluate((pre) => Object.entries(pre).forEach(([k, v]) => window.__ub.lookTuning.set(k, v)), p.preset);
    const range = await page.evaluate((key) => {
      const s = window.__ub.lookTuning;
      const spec = window.__ub.lookSpecs.find((x) => x.key === key);
      return [spec.min, spec.max, s.shipped[key]];
    }, key);
    const base = await shot();
    const again = await shot();
    await page.evaluate(([k, v]) => window.__ub.lookTuning.set(k, v), [key, range[0]]);
    const lo = await shot();
    await page.evaluate(([k, v]) => window.__ub.lookTuning.set(k, v), [key, range[1]]);
    const hi = await shot();
    await page.evaluate((k) => window.__ub.lookTuning.reset(k), key);
    if (p.preset) await page.evaluate((pre) => Object.keys(pre).forEach((k) => window.__ub.lookTuning.reset(k)), p.preset);
    const noise = await diff(base, again);
    const dLo = await diff(base, lo);
    const dHi = await diff(base, hi);
    const { writeFileSync } = await import('fs');
    writeFileSync(`${outDir}/${key}-lo.png`, lo);
    writeFileSync(`${outDir}/${key}-hi.png`, hi);
    writeFileSync(`${outDir}/${key}-base.png`, base);
    const ok = Math.max(dLo, dHi) > noise * 1.5 + 0.05;
    rows.push([key, noise, dLo, dHi, ok]);
    console.log(`${ok ? 'ok  ' : 'FLAT'} ${key.padEnd(18)} noise ${noise.toFixed(2)}  low ${dLo.toFixed(2)}  high ${dHi.toFixed(2)}`);
  }
}
const programs1 = await programsAt();
console.log(`programs ${programs0} -> ${programs1}${programs1 > programs0 ? '  (COMPILED WHILE TUNING)' : ''}`);
console.log('calls', await page.evaluate(() => window.__ub.renderer.info.render.calls));
await browser.close();

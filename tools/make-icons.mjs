// Renders the PWA icons from the game itself: the player's car from above at
// night, inside its marker ring, on a seeded city (so a rerun after an art
// change frames the same street). Needs the dev server (npm run dev) and
// Playwright, as the tuning harnesses do:
//   npx -y -p playwright@1.63.0 node tools/make-icons.mjs
// URL overrides the address (tools/tune/lib.mjs).
import { writeFileSync } from 'node:fs';
import { URL as GAME, launch } from './tune/lib.mjs';

const OUT = new URL('../public/icons/', import.meta.url);
/** Night, and camera heights for the regular and the maskable art (maskable keeps the car well inside the 80% safe circle). */
const HOUR = 22;
const HEIGHT = 12;
const MASKABLE_HEIGHT = 16;

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
page.on('pageerror', (e) => console.error('pageerror:', e.message));
await page.addInitScript(() => {
  // Seeded like the harnesses, but real frames keep running (the game must draw).
  let s = 1;
  Math.random = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const t0 = Date.UTC(2026, 0, 1);
  Date.now = () => t0;
});
await page.goto(GAME);
await page.waitForFunction(() => window.__ub, null, { timeout: 60000 });
await page.waitForTimeout(2000);
await page.evaluate(() => window.__ub.startGame());
await page.waitForTimeout(2500);

// Into the parked car at the spawn: stand at its door and press enter.
const car = await page.evaluate(() => {
  const ub = window.__ub;
  const v = ub.vehicles.find((v) => !v.ai && !v.pursuit && !v.damage.wrecked && Math.hypot(v.sim.vx, v.sim.vz) < 0.5);
  if (!v) return null;
  ub.player.ped.x = v.sim.x + Math.cos(v.sim.heading) * 1.6;
  ub.player.ped.z = v.sim.z - Math.sin(v.sim.heading) * 1.6;
  return v.archetype;
});
await page.waitForTimeout(300);
await page.keyboard.press('KeyE');
await page.waitForTimeout(2000);
if (!car || !(await page.evaluate(() => !!window.__ub.player.driving))) throw new Error('could not get into a parked car');

// Only the game canvas: no HUD, radar or touch controls.
await page.evaluate(() => (window.__ub.renderer.domElement.id = 'icon-canvas'));
await page.addStyleTag({ content: 'body * { visibility: hidden !important; } #icon-canvas { visibility: visible !important; }' });

async function shot(height) {
  await page.evaluate(
    ([hour, h]) => {
      const ub = window.__ub;
      clearInterval(window.__iconHold);
      window.__iconHold = setInterval(() => (ub.look.time.hour = hour), 16);
      ub.rig.setHeights(h, h);
    },
    [HOUR, height],
  );
  // The camera eases to a new height over a few seconds.
  await page.waitForTimeout(7000);
  return (await page.screenshot()).toString('base64');
}

/** The square screenshot scaled to `size` px in the browser (smooth downscale), as PNG bytes. */
async function scaled(b64, size) {
  const url = await page.evaluate(
    async ([b64, size]) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      // Halve in steps so a 900 → 180 downscale stays smooth.
      let src = img;
      let w = img.width;
      while (w / 2 >= size) {
        const c = document.createElement('canvas');
        c.width = c.height = (w = Math.round(w / 2));
        const g = c.getContext('2d');
        g.imageSmoothingQuality = 'high';
        g.drawImage(src, 0, 0, w, w);
        src = c;
      }
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(src, 0, 0, size, size);
      return c.toDataURL('image/png');
    },
    [b64, size],
  );
  return Buffer.from(url.split(',')[1], 'base64');
}

const regular = await shot(HEIGHT);
const maskable = await shot(MASKABLE_HEIGHT);
for (const [name, b64, size] of [
  ['icon-512.png', regular, 512],
  ['icon-192.png', regular, 192],
  ['apple-touch-icon.png', regular, 180],
  ['favicon-32.png', regular, 32],
  ['icon-maskable-512.png', maskable, 512],
]) {
  writeFileSync(new URL(name, OUT), await scaled(b64, size));
  console.log('wrote', name);
}
await browser.close();

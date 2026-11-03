// node obs.mjs <outprefix> name:x:z:height:hour ...
import { createRequire } from 'module';
const pw = createRequire(import.meta.url)('playwright');
const [out, ...spots] = process.argv.slice(2);
const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
await ctx.addInitScript(() => localStorage.setItem('curbside.settings', JSON.stringify({ testTools: true })));
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 200)); });
await page.goto('http://localhost:5343/', { waitUntil: 'load' });
await page.waitForFunction(() => window.__ub, null, { timeout: 180000 });
await page.evaluate(() => window.__ub.startGame());
await page.waitForFunction(() => window.__ub.look.props.loaded, null, { timeout: 180000 });
await page.evaluate(() => window.__ub.fastForward(3));
await page.keyboard.press('Escape');
await page.locator('#paused .mbtn', { hasText: 'OBSERVE' }).click({ timeout: 30000 });
await page.waitForTimeout(800);
for (const s of spots) {
  const [name, x, z, h, hour] = s.split(':');
  await page.evaluate(([x, z, h, hour]) => { const u = window.__ub; u.testTools.setHour(Number(hour), 'x'); u.look.time.speed = 0; const c = u.observe.cam; c.x = Number(x); c.z = Number(z); c.vx = 0; c.vz = 0; c.height = Number(h); c.yaw = 0; }, [x, z, h, hour]);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}-${name}.png` });
}
await browser.close();

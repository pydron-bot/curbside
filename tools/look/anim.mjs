import { createRequire } from 'module';
const pw = createRequire(import.meta.url)('playwright');
const [out, x, z] = process.argv.slice(2);
const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
await ctx.addInitScript(() => localStorage.setItem('curbside.settings', JSON.stringify({ testTools: true })));
const page = await ctx.newPage();
await page.goto('http://localhost:5343/', { waitUntil: 'load' });
await page.waitForFunction(() => window.__ub, null, { timeout: 180000 });
await page.evaluate(() => window.__ub.startGame());
await page.waitForFunction(() => window.__ub.look.props.loaded, null, { timeout: 180000 });
await page.evaluate(([x, z]) => { const u = window.__ub; u.fastForward(3); u.testTools.teleport(x, z); u.testTools.setHour(22, 'x'); u.look.time.speed = 0; u.fastForward(3); }, [Number(x), Number(z)]);
await page.waitForTimeout(1500);
for (let i = 0; i < 16; i++) {
  await page.screenshot({ path: `${out}-${String(i).padStart(2, '0')}.png` });
  await page.waitForTimeout(250);
}
await browser.close();

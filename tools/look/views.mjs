// node views.mjs <outdir> [profile=both|phone|desktop] [only=substring]
import { createRequire } from 'module';
const pw = createRequire(import.meta.url)('playwright');
const [dir, which = 'both', only = ''] = process.argv.slice(2);
const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const iphone = pw.devices['iPhone 15 Pro landscape'];
const profiles = [
  ['phone', { ...iphone, viewport: { width: 852, height: 393 } }, 0.5],
  ['desktop', { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 }, 1],
].filter(([n]) => which === 'both' || which === n);
const views = [
  ['spawn', null], ['downtown', [0, 8]], ['arts', [224, -248]],
];
const hours = [['day', 13], ['dusk', 18.7], ['night', 22]];
for (const [pname, ctxOpt, scale] of profiles) {
  const ctx = await browser.newContext({ ...ctxOpt, serviceWorkers: 'block' });
  await ctx.addInitScript(() => localStorage.setItem('curbside.settings', JSON.stringify({ testTools: true })));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('ERR', String(e)));
  await page.goto(`http://localhost:5343/?renderScale=${scale}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ub, null, { timeout: 180000 });
  await page.waitForTimeout(5000);
  if (!only || 'title'.includes(only)) await page.screenshot({ path: `${dir}/${pname}-title.png`, timeout: 180000 });
  await page.evaluate(() => window.__ub.startGame());
  await page.waitForFunction(() => window.__ub.look.props.loaded, null, { timeout: 180000 });
  await page.evaluate(() => { window.__ub.fastForward(3); window.__ub.testTools.spawn('sports'); });
  for (const [vname, at] of views) {
    if (at) await page.evaluate(([x, z]) => window.__ub.testTools.teleport(x, z), at);
    for (const [hname, h] of hours) {
      const label = `${pname}-${vname}-${hname}`;
      if (only && !label.includes(only)) continue;
      await page.evaluate((h) => { const u = window.__ub; u.testTools.setHour(h, 'x'); u.look.time.speed = 0; }, h);
      await page.evaluate(() => window.__ub.fastForward(0.3));
      await page.waitForTimeout(2500);
      await page.screenshot({ path: `${dir}/${label}.png`, timeout: 180000 });
      const calls = await page.evaluate(() => window.__ub.renderer.info.render.calls);
      console.log(label, 'calls', calls);
    }
  }
  await ctx.close();
}
await browser.close();

// node spot.mjs <outprefix> <phone|desktop> name:x:z:hour[:car] ...
import { createRequire } from 'module';
const pw = createRequire(import.meta.url)('playwright');
const [out, prof, ...spots] = process.argv.slice(2);
const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctxOpt = prof === 'phone' ? { ...pw.devices['iPhone 15 Pro landscape'], viewport: { width: 852, height: 393 } } : { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 };
const ctx = await browser.newContext({ ...ctxOpt, serviceWorkers: 'block' });
await ctx.addInitScript(() => localStorage.setItem('curbside.settings', JSON.stringify({ testTools: true })));
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('ERR', String(e)));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 300)); });
await page.goto(`http://localhost:5343/?renderScale=${prof === 'phone' ? 0.5 : 1}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ub, null, { timeout: 180000 });
await page.evaluate(() => window.__ub.startGame());
await page.waitForFunction(() => window.__ub.look.props.loaded, null, { timeout: 180000 });
await page.evaluate(() => window.__ub.fastForward(3));
for (const spot of spots) {
  const [name, x, z, hour, car, rain, siren] = spot.split(':');
  await page.evaluate(([x, z, h, car, rain, siren]) => {
    const u = window.__ub;
    u.testTools.setRain(rain === 'rain' ? 'on' : 'off');
    if (car) u.testTools.spawn(car);
    u.testTools.teleport(Number(x), Number(z));
    u.testTools.setHour(Number(h), 'x');
    u.look.time.speed = 0;
    u.fastForward(rain === 'rain' ? 6 : 3);
    if (siren) {
      const p = u.player.ped;
      const vs = u.vehicles.filter((v) => v.mesh?.root?.visible).sort((a, b) => ((a.sim.x - p.x) ** 2 + (a.sim.z - p.z) ** 2) - ((b.sim.x - p.x) ** 2 + (b.sim.z - p.z) ** 2));
      for (const v of vs.slice(0, Number(siren))) v.mesh.siren = true;
      if (u.player.driving) u.player.driving.mesh.siren = true;
      u.fastForward(0.2);
    }
  }, [x, z, hour, car, rain, siren]);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}-${name}.png`, timeout: 180000 });
  console.log(name, 'calls', await page.evaluate(() => window.__ub.renderer.info.render.calls));
}
await browser.close();

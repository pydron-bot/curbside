// node panel.mjs <outprefix> <phone|desktop> [x:z:hour]
// TEST → LOOK: the tab, the panel open over play, a few sliders moved, folded.
import { createRequire } from 'module';
const pw = createRequire(import.meta.url)('playwright');
const [out, prof, spot = '224:-248:21'] = process.argv.slice(2);
const [sx, sz, sh] = spot.split(':').map(Number);
const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const phone = prof === 'phone';
const ctxOpt = phone ? { ...pw.devices['iPhone 15 Pro landscape'], viewport: { width: 852, height: 393 } } : { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 };
const ctx = await browser.newContext({ ...ctxOpt, serviceWorkers: 'block' });
await ctx.addInitScript(() => {
  localStorage.setItem('curbside.settings', JSON.stringify({ testTools: true }));
  localStorage.removeItem('curbside.look');
  localStorage.removeItem('curbside.lookPanel');
});
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('ERR', String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 300));
});
await page.goto(`http://localhost:5343/?renderScale=${phone ? 0.5 : 1}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ub, null, { timeout: 180000 });
await page.evaluate(() => window.__ub.startGame());
await page.waitForFunction(() => window.__ub.look.props.loaded, null, { timeout: 180000 });
await page.evaluate(([x, z, h]) => {
  const u = window.__ub;
  u.testTools.setRain('off');
  u.testTools.teleport(x, z);
  u.testTools.holdClock(h);
  u.fastForward(3);
}, [sx, sz, sh]);
const shot = async (name) => {
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}-${name}.png`, timeout: 180000 });
  console.log(name, 'calls', await page.evaluate(() => window.__ub.renderer.info.render.calls));
};
await shot('0-before');
// Pause → TEST → LOOK.
await page.keyboard.press('Escape');
await page.waitForTimeout(600);
await page.locator('button', { hasText: /^TEST$/ }).first().click();
await page.waitForTimeout(400);
await page.locator('#testmenu .tab', { hasText: 'LOOK' }).click();
await shot('1-tab');
await page.locator('#testmenu .test-btn', { hasText: 'OPEN THE LOOK PANEL' }).click();
await shot('2-panel');
// Move a few sliders the way a thumb would (input events on the range).
const move = (label, v) =>
  page.evaluate(([label, v]) => {
    const row = [...document.querySelectorAll('.lookp-row')].find((r) => r.querySelector('b').textContent === label);
    const input = row.querySelector('input');
    input.value = String(v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, [label, v]);
await move('NIGHT BRIGHTNESS', 1.3);
await move('MOONLIGHT', 0.6);
await move('NIGHT COLOUR', 18);
await shot('3-moved');
// Open the grade group and push it.
await page.locator('.lookp-gh', { hasText: 'COLOUR GRADE' }).click();
await move('COLOUR SATURATION', 1.5);
await move('CONTRAST', 1.25);
await page.evaluate(() => (document.querySelector('.lookp-body').scrollTop = 1e4));
await shot('4-grade');
await page.locator('.lookp-tab').click();
await shot('5-folded');
// Unfold; the night group at night, then the daytime group at noon.
await page.locator('.lookp-tab').click();
await page.locator('.lookp-gh', { hasText: 'SKY & LIGHT' }).click();
await page.locator('.lookp-gh', { hasText: 'COLOUR GRADE' }).click();
await page.locator('.lookp-gh', { hasText: 'NEON & NIGHT' }).click();
await move('NEON STRENGTH', 1.6);
await move('STREET LAMP COLOUR', 0.5);
await page.evaluate(() => (document.querySelector('.lookp-body').scrollTop = 0));
await shot('6-night');
await page.locator('.lookp-gh', { hasText: 'NEON & NIGHT' }).click();
await page.locator('.lookp-gh', { hasText: 'DAYTIME' }).click();
await page.locator('.lookp-chip', { hasText: 'NOON' }).click();
await move('CLOUD COVER', 1.8);
await move('CLOUD SHADOW DARKNESS', 1.5);
await shot('7-day');
console.log('look', await page.evaluate(() => window.__ub.lookTuning.exportFile()));
console.log('stored', await page.evaluate(() => localStorage.getItem('curbside.look')));
await browser.close();

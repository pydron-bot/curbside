/**
 * Browser smoke test: build the game as Pages does (/curbside/), serve it,
 * and play it headless (Chromium + SwiftShader) on desktop 1280×720 and the
 * iPhone 15 Pro landscape profile at 852×393 and 852×340 (Safari's toolbar
 * showing): it must boot, start a run and simulate 30 s with no page or
 * console errors, and draw under the 150-call budget. Then the PWA: the
 * manifest is installable, and once the service worker has the game cached,
 * it boots and plays offline. On the 852×393 profile, REPORT BUG too: the
 * screenshot, the report and the share sheet (mocked: shared, cancelled,
 * refused). Catches the wiring crashes `npm test` can't.
 *
 *   npx -y -p playwright@1.63.0 node tools/smoke.mjs [--no-build] [--port 4318] [--out smoke-out]
 *
 * SwiftShader runs at ~1 fps, so it judges draw calls and errors, never
 * frame times. Exit code 1 on any failure; screenshots land in --out.
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { args, launch, playwright } from './tune/lib.mjs';

const opt = args({ build: true, port: 4318, out: 'smoke-out' });
const BASE = '/curbside/';
const URL = `http://localhost:${opt.port}${BASE}`;
const DRAW_BUDGET = 150;
const env = { ...process.env, CURBSIDE_BASE: BASE };
const failures = [];
mkdirSync(opt.out, { recursive: true });

function run(cmd, argv) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, argv, { env, stdio: 'inherit' });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${argv.join(' ')} exited ${code}`))));
  });
}

async function waitForServer(url, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`no server at ${url}`);
}

/** Errors from the page: uncaught exceptions and console.error. */
function watch(page, label) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`${label} pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${label} console.error: ${m.text()}`);
  });
  return errors;
}

const check = (ok, what) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}`);
  if (!ok) failures.push(what);
};

/** Boot, start a run, simulate, draw: the checks every profile gets. */
async function play(page, label) {
  await page.goto(URL);
  await page.waitForFunction(() => window.__ub, null, { timeout: 90000 });
  await page.waitForTimeout(2000);
  const r = await page.evaluate(async () => {
    const u = window.__ub;
    u.startGame();
    u.fastForward(30);
    // A few real frames, so the renderer draws the scene as it stands.
    for (let i = 0; i < 3; i++) await new Promise((res) => requestAnimationFrame(() => res()));
    return { sim: u.simTime, calls: u.renderer.info.render.calls, alive: u.player.ped !== undefined, paused: u.paused };
  });
  check(r.sim >= 29, `${label}: simulated 30 s (simTime ${r.sim.toFixed(1)})`);
  check(r.calls > 0 && r.calls < DRAW_BUDGET, `${label}: ${r.calls} draw calls (budget ${DRAW_BUDGET})`);
  // A 1280×720 'high' frame on SwiftShader takes ~20 s to capture on a busy runner (main and branches
  // alike), so the default 30 s ran out now and then; a hung renderer still fails here.
  await page.screenshot({ path: path.join(opt.out, `${label}.png`), timeout: 120000 });
  return r;
}

/**
 * REPORT BUG from the pause card (test tools on): a screenshot is taken, the
 * share sheet gets a JPEG and the JSON report, and a cancelled or refused
 * share never throws (refused falls back to saving the files).
 */
async function bugReport(page, label) {
  await page.evaluate(() => {
    window.__shareMode = 'ok';
    navigator.canShare = () => true;
    navigator.share = async (data) => {
      window.__shared = await Promise.all(
        data.files.map(async (f) => ({ name: f.name, type: f.type, report: f.type.startsWith('image/') ? null : JSON.parse(await f.text()) })),
      );
      if (window.__shareMode === 'cancel') throw new DOMException('Share canceled', 'AbortError');
      if (window.__shareMode === 'deny') throw new DOMException('Not allowed', 'NotAllowedError');
    };
    window.__ub.setPaused(true);
  });
  await page.click('.pause-corner-btn', { timeout: 30000 });
  await page.waitForSelector('#bug-report .bug-shot img:not([hidden])', { timeout: 60000 });
  await page.fill('#bug-report .bug-note', 'smoke test');
  const share = async (mode) => {
    await page.evaluate((m) => {
      window.__shareMode = m;
      document.querySelector('#bug-report .diag-status').textContent = '';
    }, mode);
    await page.locator('#bug-report .tabs button', { hasText: 'SHARE' }).click();
    await page.waitForFunction(() => document.querySelector('#bug-report .diag-status').textContent !== '', null, { timeout: 30000 });
    return page.evaluate(() => document.querySelector('#bug-report .diag-status').textContent);
  };
  const shared = await share('ok');
  const files = await page.evaluate(() => window.__shared);
  const report = files?.find((f) => f.report)?.report;
  check(
    /Shared/.test(shared) && files.length === 2 && files[0].type === 'image/jpeg' && report?.note === 'smoke test' && report.events.length > 0 && report.diagnostics?.build,
    `${label}: REPORT BUG shares a screenshot and the report (${files?.map((f) => f.name).join(', ')})`,
  );
  check(/cancelled/.test(await share('cancel')), `${label}: a cancelled share is just noted`);
  check(/Saved/.test(await share('deny')), `${label}: a refused share saves the files instead`);
  await page.click('#bug-report .sheet-close');
}

let server = null;
let browser = null;
try {
  if (opt.build) await run('npx', ['vite', 'build']);
  server = spawn('npx', ['vite', 'preview', '--port', String(opt.port), '--strictPort'], { env, stdio: 'ignore' });
  await waitForServer(URL);
  browser = await launch();
  const { devices } = await playwright();
  const iphone = devices['iPhone 15 Pro landscape'];

  const profiles = [
    ['desktop-1280x720', { viewport: { width: 1280, height: 720 } }],
    ['iphone-852x393', { ...iphone, viewport: { width: 852, height: 393 } }, { testTools: true }],
    ['iphone-852x340', { ...iphone, viewport: { width: 852, height: 340 } }],
  ];
  for (const [label, ctxOpt, saved] of profiles) {
    console.log(label);
    const ctx = await browser.newContext({ ...ctxOpt, serviceWorkers: 'block', acceptDownloads: true });
    const page = await ctx.newPage();
    const errors = watch(page, label);
    if (saved) await page.addInitScript((s) => localStorage.setItem('curbside.settings', JSON.stringify(s)), saved);
    try {
      await play(page, label);
      if (saved?.testTools) await bugReport(page, label);
    } catch (e) {
      check(false, `${label}: ${e.message.split('\n')[0]}`);
    }
    check(errors.length === 0, `${label}: no page or console errors${errors.length ? `\n      ${errors.join('\n      ')}` : ''}`);
    await ctx.close();
  }

  console.log('pwa');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errors = watch(page, 'pwa');
  await page.goto(URL);
  await page.waitForFunction(() => window.__ub, null, { timeout: 90000 });
  const cdp = await ctx.newCDPSession(page);
  const inst = await cdp.send('Page.getInstallabilityErrors');
  check(inst.installabilityErrors.length === 0, `pwa: installable${inst.installabilityErrors.length ? ` (${JSON.stringify(inst.installabilityErrors)})` : ''}`);
  // Wait for the service worker to finish precaching, then take the network away.
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 60000 });
  await ctx.setOffline(true);
  try {
    await play(page, 'pwa-offline');
  } catch (e) {
    check(false, `pwa-offline: ${e.message.split('\n')[0]}`);
  }
  check(errors.length === 0, `pwa: no page or console errors${errors.length ? `\n      ${errors.join('\n      ')}` : ''}`);
  await ctx.close();
} catch (e) {
  failures.push(e.message);
  console.error(e);
} finally {
  await browser?.close();
  server?.kill();
}

console.log(failures.length ? `\nSMOKE FAILED: ${failures.length} check(s)` : '\nSMOKE OK');
process.exit(failures.length ? 1 : 0);

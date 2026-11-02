/**
 * W3-A spike: boot the game at each city size (`?city=N`) and measure what
 * a bigger map costs: time to boot (page start to the game's hooks, so city
 * generation, dressing, meshes and textures), JS heap after a GC, and draw
 * calls and triangles at the spawn corner, out in the new ring, and in
 * observe mode at the widest zoom over each. Builds the game as Pages does
 * and serves it (like tools/smoke.mjs), so boot times are of the real bundle.
 *
 *   npx -y -p playwright@1.63.0 node tools/tune/citySize.mjs [--sizes 16,24,32] [--runs 2]
 *     [--no-build] [--port 4331] [--only desktop|iphone]
 *
 * Headless Chromium on SwiftShader: boot times and heap compare sizes with
 * each other (the absolute numbers are a loaded server's, not an iPhone's);
 * draw calls are what the iPhone would draw. Frame times mean nothing here.
 */
import { spawn } from 'node:child_process';
import { args, pct, playwright } from './lib.mjs';

const opt = args({ build: true, port: 4331, sizes: '16,24,32', runs: 2, only: '' });
const SIZES = String(opt.sizes).split(',').map(Number);
const BASE = '/curbside/';
const URL = `http://localhost:${opt.port}${BASE}`;
const env = { ...process.env, CURBSIDE_BASE: BASE };

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
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no server at ${url}`);
}

/** One boot at `size`: the numbers for one row. */
async function measure(browser, ctxOpt, size) {
  const ctx = await browser.newContext(ctxOpt);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Past the cold open with the side modes open, under both save keys (a trial size saves apart).
  await page.addInitScript(() => {
    const save = JSON.stringify({ v: 1, opening: true, unlocks: ['sideModes'] });
    for (const k of ['curbside.save', 'curbside.save.city24', 'curbside.save.city32']) localStorage.setItem(k, save);
  });
  await page.goto(`${URL}?city=${size}`);
  await page.waitForFunction(() => window.__ub, null, { timeout: 180000, polling: 50 });
  const bootMs = await page.evaluate(() => performance.now());
  await page.waitForTimeout(1500);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('HeapProfiler.collectGarbage');
  const heapMB = await page.evaluate(() => performance.memory.usedJSHeapSize / 2 ** 20);

  const frames = (n) => page.evaluate(async (n) => {
    const u = window.__ub;
    let calls = 0;
    let tris = 0;
    for (let i = 0; i < n; i++) {
      await new Promise((res) => requestAnimationFrame(() => res()));
      if (i >= 2) {
        calls = Math.max(calls, u.renderer.info.render.calls);
        tris = Math.max(tris, u.renderer.info.render.triangles);
      }
    }
    return { calls, tris };
  }, n);
  const out = { size, bootMs, heapMB, errors };
  const blocks = await page.evaluate(() => ({ blocks: window.__ub.city.blocks.length, buildings: window.__ub.city.buildings.length, props: window.__ub.dressing.street.props.length }));
  Object.assign(out, blocks);

  await page.evaluate(() => {
    const u = window.__ub;
    u.startGame();
    u.fastForward(15);
  });
  out.spawn = await frames(6);
  // Out in the ring (a bigger city), else near the edge: on foot, then let the streets fill round you.
  const ringAt = size > 16 ? -(512 + 32 * (size - 16) / 2) : -448;
  await page.evaluate((at) => {
    const u = window.__ub;
    u.testTools.teleport(at, at + 9);
    u.fastForward(15);
  }, ringAt);
  out.ring = await frames(6);

  // Observe at the widest zoom, turned 45°: over the ring, then over the middle.
  await page.evaluate(() => window.__ub.setPaused(true));
  await page.locator('#paused .mbtn', { hasText: 'OBSERVE' }).click({ timeout: 30000 });
  const wide = async (x, z) => {
    await page.evaluate(([x, z]) => {
      const cam = window.__ub.observe.cam;
      cam.jump(x, z);
      cam.height = 1000;
      cam.yaw = Math.PI / 4;
    }, [x, z]);
    return frames(8);
  };
  out.observeRing = await wide(ringAt, ringAt);
  out.observeMiddle = await wide(0, 0);
  await ctx.close();
  return out;
}

let server = null;
let browser = null;
try {
  if (opt.build) await run('npx', ['vite', 'build']);
  server = spawn('npx', ['vite', 'preview', '--port', String(opt.port), '--strictPort'], { env, stdio: 'ignore' });
  await waitForServer(URL);
  const { chromium, devices } = await playwright();
  browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-precise-memory-info', '--js-flags=--expose-gc'],
  });
  const profiles = [
    ['desktop', { viewport: { width: 1280, height: 720 } }],
    ['iphone', { ...devices['iPhone 15 Pro landscape'], viewport: { width: 852, height: 393 } }],
  ].filter(([label]) => !opt.only || label === opt.only);
  const rows = [];
  for (const [label, ctxOpt] of profiles) {
    for (const size of SIZES) {
      const runs = [];
      for (let r = 0; r < opt.runs; r++) runs.push(await measure(browser, ctxOpt, size));
      const last = runs[runs.length - 1];
      const row = {
        profile: label,
        size: `${size}×${size}`,
        km: ((size * 64) / 1000).toFixed(2),
        blocks: last.blocks,
        buildings: last.buildings,
        props: last.props,
        bootMs: Math.round(pct(runs.map((x) => x.bootMs), 50)),
        heapMB: Math.round(pct(runs.map((x) => x.heapMB), 50)),
        spawnDc: last.spawn.calls,
        ringDc: last.ring.calls,
        obsRingDc: last.observeRing.calls,
        obsMidDc: last.observeMiddle.calls,
        obsMidKTris: Math.round(last.observeMiddle.tris / 1000),
        errors: runs.flatMap((x) => x.errors).length,
      };
      rows.push(row);
      console.log(JSON.stringify(row));
    }
  }
  console.table(rows);
} finally {
  await browser?.close();
  server?.kill();
}

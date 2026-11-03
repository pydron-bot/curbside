/**
 * Browser smoke test: build the game as Pages does (/curbside/), serve it,
 * and play it headless (Chromium + SwiftShader) on desktop 1280×720 and the
 * iPhone 15 Pro landscape profile at 852×393 and 852×340 (Safari's toolbar
 * showing): it must boot, start a run and simulate 30 s with no page or
 * console errors, and draw under the 150-call budget. A fresh save's title
 * is PLAY and SETTINGS (OBSERVE too with Test tools on) and has OBSERVE,
 * CHARACTER and HOW TO PLAY once the cold open has run; PLAY is the cold open: the player must be in
 * the getaway within 20 s, then again with chases forced off (the fallback),
 * and a second PLAY must not replay it. Then the PWA: the
 * manifest is installable, and once the service worker has the game cached,
 * it boots and plays offline. On the 852×393 profile, REPORT BUG too: the
 * screenshot, the report and the share sheet (mocked: shared, cancelled,
 * refused). On every profile, a named-mayhem stamp (and on the phones one
 * in a Chaos Run) must stay clear of the stars, radar, activity card and
 * score feed, and the police scanner's subtitle clear of all that, the
 * radio's card and the thumbs, on foot and in a car. OBSERVE, from the pause
 * menu and from the title: no HUD, under the budget at the widest zoom, and
 * back out to the paused run or the title. On desktop, the map editor: a
 * block edit, CHANGES, EXPORT's file, undo, and the districts left as
 * they were. The best-moment picture: a
 * stamp, then WASTED shows its photo and caption clear of WASTED and the
 * controls, and SHARE hands the (mocked) share sheet a JPEG. Catches the wiring crashes
 * `npm test` can't.
 *
 *   npx -y -p playwright@1.63.0 node tools/smoke.mjs [--no-build] [--port 4318] [--out smoke-out]
 *     [--only desktop|852x393|852x340|pwa] [--jobs 2] [--scale 0.35]
 *
 * SwiftShader runs at ~1 fps, so it judges draw calls and errors, never
 * frame times. Exit code 1 on any failure; screenshots land in --out.
 *
 * Speed: the canvas is drawn at --scale of its pixel ratio (`?renderScale=`,
 * render/dynamicResolution.ts): software rendering costs by the pixel, and
 * draw calls, tiers and the HUD are the same at any scale. --scale 1 for
 * sharp screenshots of the 3D view. --jobs N builds once and runs the
 * profiles N at a time as child runs (each with its own port and
 * --out/<profile>); CI runs them as separate jobs instead.
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { args, launch, playwright } from './tune/lib.mjs';

const opt = args({ build: true, port: 4318, out: 'smoke-out', only: '', jobs: 1, scale: 0.35 });
/** --only desktop | 852x393 | 852x340 | pwa: one profile (CI runs them as parallel jobs). */
const ONLY = ['', 'desktop', '852x393', '852x340', 'pwa'];
if (!ONLY.includes(String(opt.only))) {
  console.error(`--only must be one of ${ONLY.slice(1).join(', ')}`);
  process.exit(2);
}
const BASE = '/curbside/';
const SCALE = Math.min(1, Math.max(0.1, Number(opt.scale) || 1));
const URL = `http://localhost:${opt.port}${BASE}${SCALE < 1 ? `?renderScale=${SCALE}` : ''}`;
const started = Date.now();
const seconds = (since) => `${Math.round((Date.now() - since) / 1000)} s`;
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

/**
 * PLAY into the cold open (a save that hasn't had it): the getaway crashes at
 * the kerb, the bot walks to its door at a walking pace and presses E. In
 * the getaway within 20 s of PLAY, with the 2 stars. `fallback`: chases
 * forced off first, so the crashed getaway is already there.
 */
async function coldOpen(page, label, fallback) {
  const crash = await page.evaluate(async (fallback) => {
    const u = window.__ub;
    const o = u.progress.opening;
    if (fallback) {
      u.progress.opening.forget();
      u.cityLife.chases.enabled = false;
      u.enterTitle();
    }
    u.startGame();
    window.__openAt = u.simTime;
    for (let i = 0; i < 60 && o.phase !== 'crashed'; i++) u.fastForward(0.25);
    // Drawn as it stands: the getaway at the kerb, GET IN up.
    for (let i = 0; i < 2; i++) await new Promise((res) => requestAnimationFrame(() => res()));
    return { crashedAt: u.simTime - window.__openAt, phase: o.phase };
  }, fallback);
  if (!fallback) await page.screenshot({ path: path.join(opt.out, `${label}-cold-open.png`), timeout: 120000 });
  const r = await page.evaluate(() => {
    const u = window.__ub;
    const o = u.progress.opening;
    const car = o.car;
    if (!car || o.phase !== 'crashed') return { inCarAt: Infinity };
    // To the driver's door (the left of the car), 5 m/s.
    const p = u.player.ped;
    for (let i = 0; i < 200; i++) {
      const s = car.sim;
      const dx = s.x + Math.cos(s.heading) * 1.6 - p.x;
      const dz = s.z - Math.sin(s.heading) * 1.6 - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.8) break;
      const k = Math.min(1, 0.5 / d);
      p.x += dx * k;
      p.z += dz * k;
      u.fastForward(0.1);
    }
    u.input.keyboard.actionPresses++;
    u.stepFrame();
    u.fastForward(0.5);
    u.cityLife.chases.enabled = true;
    return {
      inCarAt: u.simTime - window.__openAt,
      driving: u.player.driving === car,
      stars: u.heat.wanted.level,
      fallback: o.fallback,
      opened: u.progress.progress.data.opening,
      job: u.progress.missions.running?.id ?? null,
    };
  });
  const what = fallback ? 'fallback (chases off)' : 'cold open';
  check(
    r.driving && r.inCarAt < 20 && crash.crashedAt < 10 && r.fallback === fallback && r.stars >= 2 && r.opened && r.job === 's1-wrongstop',
    `${label}: ${what}: at the kerb ${crash.crashedAt.toFixed(1)} s, in the getaway ${r.inCarAt.toFixed(1)} s after PLAY, ${r.stars ?? '?'}★${r.driving ? '' : ` (${JSON.stringify({ ...crash, ...r })})`}`,
  );
}

/** The title's buttons on screen, by label (INSTALL comes and goes with the browser's offer: left out). */
const titleButtons = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('#title .mbtn')]
      .filter((el) => el.getClientRects().length > 0)
      .map((el) => el.querySelector('b').textContent)
      .filter((t) => t !== 'INSTALL'),
  );

/** Boot, start a run (the cold open on a fresh save), simulate, draw: the checks every profile gets. `full`: the fallback and a second PLAY too. */
async function play(page, label, full = true, testTools = false) {
  await page.goto(URL);
  await page.waitForFunction(() => window.__ub, null, { timeout: 90000 });
  await page.waitForTimeout(2000);
  const fresh = await page.evaluate(() => ({
    titleModes: [...document.querySelectorAll('#title [data-mode]')].map((el) => el.dataset.mode),
    due: !window.__ub.progress.progress.data.opening,
  }));
  check(fresh.titleModes.length === 0 && fresh.due, `${label}: a fresh save: no side modes on the title (${fresh.titleModes.join(', ') || 'none'}), the cold open due`);
  // PLAY and SETTINGS only (OBSERVE too with Test tools on, as a testing mode).
  const freshButtons = (await titleButtons(page)).join(', ');
  const want = testTools ? 'PLAY, OBSERVE, SETTINGS' : 'PLAY, SETTINGS';
  check(freshButtons === want, `${label}: a fresh save's title: ${freshButtons}${freshButtons === want ? '' : ` (want ${want})`}`);
  await coldOpen(page, label, false);
  const r = await page.evaluate(async () => {
    const u = window.__ub;
    const side = u.progress.sideModes;
    // On to 30 s of play: in the getaway, the chase's cops after you.
    u.fastForward(Math.max(0, 30 - u.simTime));
    // A few real frames, so the renderer draws the scene as it stands.
    for (let i = 0; i < 3; i++) await new Promise((res) => requestAnimationFrame(() => res()));
    return { sim: u.simTime, calls: u.renderer.info.render.calls, alive: u.player.ped !== undefined, paused: u.paused, side };
  });
  check(!r.side, `${label}: no frenzies, races, exports or fares offered before story job 2`);
  check(r.sim >= 29, `${label}: simulated 30 s (simTime ${r.sim.toFixed(1)})`);
  check(r.calls > 0 && r.calls < DRAW_BUDGET, `${label}: ${r.calls} draw calls (budget ${DRAW_BUDGET})`);
  // A 1280×720 'high' frame on SwiftShader takes ~20 s to capture on a busy runner (main and branches
  // alike), so the default 30 s ran out now and then; a hung renderer still fails here.
  await page.screenshot({ path: path.join(opt.out, `${label}.png`), timeout: 120000 });
  // In the getaway, the cold open has run: OBSERVE (and CHARACTER, HOW TO PLAY) on the title from now on.
  await page.evaluate(() => window.__ub.enterTitle());
  const after = (await titleButtons(page)).join(', ');
  const wantAfter = 'PLAY, OBSERVE, CHARACTER, SETTINGS, HOW TO PLAY';
  check(after === wantAfter, `${label}: after the cold open, the title: ${after}${after === wantAfter ? '' : ` (want ${wantAfter})`}`);
  if (!full) return r;
  const again = await page.evaluate(() => {
    const u = window.__ub;
    u.startGame();
    u.fastForward(1);
    return { phase: u.progress.opening.phase, d: Math.hypot(u.player.ped.x - 9.5, u.player.ped.z - 9.5) };
  });
  check(again.phase === 'idle' && again.d < 4, `${label}: a second PLAY starts at the spawn corner, no cold open (${JSON.stringify(again)})`);
  await coldOpen(page, label, true);
  return r;
}

/** HUD pieces a stamp must never cover (the touch buttons too: it once sat on NOS under two cards). */
const STAMP_CLEAR_OF = ['#wanted', '#radar', '#activity', '#score', '.hud-status', '#act-banner', '.tbtn'];

/**
 * A named-mayhem stamp (the longest label, with stars up) held mid-show:
 * on screen, inside the view and clear of the stars, radar, status,
 * activity card and score feed. `chaos`: in a Chaos Run (its card up).
 */
async function stampCheck(page, label, chaos) {
  const r = await page.evaluate(
    async ({ chaos, clearOf }) => {
      const u = window.__ub;
      const frames = async (n) => {
        for (let i = 0; i < n; i++) await new Promise((res) => requestAnimationFrame(() => res()));
      };
      // Back from REPORT BUG's pause card.
      if (u.paused) u.setPaused(false);
      if (chaos) {
        u.frontDoor.play(u.progress.chaos.titleMode);
        u.fastForward(5);
        // Past GO: the count's banner goes on the frame clock.
        for (let i = 0; i < 20 && !document.querySelector('#act-banner').hidden; i++) await frames(1);
      }
      u.testTools.wanted(3);
      u.stamp('neighbourhoodWatch');
      await frames(3);
      // The stars, card and stamp glide when the radio's card comes or goes: measure them settled.
      await Promise.race([Promise.all(document.getAnimations().filter((a) => a instanceof CSSTransition).map((a) => a.finished.catch(() => {}))), new Promise((res) => setTimeout(res, 5000))]);
      const box = document.querySelector('#stamp .stamp-box');
      // Hold the slam at full size (SwiftShader frames take longer than the whole show).
      for (const a of box.getAnimations()) {
        a.pause();
        a.currentTime = 800;
      }
      const rect = (el) => {
        const b = el.getBoundingClientRect();
        return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, w: b.width, h: b.height };
      };
      const s = rect(box);
      const hits = [];
      for (const sel of clearOf) {
        for (const el of document.querySelectorAll(sel)) {
          const b = rect(el);
          if (b.w === 0 || b.h === 0) continue;
          if (s.left < b.right && b.left < s.right && s.top < b.bottom && b.top < s.bottom) hits.push(`${sel} ${Math.round(b.left)},${Math.round(b.top)}–${Math.round(b.right)},${Math.round(b.bottom)}`);
        }
      }
      return {
        text: box.textContent,
        opacity: Number(getComputedStyle(box).opacity),
        inside: s.left >= 0 && s.right <= innerWidth && s.top >= 0 && s.bottom <= innerHeight,
        activity: !document.querySelector('#activity')?.hidden,
        stars: !document.querySelector('#wanted')?.hidden,
        hits,
        s,
      };
    },
    { chaos, clearOf: STAMP_CLEAR_OF },
  );
  const where = `${label}${chaos ? ' (Chaos Run)' : ''}`;
  check(r.text.startsWith('NEIGHBOURHOOD WATCH') && r.opacity > 0.9 && r.inside, `${where}: stamp shows inside the view (${Math.round(r.s.left)},${Math.round(r.s.top)} ${Math.round(r.s.w)}×${Math.round(r.s.h)})`);
  check(r.hits.length === 0 && r.stars && (!chaos || r.activity), `${where}: stamp clear of the HUD${r.hits.length ? ` (covers ${r.hits.join(', ')})` : ''}`);
  await page.screenshot({ path: path.join(opt.out, `${label}${chaos ? '-chaos' : ''}-stamp.png`), timeout: 120000 });
}

/** What the scanner's subtitle must stay clear of: the stamp's list, the stamp itself, the radio's card, the prompts, the thumbs. */
const SCANNER_CLEAR_OF = [...STAMP_CLEAR_OF, '#stamp .stamp-box', '#radio', '#act-prompt', '.hud-prompt', '.speedo', '.pedal-pad', '.stick-base', '.aim-base'];

/**
 * The police scanner's subtitle (V2-11) with everything else up at once:
 * three stars, a stamp held mid-show, the radio's card in, on foot and
 * then in a car (the touch layout changes). On screen and clear of all of
 * it; a screenshot in the car.
 */
async function scannerCheck(page, label) {
  for (const inCar of [false, true]) {
    const r = await page.evaluate(
      async ({ inCar, clearOf }) => {
        const u = window.__ub;
        const frames = async (n) => {
          for (let i = 0; i < n; i++) await new Promise((res) => requestAnimationFrame(() => res()));
        };
        if (u.paused) u.setPaused(false);
        if (inCar && !u.player.driving) u.testTools.spawn('sedan');
        // The cold open's checks leave the player in the getaway.
        if (!inCar && u.player.driving) u.player.exit();
        u.testTools.wanted(3);
        u.stamp('neighbourhoodWatch');
        await frames(3);
        // The stamp sends the radio's card off; bring it back once it has gone, the stars and stamp step down for it.
        await new Promise((res) => setTimeout(res, 600));
        const radio = document.querySelector('#radio');
        radio.hidden = false;
        radio.classList.add('in');
        // Held on screen while it's measured and shot (SwiftShader frames are slow enough to run its time out).
        u.scannerHud.update = () => {};
        u.scanner.say('fire');
        await frames(3);
        await Promise.race([Promise.all(document.getAnimations().filter((a) => a instanceof CSSTransition).map((a) => a.finished.catch(() => {}))), new Promise((res) => setTimeout(res, 5000))]);
        for (const a of document.querySelector('#stamp .stamp-box').getAnimations()) {
          a.pause();
          a.currentTime = 800;
        }
        const rect = (el) => {
          const b = el.getBoundingClientRect();
          return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, w: b.width, h: b.height };
        };
        const box = document.querySelector('#scanner .sc-box');
        const s = rect(box);
        const hits = [];
        for (const sel of clearOf) {
          for (const el of document.querySelectorAll(sel)) {
            const b = rect(el);
            if (b.w === 0 || b.h === 0 || getComputedStyle(el).visibility === 'hidden') continue;
            if (s.left < b.right && b.left < s.right && s.top < b.bottom && b.top < s.bottom) hits.push(`${sel} ${Math.round(b.left)},${Math.round(b.top)}–${Math.round(b.right)},${Math.round(b.bottom)}`);
          }
        }
        return {
          text: box.textContent,
          opacity: Number(getComputedStyle(box).opacity),
          inside: s.left >= 0 && s.right <= innerWidth && s.top >= 0 && s.bottom <= innerHeight,
          driving: !!u.player.driving,
          ping: u.scanner.feed.pinging,
          hits,
          s,
        };
      },
      { inCar, clearOf: SCANNER_CLEAR_OF },
    );
    const where = `${label} ${inCar ? 'in a car' : 'on foot'}`;
    check(r.text.includes('SCANNER') && r.opacity > 0.9 && r.inside && r.ping && r.driving === inCar, `${where}: scanner line and ping show (${Math.round(r.s.left)},${Math.round(r.s.top)} ${Math.round(r.s.w)}×${Math.round(r.s.h)})`);
    check(r.hits.length === 0, `${where}: scanner line clear of the HUD, stamp, radio card and thumbs${r.hits.length ? ` (covers ${r.hits.join(', ')})` : ''}`);
    if (inCar) await page.screenshot({ path: path.join(opt.out, `${label}-scanner.png`), timeout: 120000 });
  }
  await page.evaluate(() => {
    const u = window.__ub;
    delete u.scannerHud.update;
  });
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

/**
 * Observe mode, from the paused run and from the title: it opens with no
 * HUD (no stars, radar, score or touch controls), only its strip inside the
 * view; at the widest zoom, turned 45°, it draws under the budget; and
 * leaving puts back the paused run (same place, same stars) or the title.
 */
async function observeCheck(page, label) {
  const frames = (n) => page.evaluate(async (n) => {
    for (let i = 0; i < n; i++) await new Promise((res) => requestAnimationFrame(() => res()));
  }, n);
  const state = () => page.evaluate(() => {
    // Laid out on screen (not display:none or hidden).
    const shown = (sel) => {
      const el = document.querySelector(sel);
      const b = el?.getBoundingClientRect();
      return !!el && getComputedStyle(el).display !== 'none' && b.width > 0 && b.height > 0;
    };
    const u = window.__ub;
    const strip = document.querySelector('.observe-strip').getBoundingClientRect();
    return {
      active: u.observe.active,
      paused: u.paused,
      title: shown('#title'),
      hud: ['#hud', '#radar', '#wanted', '#score', '.touch-layer', '#activity'].filter((s) => shown(s)),
      strip: shown('.observe-strip') && strip.left >= 0 && strip.right <= innerWidth && strip.bottom <= innerHeight,
      at: [Math.round(u.player.position.x * 100), Math.round(u.player.position.z * 100), u.heat.wanted.level, u.player.health],
    };
  });
  // From the run: paused, then OBSERVE in the pause menu.
  await page.evaluate(() => window.__ub.paused || window.__ub.setPaused(true));
  const before = await state();
  await page.locator('#paused .mbtn', { hasText: 'OBSERVE' }).click({ timeout: 30000 });
  await frames(2);
  const run = await state();
  check(run.active && !run.paused && run.hud.length === 0 && run.strip, `${label}: OBSERVE from the pause menu, no HUD${run.hud.length ? ` (showing ${run.hud.join(', ')})` : ''}`);
  const wide = await page.evaluate(async () => {
    const u = window.__ub;
    u.observe.cam.height = 1000;
    u.observe.cam.yaw = Math.PI / 4;
    let calls = 0;
    for (let i = 0; i < 8; i++) {
      await new Promise((res) => requestAnimationFrame(() => res()));
      if (i >= 5) calls = Math.max(calls, u.renderer.info.render.calls);
    }
    return { calls, height: Math.round(u.rig.currentHeight), tier: u.observe.d.tier() };
  });
  check(wide.calls > 0 && wide.calls < DRAW_BUDGET, `${label}: observe at the widest zoom (${wide.height} m, ${wide.tier}, turned 45°): ${wide.calls} draw calls (budget ${DRAW_BUDGET})`);
  await page.screenshot({ path: path.join(opt.out, `${label}-observe.png`), timeout: 120000 });
  await page.keyboard.press('Escape');
  await frames(2);
  const back = await state();
  check(!back.active && back.paused && JSON.stringify(back.at) === JSON.stringify(before.at), `${label}: leaving OBSERVE puts back the paused run (${JSON.stringify(back.at)})`);
  // From the title.
  await page.evaluate(() => {
    const u = window.__ub;
    u.setPaused(false);
    u.enterTitle();
  });
  await frames(2);
  await page.locator('#title .mbtn', { hasText: 'OBSERVE' }).click({ timeout: 30000 });
  await frames(2);
  const title = await state();
  check(title.active && !title.title && title.hud.length === 0 && title.strip, `${label}: OBSERVE from the title, no HUD or menu${title.hud.length ? ` (showing ${title.hud.join(', ')})` : ''}`);
  await page.locator('.observe-exit').click({ timeout: 30000 });
  await frames(2);
  const out = await state();
  check(!out.active && out.title && !out.paused, `${label}: EXIT goes back to the title`);
}

/**
 * The map editor (desktop): open it on a run (paused), repaint a block,
 * CHANGES lists it, EXPORT's text is a clean map file, Ctrl+Z undoes it,
 * and closing leaves the game's districts as they were (the preview
 * repaints them for the whole game while it builds).
 */
async function mapEditorCheck(page, label) {
  const before = await page.evaluate(async () => {
    const u = window.__ub;
    localStorage.removeItem('curbside.map.local');
    if (u.observe?.active) u.observe.exit();
    u.startGame();
    u.fastForward(1);
    const districts = u.mapEditor.districts();
    u.mapEditor.open();
    const ed = u.mapEditor.editor;
    // A downtown block made a park in Neon Mile.
    ed.select({ kind: 'block', bx: 7, bz: 7 }, true);
    return { districts, open: ed.isOpen, paused: u.paused };
  });
  check(before.open && before.paused, `${label}: MAP EDITOR opens and pauses the run`);
  await page.locator('#mapeditor [data-act="kind"][data-arg="park"]').click({ timeout: 30000 });
  await page.locator('#mapeditor [data-act="district"][data-arg="arts"]').click({ timeout: 30000 });
  await page.locator('#mapeditor [data-act="export"]').click({ timeout: 30000 });
  const edited = await page.evaluate(() => {
    const u = window.__ub;
    const ed = u.mapEditor.editor;
    const parsed = u.mapEditor.parse(document.querySelector('#mapeditor .me-export').value);
    return {
      changes: [...document.querySelectorAll('#mapeditor .me-changes-list .me-item')].map((el) => el.textContent),
      problems: ed.problems.length,
      parsed: { problems: parsed.problems, blocks: parsed.edits.blocks },
      saved: !!localStorage.getItem('curbside.map.local'),
    };
  });
  const block = edited.parsed.blocks[0];
  check(
    edited.changes.length === 1 && edited.changes[0].startsWith('Block 7,7: park, district arts') && edited.saved,
    `${label}: the block edit is in CHANGES and saved locally (${edited.changes.join('; ')})`,
  );
  check(
    edited.parsed.problems.length === 0 && edited.parsed.blocks.length === 1 && block.kind === 'park' && block.district === 'arts',
    `${label}: EXPORT writes a clean map file (${JSON.stringify(edited.parsed)})`,
  );
  // Two edits, two undo steps.
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Escape'); // the selection
  await page.keyboard.press('Escape'); // the editor
  const after = await page.evaluate(() => {
    const u = window.__ub;
    const r = { open: u.mapEditor.editor.isOpen, paused: u.paused, districts: u.mapEditor.districts(), saved: localStorage.getItem('curbside.map.local') };
    u.setPaused(false);
    return r;
  });
  check(
    !after.open && after.paused && after.saved === null,
    `${label}: Ctrl+Z undoes it (no local edits left) and Esc closes the editor to the paused run (${JSON.stringify({ open: after.open, paused: after.paused, saved: after.saved })})`,
  );
  check(after.districts === before.districts, `${label}: closing the map editor leaves the game's districts as they were`);
}

/** What the best-moment card must stay clear of on WASTED: its title, numbers and timer, the pause button, the corners' HUD and the thumbs. */
const MOMENT_CLEAR_OF = ['.wasted-title', '.wasted-stats', '.wasted-timer', '.hud-pause', '#radar', '#score', '#wanted', '.tbtn', '.stick-base', '.aim-base', '.pedal-pad'];

/**
 * The best-moment picture (V2-16): a stamp (the longest name) photographed
 * as it lands, then WASTED: the picture and caption show inside the view,
 * clear of WASTED's own pieces and the controls; SHARE hands the share
 * sheet (mocked) a JPEG, a refused share saves it; the respawn lets it go.
 */
async function momentCheck(page, label) {
  const r = await page.evaluate(
    async ({ clearOf }) => {
      const u = window.__ub;
      const frames = async (n) => {
        for (let i = 0; i < n; i++) await new Promise((res) => requestAnimationFrame(() => res()));
      };
      if (u.paused) u.setPaused(false);
      if (u.observe?.active) u.observe.exit();
      u.startGame();
      u.fastForward(1);
      await frames(2);
      u.stamp('neighbourhoodWatch');
      await frames(2);
      const pic = u.moment.picture;
      const shot = pic ? { w: pic.width, h: pic.height, copy: Math.round(u.moment.copyMs * 10) / 10 } : null;
      // Held on WASTED while it's measured (SwiftShader frames are slow enough to run the respawn's 3 s out).
      u.testTools.timeScale = 0;
      u.player.hurt(1e6);
      const btn = document.querySelector('#wasted .moment-share');
      for (let i = 0; i < 60 && btn.disabled; i++) await frames(1);
      // The entrance animations at their end.
      for (const a of document.getAnimations()) {
        if (a instanceof CSSAnimation && a.effect?.target?.closest?.('#wasted')) {
          a.pause();
          a.currentTime = 3000;
        }
      }
      const rect = (el) => {
        const b = el.getBoundingClientRect();
        return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, w: b.width, h: b.height };
      };
      const card = document.querySelector('#wasted .moment');
      const s = rect(card);
      const hits = [];
      for (const sel of clearOf) {
        for (const el of document.querySelectorAll(sel)) {
          const b = rect(el);
          if (b.w === 0 || b.h === 0 || getComputedStyle(el).visibility === 'hidden') continue;
          if (s.left < b.right && b.left < s.right && s.top < b.bottom && b.top < s.bottom) hits.push(`${sel} ${Math.round(b.left)},${Math.round(b.top)}–${Math.round(b.right)},${Math.round(b.bottom)}`);
        }
      }
      // Every line of the caption inside the card.
      const spill = [...card.querySelectorAll('figcaption > *, .moment-share')].filter((el) => {
        const b = rect(el);
        // (The button's own overflow is its bigger touch target.)
        return b.left < s.left - 1 || b.right > s.right + 1 || b.top < s.top - 1 || b.bottom > s.bottom + 1 || (el.tagName !== 'BUTTON' && el.scrollWidth > el.clientWidth + 1);
      });
      return {
        shot,
        wasted: !document.querySelector('#wasted').hidden,
        shown: !card.hidden && Number(getComputedStyle(card).opacity) > 0.9,
        caption: card.querySelector('figcaption').innerText.replace(/\s+/g, ' '),
        ready: !btn.disabled,
        inside: s.left >= 0 && s.right <= innerWidth && s.top >= 0 && s.bottom <= innerHeight,
        spill: spill.map((el) => el.tagName.toLowerCase()),
        hits,
        s,
      };
    },
    { clearOf: MOMENT_CLEAR_OF },
  );
  check(r.shot && r.shot.w > 0 && r.shot.w <= 800, `${label}: a stamp is photographed as it lands (${r.shot ? `${r.shot.w}×${r.shot.h}, copy ${r.shot.copy} ms` : 'none'})`);
  check(
    r.wasted && r.shown && r.ready && /NEIGHBOURHOOD WATCH three of the crew down/.test(r.caption) && r.inside && r.spill.length === 0,
    `${label}: WASTED shows the picture and caption inside the view (${Math.round(r.s.left)},${Math.round(r.s.top)} ${Math.round(r.s.w)}×${Math.round(r.s.h)}: "${r.caption}"${r.spill.length ? `; spills: ${r.spill.join(', ')}` : ''})`,
  );
  check(r.hits.length === 0, `${label}: the picture is clear of WASTED and the controls${r.hits.length ? ` (covers ${r.hits.join(', ')})` : ''}`);
  await page.screenshot({ path: path.join(opt.out, `${label}-moment.png`), timeout: 120000 });
  await page.evaluate(() => {
    window.__shareMode = 'ok';
    window.__shared = null;
    navigator.canShare = () => true;
    navigator.share = async (data) => {
      window.__shared = { files: data.files.map((f) => ({ name: f.name, type: f.type, size: f.size })), text: data.text };
      if (window.__shareMode === 'deny') throw new DOMException('Not allowed', 'NotAllowedError');
    };
  });
  const share = async (mode) => {
    await page.evaluate((m) => {
      window.__shareMode = m;
      document.querySelector('#wasted .moment-share span').textContent = 'SHARE';
    }, mode);
    await page.click('#wasted .moment-share', { timeout: 30000 });
    await page.waitForFunction(() => document.querySelector('#wasted .moment-share span').textContent !== 'SHARE', null, { timeout: 30000 });
    return page.evaluate(() => ({ said: document.querySelector('#wasted .moment-share span').textContent, shared: window.__shared }));
  };
  const ok = await share('ok');
  const f = ok.shared?.files ?? [];
  check(
    ok.said === 'SHARED' && f.length === 1 && f[0].type === 'image/jpeg' && /^curbside-neighbourhood-watch-.*\.jpg$/.test(f[0].name) && f[0].size > 5000 && ok.shared.text.startsWith('NEIGHBOURHOOD WATCH'),
    `${label}: SHARE sends the picture as a JPEG (${f.map((x) => `${x.name} ${Math.round(x.size / 1024)} KB`).join(', ') || 'nothing'})`,
  );
  check((await share('deny')).said === 'SAVED', `${label}: a refused share saves the picture instead`);
  const gone = await page.evaluate(() => {
    const u = window.__ub;
    u.testTools.timeScale = 1;
    u.fastForward(5);
    return { alive: u.player.alive, picture: u.moment.picture !== null, card: !document.querySelector('#wasted .moment').hidden };
  });
  check(gone.alive && !gone.picture && !gone.card, `${label}: the respawn lets the picture go (${JSON.stringify(gone)})`);
}

let server = null;
/** The profiles, slowest first, as --only names. */
const PROFILE_NAMES = ['desktop', '852x393', '852x340', 'pwa'];

/** --jobs N: build once, then run each profile as a child run, N at a time; each one's output is printed when it ends. */
async function runParallel(jobs) {
  if (opt.build) await run('npx', ['vite', 'build']);
  const queue = PROFILE_NAMES.map((name, i) => ({ name, port: Number(opt.port) + i }));
  const results = [];
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const t0 = Date.now();
      const argv = [process.argv[1], '--only', job.name, '--no-build', '--port', String(job.port), '--out', path.join(opt.out, job.name), '--scale', String(SCALE)];
      const out = [];
      const code = await new Promise((resolve) => {
        const p = spawn(process.execPath, argv, { env: process.env });
        p.stdout.on('data', (d) => out.push(d));
        p.stderr.on('data', (d) => out.push(d));
        p.on('exit', (c) => resolve(c ?? 1));
      });
      // Keep the checks and the summary; Chromium's stderr chatter goes.
      const text = Buffer.concat(out).toString().split('\n').filter((l) => !l.startsWith('[pid=')).join('\n');
      console.log(`\n=== ${job.name} (${seconds(t0)}) ===\n${text.trim()}`);
      results.push({ name: job.name, ok: code === 0 });
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(jobs, PROFILE_NAMES.length)) }, worker));
  const failed = results.filter((r) => !r.ok).map((r) => r.name);
  console.log(failed.length ? `\nSMOKE FAILED: ${failed.join(', ')} (${seconds(started)})` : `\nSMOKE OK, all profiles (${seconds(started)})`);
  process.exit(failed.length ? 1 : 0);
}
if (Number(opt.jobs) > 1 && !opt.only) await runParallel(Number(opt.jobs));

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
  ].filter(([label]) => !opt.only || label.includes(String(opt.only)));
  for (const [label, ctxOpt, saved] of profiles) {
    console.log(label);
    const t0 = Date.now();
    const ctx = await browser.newContext({ ...ctxOpt, serviceWorkers: 'block', acceptDownloads: true });
    const page = await ctx.newPage();
    const errors = watch(page, label);
    if (saved) await page.addInitScript((s) => localStorage.setItem('curbside.settings', JSON.stringify(s)), saved);
    try {
      await play(page, label, true, !!saved?.testTools);
      if (saved?.testTools) await bugReport(page, label);
      await stampCheck(page, label, false);
      await scannerCheck(page, label);
      // The phones: the Chaos Run's card and stars up too (stamps stay on there).
      if (label.startsWith('iphone')) await stampCheck(page, label, true);
      await observeCheck(page, label);
      if (label.startsWith('desktop')) await mapEditorCheck(page, label);
      await momentCheck(page, label);
    } catch (e) {
      check(false, `${label}: ${e.message.split('\n')[0]}`);
    }
    check(errors.length === 0, `${label}: no page or console errors${errors.length ? `\n      ${errors.join('\n      ')}` : ''}`);
    await ctx.close();
    console.log(`  ${label} took ${seconds(t0)}`);
  }

  if (!opt.only || opt.only === 'pwa') await pwaCheck();
} catch (e) {
  failures.push(e.message);
  console.error(e);
} finally {
  await browser?.close();
  server?.kill();
}

/** Installable, then offline once the service worker has precached: the cold open still plays. */
async function pwaCheck() {
  console.log('pwa');
  const t0 = Date.now();
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
    await play(page, 'pwa-offline', false);
  } catch (e) {
    check(false, `pwa-offline: ${e.message.split('\n')[0]}`);
  }
  check(errors.length === 0, `pwa: no page or console errors${errors.length ? `\n      ${errors.join('\n      ')}` : ''}`);
  await ctx.close();
  console.log(`  pwa took ${seconds(t0)}`);
}

console.log(failures.length ? `\nSMOKE FAILED: ${failures.length} check(s) (${seconds(started)})` : `\nSMOKE OK (${seconds(started)}, canvas at ${SCALE}×)`);
process.exit(failures.length ? 1 : 0);

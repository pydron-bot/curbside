/**
 * Offline audio rendering for the tuning tools: a headless Chromium page on
 * the dev server imports the game's own audio modules (Vite serves the
 * TypeScript), renders them on an OfflineAudioContext and hands back the
 * samples, written as WAV (and MP3 when ffmpeg is on PATH) with loudness
 * figures. Nothing plays, so it works headless and in the cloud.
 *
 * The page is driven by a setup function (source text, run in the page):
 *   async (ctx, mods, args) => ({ tick?(now), log?: string[] })
 * `mods` are the modules named in `modules` (key → path under src/). tick runs
 * every `tickEvery` seconds of audio time on the suspended context, like the
 * game's 25 ms timer, so schedulers book notes just ahead of the render (and
 * reap voices only once they have really played).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { launch } from './lib.mjs';

/** The dev server (`npm run dev`, base '/'). */
export const DEV_URL = process.env.URL ?? 'http://localhost:5173/';

export async function openAudioPage() {
  const browser = await launch();
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('pageerror:', e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') console.error('console:', m.text());
  });
  // Any URL on the dev server will do: only its origin matters, for the module imports.
  await page.goto(new URL('src/audio/synth.ts', DEV_URL).href);
  return { browser, page };
}

/**
 * Render `seconds` of audio. Returns { wav: Buffer, stats, log }: stats has the
 * overall and per-window ({ windows } seconds) RMS and peak in dBFS and the
 * count of clipped samples (|x| > 1).
 */
export async function renderOffline(page, { setup, modules, args = {}, seconds, rate = 44100, tickEvery = 0.025, window = 5 }) {
  const urls = Object.fromEntries(Object.entries(modules).map(([k, p]) => [k, new URL(p, DEV_URL).href]));
  const res = await page.evaluate(
    async ({ setupSrc, urls, args, seconds, rate, tickEvery, window }) => {
      const mods = {};
      for (const [k, url] of Object.entries(urls)) mods[k] = await import(url);
      const ctx = new OfflineAudioContext(2, Math.ceil(rate * seconds), rate);
      const setup = (0, eval)(`(${setupSrc})`);
      const job = (await setup(ctx, mods, args)) ?? {};
      // Suspend points land on render quanta (128 frames).
      const quantum = 128 / rate;
      const step = Math.max(quantum, Math.round(tickEvery / quantum) * quantum);
      const at = (t) => {
        if (t >= seconds - quantum) return;
        ctx.suspend(t).then(() => {
          at(t + step);
          job.tick(ctx.currentTime);
          ctx.resume();
        });
      };
      if (job.tick) at(step);
      const buf = await ctx.startRendering();

      const L = buf.getChannelData(0);
      const R = buf.getChannelData(1);
      const db = (x) => (x > 0 ? Math.round(20 * Math.log10(x) * 10) / 10 : -Infinity);
      const measure = (a, b) => {
        let sum = 0;
        let peak = 0;
        let clipped = 0;
        for (let i = a; i < b; i++) {
          const l = L[i];
          const r = R[i];
          sum += l * l + r * r;
          const p = Math.max(Math.abs(l), Math.abs(r));
          if (p > peak) peak = p;
          if (p > 1) clipped++;
        }
        return { rms: db(Math.sqrt(sum / Math.max(1, 2 * (b - a)))), peak: db(peak), clipped };
      };
      const n = L.length;
      const windows = [];
      const w = Math.round(window * rate);
      for (let a = 0; a < n; a += w) windows.push({ from: Math.round(a / rate), ...measure(a, Math.min(n, a + w)) });
      const stats = { overall: measure(0, n), windows };

      // 16-bit stereo WAV, base64 in chunks (big strings through btoa in one go fail).
      const bytes = new Uint8Array(44 + n * 4);
      const dv = new DataView(bytes.buffer);
      const str = (o, s) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
      str(0, 'RIFF');
      dv.setUint32(4, 36 + n * 4, true);
      str(8, 'WAVEfmt ');
      dv.setUint32(16, 16, true);
      dv.setUint16(20, 1, true);
      dv.setUint16(22, 2, true);
      dv.setUint32(24, rate, true);
      dv.setUint32(28, rate * 4, true);
      dv.setUint16(32, 4, true);
      dv.setUint16(34, 16, true);
      str(36, 'data');
      dv.setUint32(40, n * 4, true);
      for (let i = 0; i < n; i++) {
        dv.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i])) * 32767, true);
        dv.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i])) * 32767, true);
      }
      let b64 = '';
      for (let i = 0; i < bytes.length; i += 0x8000) b64 += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return { wav: btoa(b64), stats, log: job.log ?? [] };
    },
    { setupSrc: setup.toString(), urls, args, seconds, rate, tickEvery, window },
  );
  return { wav: Buffer.from(res.wav, 'base64'), stats: res.stats, log: res.log };
}

/** Write `name`.mp3 into `dir` (or .wav without ffmpeg, or with KEEP_WAV=1 as well). Returns the paths. */
export function writeAudio(dir, name, wav) {
  fs.mkdirSync(dir, { recursive: true });
  const wavPath = path.join(dir, `${name}.wav`);
  fs.writeFileSync(wavPath, wav);
  try {
    const mp3 = path.join(dir, `${name}.mp3`);
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', wavPath, '-codec:a', 'libmp3lame', '-b:a', '160k', mp3]);
    if (!process.env.KEEP_WAV) fs.unlinkSync(wavPath);
    return process.env.KEEP_WAV ? [mp3, wavPath] : [mp3];
  } catch {
    return [wavPath];
  }
}

/** "0:1,16:3,40:5" → [[0, 1], [16, 3], [40, 5]] */
export function parseScript(s) {
  return s.split(',').map((p) => p.split(':').map(Number));
}

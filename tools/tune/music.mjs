/**
 * Renders radio stations offline, to listen to and to level them against each
 * other without playing: each station through an intensity script (calm,
 * chase, full, calm again by default), written as MP3 (WAV without ffmpeg),
 * with the songs heard and RMS / peak per 5 s window.
 *
 *   npm run dev -- --port 5310 &
 *   URL=http://localhost:5310/ npx -y -p playwright@1.63.0 node tools/tune/music.mjs <out-dir> [station-id ...]
 *
 * Env: SECONDS (default 90), SCRIPT ("seconds:intensity,…", default
 * "0:1,24:3,48:5,72:0"), MODE ('game' or 'menu').
 */
import { DEV_URL, openAudioPage, parseScript, renderOffline, writeAudio } from './audioLib.mjs';

const [outDir = 'music-out', ...ids] = process.argv.slice(2);
const seconds = Number(process.env.SECONDS ?? 90);
const script = parseScript(process.env.SCRIPT ?? '0:1,24:3,48:5,72:0');
const mode = process.env.MODE ?? 'game';

const { browser, page } = await openAudioPage();
try {
  const all = ids.length
    ? ids
    : await page.evaluate(async (url) => (await import(url)).STATIONS.map((s) => s.id), new URL('src/audio/music/stations.ts', DEV_URL).href);
  for (const id of all) {
    const { wav, stats, log } = await renderOffline(page, {
      modules: { player: 'src/audio/music/musicPlayer.ts', synth: 'src/audio/synth.ts', stations: 'src/audio/music/stations.ts' },
      args: { id, script, mode },
      seconds,
      setup: async (ctx, { player, synth, stations }, { id, script, mode }) => {
        const station = stations.STATIONS.find((s) => s.id === id);
        if (!station) throw new Error(`no station '${id}' (have ${stations.STATIONS.map((s) => s.id).join(', ')})`);
        const music = new player.MusicPlayer(ctx, new synth.NoiseBank(ctx), ctx.destination, synth.makeImpulse(ctx), station);
        // The drum kit renders a take per task (setTimeout): let it finish so the kit, not the live voices, plays.
        await new Promise((r) => setTimeout(r, 2500));
        const log = [];
        music.onSong = (song) => log.push(`${ctx.currentTime.toFixed(1)}s  ${song.title} (${song.artist})`);
        const level = (t) => script.reduce((l, [s, v]) => (t >= s ? v : l), script[0][1]);
        const tick = (now) => {
          music.setIntensity(level(now));
          music.pump(now);
        };
        music.setMode(mode);
        tick(0);
        return { tick, log };
      },
    });
    const files = writeAudio(outDir, `${id}${mode === 'menu' ? '-menu' : ''}`, wav);
    const o = stats.overall;
    console.log(`\n${id}: ${files.join(', ')}\n  overall RMS ${o.rms} dBFS, peak ${o.peak} dBFS, clipped ${o.clipped}`);
    for (const line of log) console.log(`  ${line}`);
    console.log(`  per 5 s RMS: ${stats.windows.map((w) => w.rms).join(' ')}`);
  }
} finally {
  await browser.close();
}

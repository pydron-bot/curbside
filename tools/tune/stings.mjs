/**
 * Renders the title theme and the stings built on its hook offline, to listen
 * to and to level them without playing: written as MP3 (WAV without ffmpeg)
 * with RMS / peak per window, at the voice levels the game plays them at
 * (raw: no bus, glue compressor or limiter after them, like music.mjs).
 *
 *   npm run dev -- --port 5310 &
 *   URL=http://localhost:5310/ npx -y -p playwright@1.63.0 node tools/tune/stings.mjs <out-dir> [name ...]
 *
 * Names: theme, wasted, busted, mission-start, mission-passed, mission-failed,
 * count-in (the 3-2-1-GO at the real 1 s spacing), count-in-radio (the same
 * over the radio at the game's music / SFX balance: ducked under the count,
 * dropping in on GO). Default: all of them.
 * Env: SECONDS (the theme, default 60), KEY (the music's key as a MIDI note,
 * default 45 = A), INDEX (the payphone job, default 0), RADIO (the station
 * under count-in-radio, default nightdrive), MAJOR (1: the stings in a major
 * key, as over INSERT COIN; 0: minor, even over a major song; unset: minor
 * for KEY, and count-in-radio follows the radio's song like the game).
 */
import { openAudioPage, renderOffline, writeAudio } from './audioLib.mjs';

const NAMES = ['theme', 'wasted', 'busted', 'mission-start', 'mission-passed', 'mission-failed', 'count-in', 'count-in-radio'];
const [outDir = 'stings-out', ...asked] = process.argv.slice(2);
const names = asked.length ? asked : NAMES;
for (const n of names) if (!NAMES.includes(n)) throw new Error(`no '${n}' (have ${NAMES.join(', ')})`);
const key = Number(process.env.KEY ?? 45);
const index = Number(process.env.INDEX ?? 0);
const radio = process.env.RADIO ?? 'nightdrive';
const themeSeconds = Number(process.env.SECONDS ?? 60);
const major = process.env.MAJOR === undefined || process.env.MAJOR === '' ? null : process.env.MAJOR === '1';

const modules = {
  player: 'src/audio/music/musicPlayer.ts',
  synth: 'src/audio/synth.ts',
  sfx: 'src/audio/sfx.ts',
  stings: 'src/audio/music/stings.ts',
  themes: 'src/audio/music/themes.ts',
  stations: 'src/audio/music/stations.ts',
};
const SECONDS = { theme: themeSeconds, wasted: 5.5, busted: 4.5, 'mission-start': 3.5, 'mission-passed': 4.5, 'mission-failed': 3.5, 'count-in': 5.5, 'count-in-radio': 14 };

const { browser, page } = await openAudioPage();
try {
  for (const name of names) {
    const seconds = SECONDS[name];
    const { wav, stats, log } = await renderOffline(page, {
      modules,
      args: { name, key, index, radio, major },
      seconds,
      window: name === 'theme' ? 5 : 0.5,
      setup: async (ctx, { player, synth, sfx, stings, themes, stations }, { name, key, index, radio, major }) => {
        const bank = new synth.NoiseBank(ctx);
        const impulse = synth.makeImpulse(ctx);
        const log = [];
        const station = stations.STATIONS.find((s) => s.id === radio);
        if (!station) throw new Error(`no station '${radio}'`);
        // The game's bus balance at the default sliders, in a car: music 0.5² × 1.4, SFX 0.9² (SFX scaled to 1).
        const sfxBus = ctx.createGain();
        sfxBus.connect(ctx.destination);
        const musicBus = ctx.createGain();
        musicBus.gain.value = name === 'count-in-radio' ? (0.25 * 1.4) / 0.81 : 1;
        musicBus.connect(ctx.destination);
        // A player for the theme, the radio, or just the radio's drum kit the stings borrow.
        const music = new player.MusicPlayer(ctx, bank, musicBus, impulse, station);
        await new Promise((r) => setTimeout(r, 2500)); // the kit renders a take per task
        const kit = (part) => music.kitTake(part);
        const voices = [];
        const voice = (at, level) => {
          const v = new synth.Voice(ctx, bank, at, level);
          v.out.connect(sfxBus);
          voices.push(v);
          return v;
        };
        const report = () => voices.forEach((v) => log.push(`${v.t.toFixed(2)}s  voice of ${v.nodes.length} nodes, ${(v.end - v.t).toFixed(2)} s`));
        const L = stings.STING_LEVELS;
        if (name === 'theme') {
          music.setTheme(themes.THEME);
          music.onSong = (song, st) => log.push(`${ctx.currentTime.toFixed(1)}s  ${song.title} (${st.name})`);
          let section = '';
          const tick = (now) => {
            music.pump(now);
            const s = music.arranger.section;
            if (s !== section) {
              section = s;
              log.push(`${now.toFixed(1)}s  ${s}`);
            }
          };
          music.setMode('menu');
          tick(0);
          return { tick, log };
        }
        if (name === 'wasted') sfx.wasted(voice(0.05, L.wasted), key);
        else if (name === 'busted') sfx.busted(voice(0.05, L.busted), key);
        else if (name === 'mission-start') sfx.playSting(voice(0.05, L.missionStart), stings.missionStartSting(key, index, !!major), kit);
        else if (name === 'mission-passed') sfx.playSting(voice(0.05, L.missionPassed), stings.missionPassedSting(key, index), kit);
        else if (name === 'mission-failed') sfx.playSting(voice(0.05, L.missionFailed), stings.missionFailedSting(key, index, !!major), kit);
        else if (name === 'count-in') {
          for (const n of [3, 2, 1, 0]) sfx.playSting(voice(0.3 + (3 - n) * stings.COUNT_SPACING + (n === 0 ? 0.03 : 0), L.countIn), stings.countInSting(n, key, !!major), kit);
        } else {
          // The radio cruising at intensity 1, then the count from 6 s: as GameAudio.countIn drives it.
          const counts = [3, 2, 1, 0].map((n) => ({ n, at: 6 + (3 - n) * stings.COUNT_SPACING }));
          const tick = (now) => {
            while (counts.length && counts[0].at <= now) {
              const { n } = counts.shift();
              const v = voice(now + 0.005 + (n === 0 ? 0.03 : 0), L.countIn);
              const inMajor = major ?? music.arranger.major;
              if (n === 3) log.push(`${now.toFixed(2)}s  counting in over ${music.arranger.song.title} in ${music.arranger.key} ${inMajor ? 'major' : 'minor'}`);
              sfx.playSting(v, stings.countInSting(n, music.arranger.key, inMajor), kit);
              report();
              voices.length = 0;
              if (n > 0) music.duck(0.3, 0.3, 1.25);
              else {
                music.dropIn(v.t, 4);
                music.pump(now);
                log.push(`${now.toFixed(2)}s  GO: dropped in at intensity ${music.arranger.intensity}, ${music.arranger.section}`);
              }
            }
            music.setIntensity(now < 9 ? 1 : 4);
            music.pump(now);
          };
          music.setMode('game');
          tick(0);
          return { tick, log };
        }
        report();
        return { log };
      },
    });
    const base = name === 'mission-start' || name === 'mission-passed' || name === 'mission-failed' ? `${name}-${index}` : name;
    const files = writeAudio(outDir, `${base}${major ? '-major' : ''}`, wav);
    const o = stats.overall;
    console.log(`\n${name}: ${files.join(', ')}\n  overall RMS ${o.rms} dBFS, peak ${o.peak} dBFS, clipped ${o.clipped}, non-finite ${o.nonFinite}`);
    for (const line of log) console.log(`  ${line}`);
    console.log(`  per ${name === 'theme' ? 5 : 0.5} s RMS: ${stats.windows.map((w) => w.rms).join(' ')}`);
    console.log(`  per ${name === 'theme' ? 5 : 0.5} s peak: ${stats.windows.map((w) => w.peak).join(' ')}`);
  }
} finally {
  await browser.close();
}

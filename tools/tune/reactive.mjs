/**
 * Renders the music that reacts to play offline, to listen to and to level
 * without playing (raw music output, like music.mjs):
 *
 *   chase    the radio cruising, then a chase: wanted 3 (the chase comes in
 *            on a bar line), 4, 5, lost (it calms down and hands back to the
 *            radio's next song). SCRIPT "seconds:stars,…" (default
 *            "0:1,16:3,34:4,52:5,70:0"), RADIO (default nightdrive).
 *   on-foot  a walk past a parked car, a shopfront and a VIPERS hangout's
 *            boombox, through the street chain GameAudio uses on foot
 *            (emitter choice, distance gain, muffle, pan, quiet retunes), the
 *            boombox cut with its record scratch at the end. The walk is
 *            simulated distances; levels are against the in-car radio (1).
 *
 *   npm run dev -- --port 5313 &
 *   URL=http://localhost:5313/ npx -y -p playwright@1.63.0 node tools/tune/reactive.mjs <out-dir> [chase|on-foot ...]
 *
 * Env: SECONDS (chase 90, on-foot 45).
 */
import { openAudioPage, parseScript, renderOffline, writeAudio } from './audioLib.mjs';

const NAMES = ['chase', 'on-foot'];
const [outDir = 'reactive-out', ...asked] = process.argv.slice(2);
const names = asked.length ? asked : NAMES;
for (const n of names) if (!NAMES.includes(n)) throw new Error(`no '${n}' (have ${NAMES.join(', ')})`);
const script = parseScript(process.env.SCRIPT ?? '0:1,16:3,34:4,52:5,70:0');
const radio = process.env.RADIO ?? 'nightdrive';

const modules = {
  player: 'src/audio/music/musicPlayer.ts',
  synth: 'src/audio/synth.ts',
  stations: 'src/audio/music/stations.ts',
  chase: 'src/audio/music/chase.ts',
  street: 'src/audio/streetMusic.ts',
  loops: 'src/audio/loops.ts',
  sfx: 'src/audio/sfx.ts',
};

const { browser, page } = await openAudioPage();
try {
  for (const name of names) {
    const seconds = Number(process.env.SECONDS ?? (name === 'chase' ? 90 : 45));
    const { wav, stats, log } = await renderOffline(page, {
      modules,
      args: { name, script, radio },
      seconds,
      setup: async (ctx, { player, synth, stations, chase, street, loops, sfx }, { name, script, radio }, { warmKits }) => {
        const bank = new synth.NoiseBank(ctx);
        const impulse = synth.makeImpulse(ctx);
        const log = [];
        const index = stations.STATIONS.findIndex((s) => s.id === radio);
        if (index < 0) throw new Error(`no station '${radio}'`);
        if (name === 'chase') {
          const music = new player.MusicPlayer(ctx, bank, ctx.destination, impulse, stations.STATIONS[index]);
          // The drum kits render a take per task: all in first, so the kits (not the live voices) play every time.
          await warmKits(music, [chase.CHASE.station.sound]);
          const cue = new chase.ChaseMusic();
          music.onSong = (song, st) => log.push(`${ctx.currentTime.toFixed(1)}s  ${song.title} (${st.name})`);
          let stars = 0;
          let section = '';
          const tick = (now) => {
            for (const [at, level] of script) {
              if (at > now || level === stars || now - at > 0.05) continue;
              const prev = stars;
              stars = level;
              const c = cue.wanted(level, level === 0 ? 'evaded' : level > prev ? 'crime' : 'lost');
              log.push(`${now.toFixed(1)}s  wanted ${level}${c ? ` → ${c}` : ''}`);
              if (c === 'start') music.setScore(chase.CHASE);
              else if (c === 'end') music.endScore();
            }
            // As GameAudio: the wanted level is the floor; cruising in a car keeps it at 1 or more.
            music.setIntensity(Math.max(stars, 1));
            music.pump(now);
            const s = `${music.station.id} ${music.arranger.section} i${music.arranger.intensity} ${music.arranger.bpm} BPM`;
            if (s !== section) {
              section = s;
              log.push(`${now.toFixed(1)}s  ${s}`);
            }
          };
          music.setMode('game');
          tick(0);
          return { tick, log };
        }

        // On foot: the street chain between the music and the output, as in GameAudio.
        const chain = new loops.StreetChain(ctx, bank, ctx.destination, ctx.currentTime);
        const music = new player.MusicPlayer(ctx, bank, chain.input, impulse, stations.STATIONS[index]);
        await warmKits(music, stations.STATIONS.map((s) => s.sound));
        const mix = new street.StreetMusic();
        const ids = (id) => stations.STATIONS.findIndex((s) => s.id === id);
        // Walking east along a pavement at 1.6 m/s: a parked car (its radio on GETAWAY), a shop (LOW TIDE), then a
        // VIPERS boombox (SIDEWAYS), which is cut at 40 s. Emitters sit a few metres to the side of the walk.
        const car = { x: 8, z: 2.5, station: ids('getaway') };
        const shop = { x: 26, z: -3.5, station: ids('lowtide') };
        const box = { x: 58, z: 4, station: ids('sideways') };
        let boxOn = true;
        let last = '';
        let nextLine = 0;
        let wait = 0;
        const tick = (now) => {
          const x = -6 + now * 1.6;
          if (boxOn && now >= 40) {
            boxOn = false;
            const v = new synth.Voice(ctx, bank, now + 0.01, 0.6 * street.emitterGain('boombox', Math.hypot(box.x - x, box.z)));
            v.out.connect(ctx.destination);
            sfx.recordScratch(v);
            mix.cut();
            log.push(`${now.toFixed(1)}s  the boombox is cut (scratch)`);
          }
          wait -= 0.025;
          if (wait <= 0) {
            wait = 0.2;
            mix.begin(x, 0);
            mix.offer('car', car.station, car.x, car.z);
            mix.offer('shop', shop.station, shop.x, shop.z);
            if (boxOn) mix.offer('boombox', box.station, box.x, box.z);
            // By id: the dev server can hand this page a second copy of a module it has reloaded.
            mix.end(0.2, ids(music.station.id));
            if (mix.tune >= 0 && music.arranger.radio.id !== stations.STATIONS[mix.tune].id) music.tune(mix.tune, true);
            music.setDormant(mix.dormant);
            chain.apply(mix.gain, mix.cutoff, mix.pan, mix.tau, now);
            // A line when what's heard changes, and every 2 s.
            const what = `${mix.kind ?? 'nothing'} ${mix.station >= 0 ? stations.STATIONS[mix.station].id : '-'} heard ${music.station.id}${mix.dormant ? ' dormant' : ''}`;
            if (what !== last || now >= nextLine) {
              nextLine = now + 2;
              log.push(`${now.toFixed(1)}s  x ${x.toFixed(1)}  ${what}  gain ${mix.gain.toFixed(3)} cutoff ${Math.round(mix.cutoff)} pan ${mix.pan.toFixed(2)}`);
            }
            last = what;
          }
          music.pump(now);
        };
        music.setIntensity(0);
        music.setMode('game');
        tick(0);
        return { tick, log };
      },
    });
    const files = writeAudio(outDir, name, wav);
    const o = stats.overall;
    console.log(`\n${name}: ${files.join(', ')}\n  overall RMS ${o.rms} dBFS, peak ${o.peak} dBFS, clipped ${o.clipped}, non-finite ${o.nonFinite}`);
    for (const line of log) console.log(`  ${line}`);
    console.log(`  per 5 s RMS: ${stats.windows.map((w) => w.rms).join(' ')}`);
    console.log(`  per 5 s peak: ${stats.windows.map((w) => w.peak).join(' ')}`);
  }
} finally {
  await browser.close();
}

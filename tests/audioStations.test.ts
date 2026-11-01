import { describe, expect, it } from 'vitest';
import { KIT_LEVEL, Lfsr, kitJobs, kitKey, renderKit, type KitPart } from '../src/audio/music/drumKit';
import { Arranger, FORM_BARS, STEPS_PER_BAR, hitVelocity, rollCount, targetBpm, type NoteEvent } from '../src/audio/music/sequencer';
import { STATIONS, type Station, type Tier } from '../src/audio/music/stations';
import { CHORD_SHAPES } from '../src/audio/music/theory';
import { pulseWave, reedWave, steppedTriangle } from '../src/audio/music/waves';

function play(a: Arranger, bars: number): NoteEvent[][] {
  const out: NoteEvent[][] = [];
  const ev: NoteEvent[] = [];
  for (let i = 0; i < bars * STEPS_PER_BAR; i++) {
    a.next(ev);
    out.push(ev.map((e) => ({ ...e })));
  }
  return out;
}
const of = (steps: NoteEvent[][], part: string) => steps.flat().filter((e) => e.part === part);
const byId = (id: string) => STATIONS.find((s) => s.id === id)!;
/** A station whose every tier is `tier` (tests the pattern language on its own). */
const withTier = (tier: Tier, base: Station = STATIONS[0]): Station => ({ ...base, tiers: [tier, tier, tier, tier, tier, tier] });
const LOOP = { form: false };

describe('the seven stations', () => {
  it('keep the first three where they were (the saved station is an index)', () => {
    expect(STATIONS.map((s) => s.id)).toEqual(['nightdrive', 'breakneck', 'lowtide', 'sideways', 'getaway', 'dubwise', 'insertcoin']);
  });

  it('are complete and distinct: names that fit the card, four songs with unique titles, keys that agree', () => {
    const titles = new Set<string>();
    expect(new Set(STATIONS.map((s) => s.id)).size).toBe(STATIONS.length);
    expect(new Set(STATIONS.map((s) => s.name)).size).toBe(STATIONS.length);
    for (const s of STATIONS) {
      expect(s.name.length, s.name).toBeLessThanOrEqual(14);
      expect(s.tiers).toHaveLength(6);
      expect(s.menu).toBeDefined();
      expect(s.songs, s.id).toHaveLength(4);
      expect(((s.leadTonic - s.key) % 12 + 12) % 12, s.id).toBe(0);
      expect(s.sound.trim).toBeGreaterThan(0.5);
      expect(s.sound.trim).toBeLessThan(1.5);
      for (const song of s.songs) {
        expect(titles.has(song.title), song.title).toBe(false);
        titles.add(song.title);
        expect(song.artist.length).toBeGreaterThan(0);
        expect(Math.abs(song.transpose)).toBeLessThanOrEqual(5);
        expect(song.verse).toHaveLength(8);
        expect(song.chorus).toHaveLength(8);
        for (const ch of [...song.verse, ...song.chorus!]) expect(CHORD_SHAPES[ch.quality], `${s.id} ${song.title}`).toBeDefined();
      }
      // Calm < chase < full, menus under calm.
      expect(targetBpm(s, 0, 'menu')).toBeLessThan(targetBpm(s, 0, 'game'));
      expect(targetBpm(s, 3, 'game')).toBeLessThan(targetBpm(s, 5, 'game'));
    }
  });

  it('write patterns only in their own language, and never start a bar holding a note', () => {
    for (const s of STATIONS) {
      for (const tier of [...s.tiers, s.menu]) {
        for (const p of [tier.kick, tier.snare, tier.clap, tier.hat, tier.openHat, tier.perc]) if (p) expect(p, s.id).toMatch(/^[xort.]{16}$/);
        for (const p of [tier.keys, tier.arp]) if (p) expect(p, s.id).toMatch(/^[xo.]{16}$/);
        if (tier.bass) {
          expect(tier.bass, s.id).toMatch(/^[xo5347g.\-~]{16}$/);
          expect(tier.bass[0], s.id).not.toMatch(/[-~]/);
          // A slide has a note to slide into: '~' is followed by a note (or ends the bar).
          for (let i = 0; i < 15; i++) if (tier.bass[i] === '~') expect(tier.bass[i + 1], s.id).toMatch(/[xo5347g]/);
        }
      }
      // The menu arrangement is drumless.
      for (const p of [s.menu.kick, s.menu.snare, s.menu.clap, s.menu.perc]) expect(p).toBeUndefined();
    }
  });

  it('keep every song’s bass in a sane range, through the whole form at every intensity', () => {
    for (const s of STATIONS) {
      expect(s.bassLow).toBeGreaterThanOrEqual(28);
      for (const level of [1, 3, 5]) {
        const a = new Arranger(s);
        a.setIntensity(level);
        for (let song = 0; song < s.songs.length; song++) {
          for (const e of of(play(a, FORM_BARS), 'bass')) {
            expect(e.note, s.id).toBeGreaterThanOrEqual(s.bassLow);
            expect(e.note, s.id).toBeLessThan(Math.min(64, s.bassLow + 24));
          }
        }
      }
    }
  });

  it('sound like their genres', () => {
    const phonk = byId('sideways');
    expect(phonk.sound).toMatchObject({ bass: '808', arp: 'cowbell', lead: 'cowbell', arpYields: true });
    expect(phonk.sound.drive).toBeGreaterThan(1);
    expect(phonk.tiers[3].bass).toContain('~');
    expect(phonk.tiers[3].hat).toMatch(/[rt]/);

    const funk = byId('getaway');
    expect(funk.sound).toMatchObject({ bass: 'slap', keys: 'wah', lead: 'brass' });
    expect(funk.tiers[3].kick).toBe('x...x...x...x...'); // four on the floor
    expect(funk.tiers[3].openHat).toBe('..x...x...x...x.'); // off-beat open hats
    expect(funk.tiers[3].bass).toContain('g');

    const dub = byId('dubwise');
    expect(dub.sound).toMatchObject({ bass: 'sub', keys: 'skank', lead: 'melodica', snare: 'rimshot' });
    expect(dub.tiers[2].kick).toBe('........x.......'); // the one drop: kick and rim on beat 3 only
    expect(dub.tiers[2].snare).toBe('........x.......');
    expect(dub.tiers[0].keys).toBe('....x.......x...'); // skanks on 2 and 4
    expect(dub.sound.echoFeedback!).toBeGreaterThan(0.36);
    expect(dub.sound.throws!).toBeGreaterThan(0);

    const chip = byId('insertcoin');
    expect(chip.sound).toMatchObject({ bass: 'tri', arp: 'pulse', lead: 'pulse', kick: 'chip', snare: 'chip', hat: 'chip' });
    expect(chip.bpm[0]).toBeGreaterThanOrEqual(140);
  });

  it('have a hook in the calm: the phonk cowbell and the reggae skank play from intensity 0', () => {
    const calm = (s: Station, part: 'arp' | 'keys') => {
      const a = new Arranger(s, LOOP);
      return of(play(a, 2), part).length;
    };
    expect(calm(byId('sideways'), 'arp')).toBeGreaterThan(0);
    expect(calm(byId('dubwise'), 'keys')).toBe(4);
  });
});

describe('pattern language: slides, ghosts, fourths, rolls', () => {
  it('reads rolls in drum patterns', () => {
    expect(rollCount('xrt.', 0)).toBe(1);
    expect(rollCount('xrt.', 1)).toBe(2);
    expect(rollCount('xrt.', 2)).toBe(3);
    expect(rollCount(undefined, 0)).toBe(1);
    expect(hitVelocity('xrt.', 1)).toBeGreaterThan(0.5);
    expect(hitVelocity('xrt.', 2)).toBeGreaterThan(0.5);
    const a = new Arranger(withTier({ hat: 'x.r.t...........', cutoff: 2000 }), LOOP);
    const hats = of(play(a, 1), 'hat');
    expect(hats.map((e) => e.roll ?? 1)).toEqual([1, 2, 3]);
  });

  it('parses slides and ties, ghosts and fourths in a bass line', () => {
    const a = new Arranger(withTier({ bass: 'x--~o--.5-~4...g', cutoff: 2000 }), LOOP);
    const bass = of(play(a, 1), 'bass');
    const root = bass[0].note;
    expect(bass.map((e) => e.note - root)).toEqual([0, 12, 7, 5, 0]);
    expect(bass.map((e) => e.len)).toEqual([4, 3, 3, 1, 1]);
    expect(bass.map((e) => e.tie)).toEqual([true, false, true, false, false]);
    expect(bass.map((e) => e.slide)).toEqual([false, true, false, true, false]);
    expect(bass[4].vel).toBeLessThan(0.5); // the ghost
    expect(bass[0].vel).toBe(1);
  });

  it('slides across the bar line from a "~" on the last step, and only into the very next note', () => {
    const a = new Arranger(withTier({ bass: 'x--------------~', cutoff: 2000 }), LOOP);
    const bars = play(a, 2);
    const bass = of(bars, 'bass');
    expect(bass).toHaveLength(2);
    expect(bass[0]).toMatchObject({ len: 16, tie: true, slide: false });
    expect(bass[1]).toMatchObject({ slide: true });
    // A rest between breaks the tie.
    const b = new Arranger(withTier({ bass: 'x-~.x...........', cutoff: 2000 }), LOOP);
    expect(of(play(b, 1), 'bass').map((e) => e.slide)).toEqual([false, false]);
  });

  it('forgets a tie when the music restarts or retunes', () => {
    const a = new Arranger(withTier({ bass: 'x--------------~', cutoff: 2000 }), LOOP);
    play(a, 1);
    a.restart();
    expect(of(play(a, 1), 'bass')[0].slide).toBe(false);
  });

  it('a yielding arp rests under lead notes and fills the gaps between them, keeping its riff in step', () => {
    const phonk = byId('sideways');
    const tier: Tier = { arp: 'xxxxxxxxxxxxxxxx', lead: true, cutoff: 2000 };
    const yields = new Arranger(withTier(tier, phonk), LOOP);
    const plain = new Arranger(withTier(tier, { ...phonk, sound: { ...phonk.sound, arpYields: false } }), LOOP);
    const ys = play(yields, 8);
    const ps = play(plain, 8);
    let sounding = 0;
    let gaps = 0;
    for (let i = 0; i < ys.length; i++) {
      const lead = ys[i].find((e) => e.part === 'lead');
      if (lead) sounding = lead.len;
      const arp = ys[i].find((e) => e.part === 'arp');
      if (sounding > 0) expect(arp, `step ${i}`).toBeUndefined();
      else {
        gaps++;
        // Same note the riff would play there without yielding.
        expect(arp?.note).toBe(ps[i].find((e) => e.part === 'arp')?.note);
      }
      sounding--;
    }
    expect(gaps).toBeGreaterThan(0);
  });

  it('knows the last bar of each section (dub throws its echo there)', () => {
    const a = new Arranger(STATIONS[0]);
    const last: number[] = [];
    const ev: NoteEvent[] = [];
    for (let bar = 0; bar < FORM_BARS; bar++) {
      a.next(ev); // step 0 starts the bar
      if (a.lastBar) last.push(bar);
      for (let i = 1; i < STEPS_PER_BAR; i++) a.next(ev);
    }
    expect(last).toEqual([3, 11, 19, 23, 31, 35]);
  });
});

describe('new drum timbres', () => {
  const RATE = 48000;
  const peak = (b: Float32Array) => b.reduce((m, x) => Math.max(m, Math.abs(x)), 0);

  it('the chip kit, the rimshot and the hard kick render finite at their level', () => {
    for (const id of ['sideways', 'dubwise', 'insertcoin']) {
      const kit = renderKit(byId(id).sound, RATE);
      for (const part of Object.keys(KIT_LEVEL) as KitPart[]) {
        for (const take of kit[part]) {
          expect(take.every(Number.isFinite), `${id} ${part}`).toBe(true);
          expect(peak(take)).toBeLessThanOrEqual(KIT_LEVEL[part] + 1e-6);
          expect(peak(take)).toBeGreaterThan(KIT_LEVEL[part] * 0.9);
        }
      }
    }
  });

  it('renders each take quickly enough to do between frames', () => {
    for (const id of ['sideways', 'dubwise', 'insertcoin']) {
      let worst = 0;
      for (const job of kitJobs(byId(id).sound, RATE)) {
        const t0 = performance.now();
        job.run();
        worst = Math.max(worst, performance.now() - t0);
      }
      expect(worst, id).toBeLessThan(25);
    }
  });

  it('the noise channel repeats every 93 steps in short mode and 32767 in long mode', () => {
    const period = (short: boolean) => {
      const l = new Lfsr(1, short, 1);
      const seq: number[] = [];
      for (let i = 0; i < 70000; i++) seq.push(l.step());
      for (const p of [93, 32767]) if (seq.slice(0, 500).every((x, i) => x === seq[i + p])) return p;
      return -1;
    };
    expect(period(true)).toBe(93);
    expect(period(false)).toBe(32767);
  });

  it('the chip hat is the bright one and the chip kick the low one', () => {
    const kit = renderKit(byId('insertcoin').sound, RATE);
    const zc = (b: Float32Array) => {
      let n = 0;
      for (let i = 1; i < b.length; i++) if (b[i - 1] < 0 !== b[i] < 0) n++;
      return (n / b.length) * RATE;
    };
    expect(zc(kit.hat[0])).toBeGreaterThan(4000);
    expect(zc(kit.kick[0].slice(Math.round(RATE * 0.06)))).toBeLessThan(300);
  });

  it('caches kits by a key that covers everything the kit depends on', () => {
    const keys = STATIONS.map((s) => kitKey(s.sound));
    // Every station's kit differs here, so every key must too.
    expect(new Set(keys).size).toBe(STATIONS.length);
    // Same key → the same kit; a field the old key ignored (the kick's character) changes both.
    const base = STATIONS[1].sound;
    const hard = { ...base, kick: 'hard' as const };
    expect(kitKey(hard)).not.toBe(kitKey(base));
    const a = renderKit(base, RATE).kick[0];
    const b = renderKit(hard, RATE).kick[0];
    expect(Array.from(a.slice(0, 200))).not.toEqual(Array.from(b.slice(0, 200)));
    expect(Array.from(renderKit({ ...base, trim: 0.1, lead: 'flute' }, RATE).snare[1])).toEqual(Array.from(renderKit(base, RATE).snare[1]));
    expect(kitKey({ ...base, trim: 0.1, lead: 'flute' })).toBe(kitKey(base));
  });
});

describe('custom oscillator shapes', () => {
  it('a square pulse has no even harmonics; a quarter pulse misses every 4th', () => {
    const sq = pulseWave(0.5, 16);
    for (let n = 2; n <= 16; n += 2) expect(Math.abs(sq.real[n])).toBeLessThan(1e-6);
    expect(Math.abs(sq.real[1])).toBeCloseTo(2 / Math.PI, 5);
    const q = pulseWave(0.25, 16);
    for (let n = 4; n <= 16; n += 4) expect(Math.abs(q.real[n])).toBeLessThan(1e-6);
    expect(Math.abs(q.real[2])).toBeGreaterThan(0.1);
  });

  it('the stepped triangle is a triangle at heart, with the steps’ buzz up high', () => {
    const t = steppedTriangle(48);
    const amp = (n: number) => Math.hypot(t.real[n], t.imag[n]);
    expect(amp(1)).toBeGreaterThan(0.7);
    expect(amp(3) / amp(1)).toBeCloseTo(1 / 9, 1); // a triangle's 1/n² odd harmonics
    expect(amp(2)).toBeLessThan(0.01);
    // A smooth triangle's 31st harmonic is 1/961 of the fundamental; the 32 steps put far more there.
    expect(amp(31) / amp(1)).toBeGreaterThan(0.01);
    for (const x of [...t.real, ...t.imag]) expect(Number.isFinite(x)).toBe(true);
  });

  it('the reed has every harmonic, odd ones stronger', () => {
    const r = reedWave(16);
    for (let n = 1; n <= 16; n++) expect(r.imag[n]).toBeGreaterThan(0);
    expect(r.imag[3]).toBeGreaterThan(r.imag[2]);
    expect(r.imag[7]).toBeGreaterThan(r.imag[8]);
  });
});

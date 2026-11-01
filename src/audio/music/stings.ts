/**
 * The game's stings, built on the title theme's hook (themes.ts), as scores:
 * timed lead and bass notes, chords, drum hits, a riser and a tape-stop sag,
 * in seconds from the sting's start. Worked out here (pure, unit-tested) and
 * played by sfx.playSting on a handful of small synths. Each takes the key
 * the music is in (any octave), so it lands in tune with the radio it cuts
 * across. The hook is minor; the stings the radio plays on under or after
 * (the count-in, a job starting or failing) also take the song's mode
 * (Arranger.major), so a major song gets major chords, not a minor third
 * rubbing against its own. WASTED and BUSTED stop the music: minor always.
 */
import { HOOK } from './themes';
import { fold } from './theory';

export type StingLead = 'saw' | 'square' | 'flute';
export type StingDrum = 'kick' | 'snare' | 'clap' | 'hat' | 'crash';

export interface StingNote {
  /** Start, s. */
  t: number;
  /** MIDI note. */
  note: number;
  /** Length, s. */
  len: number;
  /** 0..1 */
  vel: number;
  /** Portamento into this note, s (time constant; mono parts only). */
  glide?: number;
}

export interface StingChord {
  t: number;
  notes: readonly number[];
  len: number;
  vel: number;
}

export interface StingHit {
  t: number;
  part: StingDrum;
  vel: number;
}

/** A sweep up (noise and a saw): pitch `from` → `to` (MIDI), level `level[0]` → `level[1]`. */
export interface StingRiser {
  t: number;
  len: number;
  from: number;
  to: number;
  level: readonly [number, number];
}

export interface Sting {
  lead: StingLead;
  /** The lead's notes (one voice: a new note takes over from the last). */
  melody: StingNote[];
  /** The bass's notes (one voice too). */
  bass: StingNote[];
  chords: StingChord[];
  drums: StingHit[];
  riser: StingRiser | null;
  /** Everything pitched slides `semis` over `len` from `t`: a dying tape machine. */
  sag: { t: number; len: number; semis: number } | null;
  /** Echo on the lead, s (0: dry). */
  echo: number;
  /** When the last sound has rung out, s. */
  length: number;
}

/** Seconds per 16th at `bpm`. */
export const sixteenth = (bpm: number) => 15 / bpm;

/** Where each part sits for a key: the lead's tonic (the hook climbs an octave above it), the chords' root, the bass. */
export const leadTonic = (key: number) => fold(key, 64);
export const chordRoot = (key: number) => fold(key, 55);
export const bassRoot = (key: number) => fold(key, 36);

const MINOR = [0, 3, 7];
const MAJOR = [0, 4, 7];
const chord = (root: number, shape: readonly number[], octave = false) => (octave ? [...shape, 12] : shape).map((s) => root + s);

/** The hook's notes `from`..`to` (indices into HOOK) on `tonic`, a 16th lasting `s16`, from `t0`. `map` re-spells degrees (major). */
export function hookNotes(tonic: number, s16: number, t0: number, from = 0, to = HOOK.length, vel = 1, map: (degree: number) => number = (d) => d): StingNote[] {
  const first = HOOK[from].step;
  return HOOK.slice(from, to).map((m) => ({ t: t0 + (m.step - first) * s16, note: tonic + map(m.degree), len: m.len * s16, vel }));
}

/** The hook in the parallel major: the minor third and sixth raised. */
const major = (d: number) => (d % 12 === 3 || d % 12 === 8 ? d + 1 : d);
/** The hook as written, for a minor key, or re-spelled for a major one. */
const spelled = (inMajor: boolean) => (inMajor ? major : undefined);

const empty = (lead: StingLead): Sting => ({ lead, melody: [], bass: [], chords: [], drums: [], riser: null, sag: null, echo: 0, length: 0 });

/** Make the score's length cover everything in it (plus `ring` s of tail). */
function finish(s: Sting, ring: number): Sting {
  let end = 0;
  for (const n of [...s.melody, ...s.bass, ...s.chords]) end = Math.max(end, n.t + n.len);
  for (const h of s.drums) end = Math.max(end, h.t + (h.part === 'crash' ? 1.6 : 0.4));
  if (s.riser) end = Math.max(end, s.riser.t + s.riser.len);
  if (s.sag) end = Math.max(end, s.sag.t + s.sag.len);
  s.length = Math.round((end + ring + s.echo * 4) * 1000) / 1000;
  return s;
}

/**
 * WASTED: the hook's call, heavy, over the tonic minor, then the tape slows
 * and everything sags down a fifth while it fades (sfx.wasted adds the slam,
 * which is the low end, and the bell).
 */
export function wastedSting(key: number): Sting {
  const s = empty('saw');
  const s16 = sixteenth(136);
  const t0 = 0.15; // just after the slam's hit, not on top of it
  s.melody = hookNotes(leadTonic(key), s16, t0, 0, 4, 1);
  const held = s.melody[3];
  held.len = 2.4;
  s.chords = [{ t: t0, notes: chord(chordRoot(key), MINOR, true), len: 2.6, vel: 1 }];
  s.sag = { t: held.t + 0.15, len: 2.2, semis: -7 };
  s.echo = s16 * 3;
  return finish(s, 0.6);
}

/**
 * BUSTED: the hook's call on a cold square, an octave down and slower, its
 * last note sinking a semitone to the flat fifth under a rootless minor
 * seventh, as the cell door rings (sfx.busted adds the cuffs and the clang).
 */
export function bustedSting(key: number): Sting {
  const s = empty('square');
  const s16 = sixteenth(118);
  const clang = 0.28;
  const t0 = clang + 0.08;
  const tonic = leadTonic(key) - 12;
  s.melody = hookNotes(tonic, s16, t0, 0, 4, 0.9);
  const held = s.melody[3];
  held.len = 0.5;
  s.melody.push({ t: held.t + held.len, note: tonic + 6, len: 1.6, vel: 0.8, glide: 0.12 });
  const root = chordRoot(key);
  // In with the hook, just after the clang's strike rather than on it.
  s.chords = [{ t: t0, notes: [root, root + 3, root + 10], len: 2.2, vel: 0.85 }];
  s.bass = [{ t: t0, note: bassRoot(key), len: 2.6, vel: 0.9 }];
  s.echo = s16 * 3;
  return finish(s, 0.5);
}

/** Each payphone job's colour: its lead and tempo, and whether the cue lands on the tonic or hangs on the major fifth. */
const MISSION_LEADS: readonly StingLead[] = ['saw', 'square', 'flute', 'saw'];
const MISSION_BPM = [116, 124, 108, 132];

/**
 * A job starts: a bar of heist pulse (bass eighths, kick on the hook's
 * 3+3+2, hats) under the hook's call, then a stab and a crash on the next
 * downbeat. `index` (the job's) picks the lead, the tempo and the stab. In a
 * major key the call and the tonic chords are major (the radio dips under it,
 * it doesn't stop).
 */
export function missionStartSting(key: number, index: number, inMajor = false): Sting {
  const i = ((index % 4) + 4) % 4;
  const s = empty(MISSION_LEADS[i]);
  const s16 = sixteenth(MISSION_BPM[i]);
  const home = inMajor ? MAJOR : MINOR;
  s.melody = hookNotes(leadTonic(key), s16, 0, 0, 4, 1, spelled(inMajor));
  const bass = bassRoot(key);
  for (let k = 0; k < 8; k++) s.bass.push({ t: k * 2 * s16, note: bass + (k === 3 ? 12 : 0), len: s16 * 1.6, vel: k % 2 === 0 ? 1 : 0.8 });
  for (const step of [0, 3, 6, 8, 11, 14]) s.drums.push({ t: step * s16, part: 'kick', vel: step === 0 || step === 8 ? 1 : 0.7 });
  for (let step = 2; step < 16; step += 4) s.drums.push({ t: step * s16, part: 'hat', vel: 0.6 });
  const root = chordRoot(key);
  s.chords.push({ t: 0, notes: chord(root, home), len: 3 * s16, vel: 0.7 });
  // The button: home on even jobs; odd ones hang on the major fifth (to be continued...).
  const button = 16 * s16;
  const last = index % 2 === 0 ? chord(root, home, true) : chord(root + 7 - 12, MAJOR, true);
  s.chords.push({ t: button, notes: last, len: 0.5, vel: 1 });
  s.bass.push({ t: button, note: index % 2 === 0 ? bass : bass + 7 - (bass + 7 >= 48 ? 12 : 0), len: 0.7, vel: 1 });
  s.melody.push({ t: button, note: leadTonic(key) + (index % 2 === 0 ? 12 : 11), len: 0.45, vel: 1 });
  s.drums.push({ t: button, part: 'kick', vel: 1 }, { t: button, part: 'crash', vel: 0.9 });
  s.drums.sort((a, b) => a.t - b.t);
  s.echo = s16 * 3;
  return finish(s, 0.4);
}

/**
 * MISSION PASSED: the whole hook in the major, brisk, over I and IV with a
 * backbeat, its last note leaping up to the octave on a big chord and a crash.
 */
export function missionPassedSting(key: number, index: number): Sting {
  const i = ((index % 3) + 3) % 3;
  const s = empty((['saw', 'square', 'saw'] as const)[i]);
  const s16 = sixteenth(144 + i * 6);
  const tonic = leadTonic(key);
  s.melody = hookNotes(tonic, s16, 0, 0, HOOK.length - 1, 1, major);
  const home = 24 * s16;
  s.melody.push({ t: home, note: tonic + 12, len: 1.1, vel: 1 });
  const root = chordRoot(key);
  const bass = bassRoot(key);
  s.chords = [
    { t: 0, notes: chord(root, MAJOR), len: 6 * s16, vel: 0.75 },
    { t: 16 * s16, notes: chord(root + 5, MAJOR), len: 6 * s16, vel: 0.75 },
    { t: home, notes: chord(root, MAJOR, true), len: 1.2, vel: 1 },
  ];
  s.bass = [
    { t: 0, note: bass, len: 7 * s16, vel: 1 },
    { t: 8 * s16, note: bass + 7, len: 7 * s16, vel: 0.85 },
    { t: 16 * s16, note: bass + 5, len: 7 * s16, vel: 1 },
    { t: home, note: bass, len: 1.2, vel: 1 },
  ];
  for (let step = 0; step < 24; step += 4) s.drums.push({ t: step * s16, part: step % 8 === 0 ? 'kick' : 'snare', vel: step % 8 === 0 ? 0.9 : 0.6 });
  for (let step = 2; step < 24; step += 4) s.drums.push({ t: step * s16, part: 'hat', vel: 0.5 });
  s.drums.push({ t: home, part: 'kick', vel: 1 }, { t: home, part: 'crash', vel: 1 });
  s.drums.sort((a, b) => a.t - b.t);
  s.echo = s16 * 3;
  return finish(s, 0.5);
}

/**
 * MISSION FAILED: the hook's call gets as far as the flat sixth and loses
 * its nerve, sliding down chromatically on to the low tonic as the chord
 * sinks with it. In a major key (the radio plays on under it) the call is
 * major and it fails on to the relative minor instead, a deceptive cadence:
 * sad, with no minor third against the radio's major one.
 */
export function missionFailedSting(key: number, index: number, inMajor = false): Sting {
  const s = empty(index % 2 === 0 ? 'square' : 'saw');
  const s16 = sixteenth(120);
  const tonic = leadTonic(key);
  s.melody = hookNotes(tonic, s16, 0, 0, 3, 0.9, spelled(inMajor));
  for (const [step, semi] of [
    [8, 7],
    [11, 6],
    [14, 5],
  ] as const) {
    s.melody.push({ t: step * s16, note: tonic + semi, len: 3 * s16, vel: 0.85 });
  }
  const down = 16 * s16;
  s.melody.push({ t: down, note: tonic, len: 1.1, vel: 0.85, glide: 0.05 });
  const root = chordRoot(key);
  const bass = bassRoot(key);
  // Minor: i, iv over the flat sixth, i over the low tonic. Major: I, IV over
  // the sixth, then vi over it (the bass falls to the sixth and stays).
  const home = inMajor ? MAJOR : MINOR;
  const low = bass + (inMajor ? 9 : 8) - 12;
  const last = inMajor ? low : bass;
  s.chords = [
    { t: 0, notes: chord(root, home), len: 7 * s16, vel: 0.6 },
    { t: 8 * s16, notes: chord(root + 5 - 12, home), len: 7 * s16, vel: 0.55 },
    { t: down, notes: inMajor ? chord(root + 9 - 12, MINOR) : chord(root, MINOR), len: 1.1, vel: 0.7 },
  ];
  s.bass = [
    { t: 0, note: bass, len: 7 * s16, vel: 0.9 },
    { t: 8 * s16, note: low, len: 7 * s16, vel: 0.9 },
    { t: down, note: last - 12 >= 28 ? last - 12 : last, len: 1.2, vel: 1 },
  ];
  s.drums = [
    { t: 0, part: 'kick', vel: 0.8 },
    { t: down, part: 'kick', vel: 0.9 },
  ];
  s.sag = { t: down + 0.35, len: 0.9, semis: -1 };
  return finish(s, 0.4);
}

/** Seconds between the counts of a 3-2-1-GO (the modes count whole seconds). */
export const COUNT_SPACING = 1;

/**
 * One beat of the 3-2-1-GO count-in: `n` is the number showing (3, 2, 1),
 * 0 is GO. Each count is a hit that builds on the last (kick, then snare,
 * then a roll into GO) on the next chord of i - VI - V (I - IV - V in a major
 * key, the bass climbing from IV), over its stretch of a riser climbing to
 * the tonic. Each covers only its own second, so the hits stay with the
 * numbers on screen and nothing hangs on if the count stops. GO lands the
 * tonic chord with a crash, the lead on the octave, and the radio drops in.
 */
export function countInSting(n: number, key: number, inMajor = false): Sting {
  const root = chordRoot(key);
  const bass = bassRoot(key);
  const tonic = leadTonic(key);
  const home = inMajor ? MAJOR : MINOR;
  const s = empty('saw');
  if (n <= 0) {
    s.chords = [{ t: 0, notes: chord(root, home, true), len: 0.5, vel: 1 }];
    s.bass = [{ t: 0, note: bass, len: 0.6, vel: 1 }];
    s.melody = [{ t: 0, note: tonic + 12, len: 0.32, vel: 1 }];
    s.drums = [
      { t: 0, part: 'kick', vel: 1 },
      { t: 0, part: 'clap', vel: 0.9 },
      { t: 0, part: 'crash', vel: 1 },
    ];
    return finish(s, 0.3);
  }
  const k = Math.min(3, Math.max(1, Math.round(n)));
  const build = (3 - k) / 3; // 0 on "3", 2/3 on "1"
  // i (I) on 3, VI (IV) on 2, V (major, the leading tone) on 1.
  const second = inMajor ? 5 : 8;
  const [chordRootAt, shape, bassAt] = k === 3 ? [root, home, bass] : k === 2 ? [root + second - 12, MAJOR, bass + second - 12] : [root + 7 - 12, MAJOR, bass + 7 - 12];
  const vel = 0.6 + build * 0.45;
  s.chords = [{ t: 0, notes: chord(chordRootAt, shape), len: 0.22, vel }];
  s.bass = [{ t: 0, note: bassAt, len: 0.45, vel }];
  s.drums.push({ t: 0, part: 'kick', vel: Math.min(1, vel + 0.1) });
  if (k <= 2) s.drums.push({ t: 0, part: 'snare', vel: vel * 0.8 });
  if (k === 1) {
    // A snare roll into GO.
    for (let r = 0; r < 4; r++) s.drums.push({ t: 0.5 + r * 0.125, part: 'snare', vel: 0.3 + r * 0.15 });
  }
  const span = COUNT_SPACING;
  s.riser = { t: 0, len: span, from: tonic - 12 + build * 12, to: tonic - 12 + (build + 1 / 3) * 12, level: [0.25 + build * 0.75, 0.25 + (build + 1 / 3) * 0.75] };
  return finish(s, 0.05);
}

/** The voice levels the game plays them at (GameAudio; the tuning harness renders at the same). */
export const STING_LEVELS = { wasted: 1, busted: 1, countIn: 0.7, missionStart: 0.6, missionPassed: 0.6, missionFailed: 0.6 } as const;

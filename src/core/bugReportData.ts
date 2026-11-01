/**
 * What a bug report holds, put together (pure): where the player was, the
 * wanted level, the time and weather, the quality tier, what was on screen,
 * the last moments of game events, the Diagnostics report and the player's
 * note. ui/bugReport.ts captures the pieces and shares the result.
 */
import type { SceneCounts } from './sceneCounts';
import type { TrailEntry } from './eventTrail';

/** The game's state as the report was taken. */
export interface BugState {
  /** Where the player (or their vehicle) is, m. */
  x: number;
  z: number;
  /** Facing, degrees (0 = +Z, clockwise from above). */
  heading: number;
  /** The vehicle's archetype, or null on foot. */
  vehicle: string | null;
  health: number;
  alive: boolean;
  wanted: number;
  /** Game clock, hours 0..24. */
  hour: number;
  night: number;
  rain: number;
  wetness: number;
  tier: string;
  ratio: number;
  /** In a mission, race, Chaos Run... (or null in free roam). */
  activity: string | null;
  /** Sim time, s. */
  simTime: number;
}

export interface BugReportInput {
  build: string;
  version: string;
  at: Date;
  note: string;
  state: BugState;
  counts: SceneCounts | null;
  events: TrailEntry[];
  /** The Diagnostics report's data. */
  diagnostics: unknown;
  /** The screenshot's size, or null without one. */
  screenshot: { width: number; height: number; bytes: number } | null;
}

/** Column names of `events` rows, so the JSON reads on its own. */
export const EVENT_COLUMNS = ['secondsAgo', 'type', 'x', 'z', 'value', 'word', 'byPlayer'] as const;

/** Longest note kept, characters. */
export const NOTE_MAX = 2000;

const r1 = (v: number) => Math.round(v * 10) / 10;

export function buildBugReport(p: BugReportInput) {
  const s = p.state;
  return {
    kind: 'curbside-bug-report',
    build: p.build,
    version: p.version,
    at: p.at.toISOString(),
    note: p.note.trim().slice(0, NOTE_MAX),
    player: { x: r1(s.x), z: r1(s.z), heading: Math.round(s.heading), vehicle: s.vehicle, health: Math.round(s.health), alive: s.alive },
    wanted: s.wanted,
    time: { hour: Math.round(s.hour * 100) / 100, clock: clock(s.hour), night: r1(s.night) },
    weather: { rain: r1(s.rain), wetness: r1(s.wetness) },
    quality: { tier: s.tier, ratio: Math.round(s.ratio * 100) / 100 },
    activity: s.activity,
    simTime: r1(s.simTime),
    counts: p.counts,
    screenshot: p.screenshot,
    eventColumns: EVENT_COLUMNS,
    events: p.events,
    diagnostics: p.diagnostics,
  };
}

export type BugReport = ReturnType<typeof buildBugReport>;

/** "21:07" from hours. */
export function clock(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  const m = Math.floor((h % 1) * 60);
  return `${String(Math.floor(h)).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** File names' stem: curbside-bug-<commit>-<yyyymmdd-hhmmss> (local time). */
export function bugFileStem(build: string, at: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  // BUILD_ID is "<commit> <date>": the commit names it.
  const safe = (build.trim().split(/\s+/)[0] ?? '').replace(/[^A-Za-z0-9._-]/g, '');
  return `curbside-bug-${safe}-${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}-${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}`;
}

/** A few readable lines: the share sheet's text and the bug sheet's summary. */
export function bugSummary(r: BugReport): string {
  const v = r.player.vehicle ? `in a ${r.player.vehicle}` : 'on foot';
  const lines = [
    `Curbside bug report · v${r.version} · build ${r.build}`,
    `At (${r.player.x}, ${r.player.z}) heading ${r.player.heading}° ${v} · health ${r.player.health}${r.player.alive ? '' : ' (down)'} · wanted ${r.wanted}`,
    `${r.time.clock}${r.time.night > 0.5 ? ' night' : ''}${r.weather.rain > 0.05 ? ' · rain' : ''} · ${r.quality.tier} @${r.quality.ratio}x${r.activity ? ` · ${r.activity}` : ''}`,
    `${r.events.length} events in the last 30 s${r.screenshot ? ` · screenshot ${r.screenshot.width}×${r.screenshot.height}` : ' · no screenshot'}`,
  ];
  if (r.note) lines.push(`Note: ${r.note}`);
  return lines.join('\n');
}

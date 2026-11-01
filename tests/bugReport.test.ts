import { describe, expect, it } from 'vitest';
import { bugFileStem, bugSummary, buildBugReport, clock, NOTE_MAX, type BugState } from '../src/core/bugReportData';
import { emptyCounts } from '../src/core/sceneCounts';

const state: BugState = {
  x: 12.345,
  z: -80.06,
  heading: 271.6,
  vehicle: 'sedan',
  health: 64.4,
  alive: true,
  wanted: 3,
  hour: 21.5,
  night: 0.9,
  rain: 0.4,
  wetness: 0.7,
  tier: 'medium',
  ratio: 1.5,
  activity: null,
  simTime: 412.33,
};

describe('bug report data', () => {
  const at = new Date(2026, 10, 1, 9, 5, 7);
  const r = buildBugReport({
    build: 'ac29208',
    version: '0.11.0',
    at,
    note: '  car fell through the road  ',
    state,
    counts: emptyCounts(),
    events: [[1.5, 'explosion', 1, 2, 12, 'vehicle', 1]],
    diagnostics: { build: 'ac29208' },
    screenshot: { width: 960, height: 443, bytes: 51234 },
  });

  it('holds the state, rounded, the note trimmed, and the events with their columns', () => {
    expect(r.player).toEqual({ x: 12.3, z: -80.1, heading: 272, vehicle: 'sedan', health: 64, alive: true });
    expect(r.wanted).toBe(3);
    expect(r.time).toEqual({ hour: 21.5, clock: '21:30', night: 0.9 });
    expect(r.quality).toEqual({ tier: 'medium', ratio: 1.5 });
    expect(r.note).toBe('car fell through the road');
    expect(r.eventColumns[0]).toBe('secondsAgo');
    expect(r.events).toHaveLength(1);
    expect(JSON.parse(JSON.stringify(r)).diagnostics.build).toBe('ac29208');
  });

  it('caps the note', () => {
    const long = buildBugReport({ build: 'b', version: '1', at, note: 'x'.repeat(NOTE_MAX * 2), state, counts: null, events: [], diagnostics: null, screenshot: null });
    expect(long.note).toHaveLength(NOTE_MAX);
  });

  it('names files by build and local time, and summarises in a few lines', () => {
    expect(bugFileStem('ac29208', at)).toBe('curbside-bug-ac29208-20261101-090507');
    expect(bugFileStem('05bf5b2 2026-11-01 19:47Z', at)).toBe('curbside-bug-05bf5b2-20261101-090507');
    expect(bugFileStem('a/b', at)).toBe('curbside-bug-ab-20261101-090507');
    const s = bugSummary(r);
    expect(s).toContain('in a sedan');
    expect(s).toContain('wanted 3');
    expect(s).toContain('21:30 night · rain · medium @1.5x');
    expect(s).toContain('Note: car fell through the road');
    expect(clock(24.25)).toBe('00:15');
  });
});

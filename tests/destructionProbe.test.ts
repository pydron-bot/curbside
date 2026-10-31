import { describe, expect, it } from 'vitest';
import { emptyStats, type DestructionStats } from '../src/render/destruction';
import { blowWallBlocker, clearOfHud, destructionLines, destructionSummary } from '../src/ui/destructionProbe';

function stats(over: Partial<DestructionStats>): DestructionStats {
  return { ...emptyStats(), ...over };
}

const desktop = stats({
  mode: 'auto',
  style: 'desktop',
  rapier: 'ready',
  version: '0.20.0',
  loadMs: 52.4,
  evalMs: 31.6,
  warmMs: 118.2,
  live: 34,
  drawn: 30,
  statics: 6,
  scars: 3,
  scarCap: 32,
  breaches: 4,
  stepAvg: 0.213,
  stepP95: 0.6,
  stepMax: 1.42,
  steps: 412,
  spawnMaxMs: 1.1,
  timerMs: 0.005,
});

describe('destruction probe readout', () => {
  it('off says so', () => {
    expect(destructionLines(stats({}), 'high')).toBe('off: blasts leave walls alone, Rapier not loaded');
    expect(destructionSummary(stats({}))).toBe('DESTRUCTION off');
  });

  it('auto shows the tier it follows, Rapier timings, bodies and physics time', () => {
    const lines = destructionLines(desktop, 'high').split('\n');
    expect(lines[0]).toBe('style desktop (auto→high) · rapier 0.20.0 ready: load 52 + import 32 + warm 118 ms');
    expect(lines[1]).toBe('bodies 34 live · 0 awake · 0 sinking · 30 drawn · 6 statics · 0 proxies · scars 3/32 · 4 breaches');
    expect(lines[2]).toBe('phys avg 0.21 · p95 0.60 · max 1.42 ms (412 steps) · spawn max 1.10 ms · timer 0.005 ms');
    expect(destructionSummary(desktop)).toBe('DESTRUCTION desktop (auto) · rapier ready 52+32+118 ms · 34 bodies (0 awake) · phys 0.21/0.60 ms · scars 3 · 4 breaches');
  });

  it('a coarse timer flags p95 and adds the worst-second averages', () => {
    const s = { ...desktop, timerMs: 1, secAvgMax: 0.41, secAvgP95: 0.3 };
    expect(destructionLines(s, 'high').split('\n')[2]).toBe(
      'phys avg 0.21 · p95 0.60 (q) · max 1.42 ms (412 steps) · worst 1 s avg 0.41 (p95 0.30) · spawn max 1.10 ms · timer 1.000 ms',
    );
    expect(destructionSummary(s)).toContain('phys 0.21/0.60 (q) ms');
  });

  it('one breach is singular', () => {
    expect(destructionLines({ ...desktop, breaches: 1 }, 'high').split('\n')[1]).toMatch(/· 1 breach$/);
    expect(destructionSummary({ ...desktop, breaches: 1 })).toMatch(/· 1 breach$/);
  });

  it('forced and URL modes, and a failed load', () => {
    expect(destructionLines({ ...desktop, mode: 'phone', style: 'phone' }, 'high').split('\n')[0]).toContain('style phone (forced)');
    expect(destructionSummary({ ...desktop, mode: 'phone', style: 'phone' })).toContain('DESTRUCTION phone (forced) ·');
    expect(destructionSummary({ ...desktop, mode: 'desktop', source: 'url' })).toContain('DESTRUCTION desktop (url desktop) ·');
    expect(destructionLines({ ...desktop, mode: 'desktop', source: 'url' }, 'medium').split('\n')[0]).toContain('(url desktop)');
    const failed = { ...desktop, rapier: 'failed' as const, style: 'low' as const, error: 'Failed to fetch' };
    expect(destructionLines(failed, 'high').split('\n')[0]).toBe('style low (auto→high) · rapier failed: Failed to fetch');
    expect(destructionSummary(failed)).toContain('rapier failed');
  });
});

describe('BLOW A WALL', () => {
  it('needs the test on, and Rapier ready when the style throws bodies', () => {
    expect(blowWallBlocker(stats({}), 'high')).toMatch(/Turn the test on/);
    const loading = { ...desktop, rapier: 'loading' as const };
    expect(blowWallBlocker(loading, 'high')).toMatch(/Loading physics/);
    expect(blowWallBlocker({ ...loading, mode: 'phone' }, 'low')).toMatch(/Loading physics/);
    // auto on a phone's 'medium' is the desktop style: it waits for Rapier too.
    expect(blowWallBlocker(loading, 'medium')).toMatch(/Loading physics/);
    // auto on 'low' throws no bodies: nothing to wait for.
    expect(blowWallBlocker(loading, 'low')).toBeNull();
    expect(blowWallBlocker(desktop, 'high')).toBeNull();
    expect(blowWallBlocker({ ...desktop, rapier: 'failed' }, 'high')).toBeNull();
  });

  it('the crater must show below the top HUD band and clear of the pause button and radar', () => {
    const pause = { left: 404, top: 4, right: 448, bottom: 48 };
    const radar = { left: 10, top: 10, right: 110, bottom: 110 };
    expect(clearOfHud(426, 200, 852, 393, [pause, radar])).toBe(true);
    // The phone case: the crater's top just under the pause button.
    expect(clearOfHud(426, 40, 852, 393, [pause, radar])).toBe(false);
    expect(clearOfHud(200, 40, 852, 393, [])).toBe(false);
    expect(clearOfHud(200, 60, 852, 393, [])).toBe(true);
    expect(clearOfHud(60, 100, 852, 393, [pause, radar])).toBe(false);
    expect(clearOfHud(-5, 200, 852, 393, [])).toBe(false);
    expect(clearOfHud(426, 400, 852, 393, [])).toBe(false);
  });
});

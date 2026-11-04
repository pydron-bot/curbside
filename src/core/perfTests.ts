/**
 * Low Power Mode experiments (Diagnostics → LOW POWER TESTS): switches that
 * each take away one kind of processor work, to find what Low Power Mode is
 * short of. Saved (so a test can start from a fresh launch) until switched
 * back; the session log marks each change and the report carries them.
 * - sim: at most one simulation step per frame (at 30 fps the game runs in
 *   slow motion: the physics stay as tuned, the sim's cost per frame halves);
 * - crowd / traffic: half the street crowd / half the traffic (thins as
 *   people and cars go out of range, so drive a block or two, or relaunch).
 */
import type { KeyValueStore } from './sessionLog';

export const PERF_TESTS_KEY = 'curbside.perftests';

export interface PerfTests {
  sim: boolean;
  crowd: boolean;
  traffic: boolean;
}

export const PERF_TEST_KEYS: ReadonlyArray<{ key: keyof PerfTests; label: string }> = [
  { key: 'sim', label: 'SIM 1 STEP' },
  { key: 'crowd', label: 'CROWD ½' },
  { key: 'traffic', label: 'TRAFFIC ½' },
];

/** The live switches (main reads these every frame). */
export const perfTests: PerfTests = { sim: false, crowd: false, traffic: false };

/** What a stored value says (anything unreadable: all off). */
export function parsePerfTests(raw: string | null): PerfTests {
  const out: PerfTests = { sim: false, crowd: false, traffic: false };
  if (!raw) return out;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    for (const { key } of PERF_TEST_KEYS) out[key] = v?.[key] === true;
  } catch {
    // Off.
  }
  return out;
}

/** The switches that are on, for the overlay and the log ('' when none). */
export function perfTestsLabel(t: PerfTests): string {
  return PERF_TEST_KEYS.filter(({ key }) => t[key])
    .map(({ label }) => label)
    .join(' · ');
}

export function loadPerfTests(store: KeyValueStore | null): void {
  let raw: string | null = null;
  try {
    raw = store?.getItem(PERF_TESTS_KEY) ?? null;
  } catch {
    // Blocked storage: all off.
  }
  Object.assign(perfTests, parsePerfTests(raw));
}

export function savePerfTests(store: KeyValueStore | null): void {
  try {
    store?.setItem(PERF_TESTS_KEY, JSON.stringify(perfTests));
  } catch {
    // Not saved: still on for this session.
  }
}

/** Multipliers the population and the city's traffic read. */
export const crowdTestScale = () => (perfTests.crowd ? 0.5 : 1);
export const trafficTestScale = () => (perfTests.traffic ? 0.5 : 1);
/** Sim steps allowed per frame (FixedStep's cap). */
export const simStepCap = (normal: number) => (perfTests.sim ? 1 : normal);

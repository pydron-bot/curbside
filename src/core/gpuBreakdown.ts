/**
 * GPU breakdown (Diagnostics → GPU BREAKDOWN): Safari has no GPU timer, so
 * the paused scene is drawn again and again and each frame is waited for
 * (a 1-pixel readPixels), first with everything, then with one part of the
 * scene left out at a time, then with everything again (to see drift as the
 * phone warms). The median time of each step against the full frame is what
 * that part costs. This is the pure part: the plan, the stats, the lines.
 */

export type GpuLayerKey =
  | 'shadows'
  | 'city'
  | 'ground'
  | 'props'
  | 'people'
  | 'cars'
  | 'glows'
  | 'particles'
  | 'contact'
  | 'rubble'
  | 'other'
  | 'pixels'
  | 'empty';

/** Each step leaves this out (in this order); 'pixels' draws half the pixels, 'empty' nothing at all. */
export const GPU_LAYERS: ReadonlyArray<{ key: GpuLayerKey; label: string }> = [
  { key: 'shadows', label: 'sun shadow pass' },
  { key: 'city', label: 'buildings' },
  { key: 'ground', label: 'ground and roads' },
  { key: 'props', label: 'props and trees' },
  { key: 'people', label: 'people and birds' },
  { key: 'cars', label: 'cars' },
  { key: 'glows', label: 'glows and lights' },
  { key: 'particles', label: 'fire, smoke, rain' },
  { key: 'contact', label: 'contact shadows' },
  { key: 'rubble', label: 'rubble and debris' },
  { key: 'other', label: 'everything else' },
  { key: 'pixels', label: 'half the pixels' },
  { key: 'empty', label: 'nothing drawn' },
];

/** Which part a top-level scene object belongs to, by its name. */
export function layerOf(name: string): GpuLayerKey {
  if (name === 'city') return 'city';
  if (name === 'ground' || name === 'groundDecals') return 'ground';
  if (name.startsWith('props_') || name === 'ramps' || name === 'pickups') return 'props';
  if (name.startsWith('characters-') || name === 'held-weapons' || name === 'pigeons' || name === 'gulls') return 'people';
  if (name === 'cars' || name === 'heli') return 'cars';
  if (name === 'glows') return 'glows';
  if (name.startsWith('fx') || name === 'rain') return 'particles';
  if (name === 'contactShadows') return 'contact';
  if (name === 'rubble' || name === 'debris') return 'rubble';
  return 'other';
}

export const ALL = 'all';
/** Frames drawn before measuring each step (uploads, caches), then frames measured. */
export const WARM_FRAMES = 6;
export const MEASURE_FRAMES = 20;

export interface GpuStepResult {
  key: string;
  label: string;
  /** Medians over the measured frames, ms: the whole draw-and-wait, and the JS part of it. */
  total: number;
  cpu: number;
  p90: number;
  frames: number;
}

export interface GpuBreakdownResult {
  /** ISO time the run finished. */
  at: string;
  tier: string;
  ratio: number;
  /** Draw calls of the full frame. */
  dc: number;
  steps: GpuStepResult[];
}

function median(sorted: number[], p = 0.5): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}

/** The run's state: which step is being measured, and what each measured. */
export class GpuBreakdownRun {
  /** Step keys in order: everything, each part left out, everything again. */
  readonly plan: string[];
  private step = 0;
  private seen = 0;
  private totals: number[] = [];
  private cpus: number[] = [];
  private readonly out: GpuStepResult[] = [];

  constructor(
    private readonly labels: ReadonlyArray<{ key: string; label: string }> = GPU_LAYERS,
    private readonly warm = WARM_FRAMES,
    private readonly frames = MEASURE_FRAMES,
  ) {
    this.plan = [ALL, ...labels.map((l) => l.key), ALL];
  }

  /** The step being measured (its key), or null when the run is over. */
  get current(): string | null {
    return this.step < this.plan.length ? this.plan[this.step] : null;
  }

  get index(): number {
    return this.step;
  }

  label(key: string): string {
    return key === ALL ? 'everything' : (this.labels.find((l) => l.key === key)?.label ?? key);
  }

  /** One frame of the current step, ms. True when the step is over (set up the next one). */
  sample(cpu: number, total: number): boolean {
    if (this.current === null) return false;
    this.seen++;
    if (this.seen <= this.warm) return false;
    if (Number.isFinite(total) && total >= 0) {
      this.totals.push(total);
      this.cpus.push(Math.max(0, cpu));
    }
    if (this.seen < this.warm + this.frames) return false;
    const t = this.totals.sort((a, b) => a - b);
    const c = this.cpus.sort((a, b) => a - b);
    const key = this.plan[this.step];
    this.out.push({ key, label: this.label(key), total: median(t), cpu: median(c), p90: median(t, 0.9), frames: t.length });
    this.step++;
    this.seen = 0;
    this.totals = [];
    this.cpus = [];
    return true;
  }

  results(): GpuStepResult[] {
    return this.out;
  }
}

const f1 = (v: number) => v.toFixed(1);

/** How a step reads: "glows and lights off", "at half the pixels", "everything". */
export function stepName(key: string, label: string): string {
  if (key === ALL) return 'everything';
  return key === 'pixels' ? `at ${label}` : `${label} off`;
}

/** The full frame's cost: the mean of the first and last "everything" steps. */
export function baselineOf(steps: readonly GpuStepResult[]): number {
  const all = steps.filter((s) => s.key === ALL);
  return all.length ? all.reduce((s, a) => s + a.total, 0) / all.length : 0;
}

/** Readable lines: the full frame, the fixed cost, then each part by what leaving it out saved, biggest first. */
export function breakdownLines(r: GpuBreakdownResult): string[] {
  const steps = r.steps;
  if (!steps.length) return ['GPU BREAKDOWN: no result'];
  const all = steps.filter((s) => s.key === ALL);
  const base = baselineOf(steps);
  const lines = [
    `GPU BREAKDOWN ${r.tier} @ ${r.ratio.toFixed(2)}x · ${r.dc} dc · median ms to draw the paused frame and wait for it`,
    `everything ${all.map((a) => `${f1(a.total)} (js ${f1(a.cpu)}, p90 ${f1(a.p90)})`).join(' → ')}${all.length > 1 ? ' (start → end)' : ''}`,
  ];
  const empty = steps.find((s) => s.key === 'empty');
  if (empty) lines.push(`nothing drawn ${f1(empty.total)}: the fixed cost (clear, hand-over, wait)`);
  const parts = steps
    .filter((s) => s.key !== ALL && s.key !== 'empty')
    .map((s) => ({ s, save: base - s.total }))
    .sort((a, b) => b.save - a.save);
  for (const { s, save } of parts) {
    const pct = base > 0 ? Math.round((Math.abs(save) / base) * 100) : 0;
    lines.push(`  ${stepName(s.key, s.label)}: ${save >= 0 ? '−' : '+'}${f1(Math.abs(save))} ms (${pct}%)`);
  }
  return lines;
}

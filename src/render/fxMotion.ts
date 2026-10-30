/**
 * Small pieces of motion math shared by the camera and the effects: trauma
 * (screen shake that feels like a jolt, not noise), damped springs, smooth
 * noise, soft clamping, and hit-stop. Pure, no three.js, unit-tested.
 */

/**
 * Smooth 1D noise in -1..1: three detuned sines per channel. Continuous in t
 * (unlike Math.random per frame), so shake reads as a shudder at any frame
 * rate. `channel` picks an independent-looking signal.
 */
export function smoothNoise(t: number, channel: number): number {
  const p = channel * 12.9898;
  return (Math.sin(t * 17.3 + p) + 0.6 * Math.sin(t * 29.1 + p * 1.7 + 1.3) + 0.35 * Math.sin(t * 47.7 + p * 2.3 + 4.1)) / 1.95;
}

/** m · tanh(v / m): passes small values through, approaches ±m smoothly. */
export function softClamp(v: number, m: number): number {
  if (m <= 0) return 0;
  return m * Math.tanh(v / m);
}

/**
 * Trauma: hits add to a 0..1 level that drains steadily; the shake is
 * level² (small knocks barely move the view, big ones really shake it).
 */
export class Trauma {
  level = 0;

  constructor(
    /** Drain per second. */
    readonly decay = 1.6,
  ) {}

  add(amount: number): void {
    this.level = Math.min(1, this.level + Math.max(0, amount));
  }

  step(dt: number): void {
    this.level = Math.max(0, this.level - this.decay * dt);
  }

  /** Shake strength 0..1. */
  get shake(): number {
    return this.level * this.level;
  }
}

/**
 * A damped spring on one value pulled toward `target`. Underdamped by default
 * so a kick overshoots a little and settles (reads as weight).
 */
export class Spring {
  value = 0;
  velocity = 0;
  target = 0;

  constructor(
    public stiffness = 120,
    public damping = 14,
  ) {}

  /** Instant change of velocity (a hit). */
  kick(v: number): void {
    this.velocity += v;
  }

  step(dt: number): void {
    // Sub-step long frames so stiff springs stay stable.
    const n = dt > 1 / 50 ? Math.ceil(dt * 50) : 1;
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const a = this.stiffness * (this.target - this.value) - this.damping * this.velocity;
      this.velocity += a * h;
      this.value += this.velocity * h;
    }
  }

  reset(value = 0): void {
    this.value = value;
    this.velocity = 0;
    this.target = value;
  }
}

/**
 * Hit-stop: a brief slow-down of the simulation on a big moment (a close
 * explosion, a heavy crash, a knockout). The game multiplies the time it
 * feeds the fixed-step loop by `scale` while the camera keeps real time.
 *
 * A stop holds at `slow` for its duration, then eases back to full speed
 * over RECOVER seconds. Overlapping stops keep the longest remaining hold
 * rather than adding up, and a short cooldown after each stop stops a chain
 * reaction (or a spray of SMG knockouts) from turning into slow motion.
 */
export class HitStop {
  static readonly RECOVER = 0.08;
  static readonly COOLDOWN = 0.3;
  private hold = 0;
  private recover = 0;
  private cooldown = 0;
  private slow = 1;
  /** Time scale this frame, 0..1. */
  scale = 1;

  /** Freeze to `slow` (0..1) for `seconds` of real time (ignored during the cooldown unless stronger). */
  hit(seconds: number, slow = 0.08): void {
    if (seconds <= 0) return;
    const active = this.hold > 0 || this.recover > 0;
    if (!active && this.cooldown > 0 && seconds < 0.06) return;
    this.hold = Math.max(this.hold, seconds);
    this.slow = active ? Math.min(this.slow, slow) : slow;
    this.recover = 0;
  }

  /** Advance by real seconds; returns the time scale for this frame. */
  step(dt: number): number {
    if (this.hold > 0) {
      this.hold -= dt;
      this.scale = this.slow;
      if (this.hold <= 0) this.recover = HitStop.RECOVER;
    } else if (this.recover > 0) {
      this.recover = Math.max(0, this.recover - dt);
      const k = 1 - this.recover / HitStop.RECOVER;
      this.scale = this.slow + (1 - this.slow) * k * k;
      if (this.recover === 0) this.cooldown = HitStop.COOLDOWN;
    } else {
      this.cooldown = Math.max(0, this.cooldown - dt);
      this.scale = 1;
    }
    return this.scale;
  }

  get active(): boolean {
    return this.hold > 0 || this.recover > 0;
  }

  reset(): void {
    this.hold = this.recover = this.cooldown = 0;
    this.scale = 1;
  }
}

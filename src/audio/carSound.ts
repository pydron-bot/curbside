/**
 * What the player's car sounds like, as numbers: a five-speed automatic
 * gearbox turns road speed and throttle into engine RPM (with launch revs,
 * audible shifts, kickdown and downshift blips), plus tyre squeal and road
 * noise amounts. Pure, so the gear model is unit-tested; the Web Audio voice
 * in loops.ts just follows these values.
 */
import {
  VEHICLE_SPECS,
  forwardSpeed,
  lateralSpeed,
  speed,
  type VehicleArchetype,
  type VehicleControls,
  type VehicleState,
} from '../entities/vehicle';
import { clamp, clamp01, smoothstep } from './mix';

/** The player's car as the audio system sees it. */
export interface CarSound {
  archetype: VehicleArchetype;
  /** |velocity|, m/s. */
  speed: number;
  /** Signed speed along the nose, m/s (negative when reversing). */
  forwardSpeed: number;
  /** -1..1; negative is brake / reverse. */
  throttle: number;
  /** Sideways slip, m/s (0 when tracking straight). */
  slip: number;
  handbrake: boolean;
}

/** A CarSound to reuse with describeCar(). */
export function createCarSound(): CarSound {
  return { archetype: 'sedan', speed: 0, forwardSpeed: 0, throttle: 0, slip: 0, handbrake: false };
}

/** Fill `out` from the car's sim state and the driver's controls (no allocation). */
export function describeCar(
  out: CarSound,
  sim: VehicleState,
  controls: VehicleControls,
  archetype: VehicleArchetype,
): CarSound {
  out.archetype = archetype;
  out.speed = speed(sim);
  out.forwardSpeed = forwardSpeed(sim);
  out.throttle = controls.throttle;
  out.slip = Math.abs(lateralSpeed(sim));
  out.handbrake = controls.handbrake;
  return out;
}

/** Timbre and gearing of one engine. */
export interface EngineProfile {
  idleRpm: number;
  redlineRpm: number;
  /** Firing pulses per revolution (cylinders / 2), nudged for pitch: Hz = rpm / 60 × pulses. */
  pulses: number;
  waveA: OscillatorType;
  waveB: OscillatorType;
  /** Oscillator B's frequency as a multiple of A's, and its detune in cents. */
  ratioB: number;
  detuneB: number;
  /** Level of oscillator B relative to A. */
  mixB: number;
  /** Soft-clip drive: 1 is clean, 4 is raspy. */
  drive: number;
  /** Lowpass cutoff = cutoff + load × loadOpen + rpmNorm × rpmOpen (Hz). */
  cutoff: number;
  loadOpen: number;
  rpmOpen: number;
  /** Intake / exhaust hiss level. */
  noise: number;
  /** Amplitude lope (0..0.5) at `lopeRate` × the firing frequency: V8 burble, diesel chug. */
  lope: number;
  lopeRate: number;
  /** Chance of overrun pops when lifting off at high revs. */
  backfire: number;
  gain: number;
}

/** Each archetype's engine: sports high and raspy, van low and chuggy, police a V8 burble. */
export const ENGINE_PROFILES: Record<VehicleArchetype, EngineProfile> = {
  sedan: {
    idleRpm: 850, redlineRpm: 6500, pulses: 2.5,
    waveA: 'sawtooth', waveB: 'square', ratioB: 1, detuneB: -9, mixB: 0.45,
    drive: 1.7, cutoff: 280, loadOpen: 1300, rpmOpen: 900,
    noise: 0.12, lope: 0.06, lopeRate: 0.5, backfire: 0, gain: 0.5,
  },
  compact: {
    idleRpm: 950, redlineRpm: 7200, pulses: 2.5,
    waveA: 'sawtooth', waveB: 'sawtooth', ratioB: 1, detuneB: 16, mixB: 0.6,
    drive: 2.3, cutoff: 380, loadOpen: 1700, rpmOpen: 1300,
    noise: 0.18, lope: 0.04, lopeRate: 0.5, backfire: 0.15, gain: 0.42,
  },
  sports: {
    idleRpm: 1000, redlineRpm: 8800, pulses: 3,
    waveA: 'sawtooth', waveB: 'square', ratioB: 1, detuneB: 8, mixB: 0.5,
    drive: 3.8, cutoff: 600, loadOpen: 2800, rpmOpen: 2600,
    noise: 0.22, lope: 0.05, lopeRate: 0.5, backfire: 0.75, gain: 0.5,
  },
  van: {
    idleRpm: 650, redlineRpm: 4400, pulses: 3,
    waveA: 'square', waveB: 'sawtooth', ratioB: 0.5, detuneB: 0, mixB: 0.7,
    drive: 1.4, cutoff: 200, loadOpen: 750, rpmOpen: 500,
    noise: 0.22, lope: 0.34, lopeRate: 1 / 3, backfire: 0, gain: 0.56,
  },
  police: {
    idleRpm: 750, redlineRpm: 6800, pulses: 4,
    waveA: 'sawtooth', waveB: 'square', ratioB: 0.5, detuneB: 0, mixB: 0.55,
    drive: 2.6, cutoff: 320, loadOpen: 2000, rpmOpen: 1500,
    noise: 0.15, lope: 0.2, lopeRate: 0.25, backfire: 0.45, gain: 0.52,
  },
  taxi: {
    idleRpm: 800, redlineRpm: 6200, pulses: 2.5,
    waveA: 'sawtooth', waveB: 'triangle', ratioB: 0.5, detuneB: 0, mixB: 0.6,
    drive: 1.4, cutoff: 250, loadOpen: 1100, rpmOpen: 800,
    noise: 0.1, lope: 0.05, lopeRate: 0.5, backfire: 0, gain: 0.48,
  },
  pickup: {
    idleRpm: 700, redlineRpm: 5400, pulses: 4,
    waveA: 'square', waveB: 'sawtooth', ratioB: 0.5, detuneB: 0, mixB: 0.6,
    drive: 2, cutoff: 230, loadOpen: 1200, rpmOpen: 800,
    noise: 0.16, lope: 0.24, lopeRate: 0.25, backfire: 0.2, gain: 0.55,
  },
  // A big-block V8: deep, lumpy idle, loud and pops on the overrun.
  muscle: {
    idleRpm: 700, redlineRpm: 6200, pulses: 4,
    waveA: 'sawtooth', waveB: 'square', ratioB: 0.5, detuneB: 0, mixB: 0.7,
    drive: 3.4, cutoff: 260, loadOpen: 2400, rpmOpen: 1500,
    noise: 0.2, lope: 0.42, lopeRate: 0.25, backfire: 0.8, gain: 0.6,
  },
  limo: {
    idleRpm: 650, redlineRpm: 5800, pulses: 4,
    waveA: 'sawtooth', waveB: 'triangle', ratioB: 0.5, detuneB: 0, mixB: 0.5,
    drive: 1.3, cutoff: 220, loadOpen: 1000, rpmOpen: 700,
    noise: 0.08, lope: 0.08, lopeRate: 0.25, backfire: 0, gain: 0.46,
  },
  police_suv: {
    idleRpm: 720, redlineRpm: 6200, pulses: 4,
    waveA: 'sawtooth', waveB: 'square', ratioB: 0.5, detuneB: 0, mixB: 0.6,
    drive: 2.4, cutoff: 280, loadOpen: 1800, rpmOpen: 1200,
    noise: 0.16, lope: 0.22, lopeRate: 0.25, backfire: 0.35, gain: 0.54,
  },
  swat: {
    idleRpm: 620, redlineRpm: 4200, pulses: 3,
    waveA: 'square', waveB: 'sawtooth', ratioB: 0.5, detuneB: 0, mixB: 0.75,
    drive: 1.8, cutoff: 180, loadOpen: 800, rpmOpen: 450,
    noise: 0.24, lope: 0.36, lopeRate: 1 / 3, backfire: 0, gain: 0.6,
  },
  ambulance: {
    idleRpm: 650, redlineRpm: 4400, pulses: 3,
    waveA: 'square', waveB: 'sawtooth', ratioB: 0.5, detuneB: 0, mixB: 0.7,
    drive: 1.4, cutoff: 200, loadOpen: 760, rpmOpen: 500,
    noise: 0.2, lope: 0.3, lopeRate: 1 / 3, backfire: 0, gain: 0.56,
  },
  // Diesels: low, chuggy, slow to rev.
  firetruck: {
    idleRpm: 550, redlineRpm: 3200, pulses: 3,
    waveA: 'square', waveB: 'sawtooth', ratioB: 0.5, detuneB: -6, mixB: 0.8,
    drive: 1.9, cutoff: 160, loadOpen: 650, rpmOpen: 380,
    noise: 0.3, lope: 0.45, lopeRate: 1 / 3, backfire: 0, gain: 0.64,
  },
  garbage_truck: {
    idleRpm: 520, redlineRpm: 3000, pulses: 3,
    waveA: 'square', waveB: 'sawtooth', ratioB: 0.5, detuneB: -8, mixB: 0.8,
    drive: 2, cutoff: 150, loadOpen: 600, rpmOpen: 350,
    noise: 0.32, lope: 0.5, lopeRate: 1 / 3, backfire: 0, gain: 0.64,
  },
  tow_truck: {
    idleRpm: 600, redlineRpm: 4000, pulses: 3,
    waveA: 'square', waveB: 'sawtooth', ratioB: 0.5, detuneB: 0, mixB: 0.75,
    drive: 1.7, cutoff: 180, loadOpen: 700, rpmOpen: 450,
    noise: 0.26, lope: 0.4, lopeRate: 1 / 3, backfire: 0, gain: 0.6,
  },
  ice_cream_van: {
    idleRpm: 700, redlineRpm: 4600, pulses: 2.5,
    waveA: 'square', waveB: 'triangle', ratioB: 1, detuneB: 12, mixB: 0.5,
    drive: 1.3, cutoff: 220, loadOpen: 800, rpmOpen: 600,
    noise: 0.14, lope: 0.18, lopeRate: 0.5, backfire: 0, gain: 0.5,
  },
  bus: {
    idleRpm: 500, redlineRpm: 2800, pulses: 3,
    waveA: 'square', waveB: 'sawtooth', ratioB: 0.5, detuneB: -10, mixB: 0.85,
    drive: 1.8, cutoff: 140, loadOpen: 560, rpmOpen: 320,
    noise: 0.34, lope: 0.48, lopeRate: 1 / 3, backfire: 0, gain: 0.66,
  },
  // Two-strokes and a sport bike: buzzy, high-revving, thin.
  scooter: {
    idleRpm: 1600, redlineRpm: 9500, pulses: 1,
    waveA: 'square', waveB: 'sawtooth', ratioB: 2, detuneB: 20, mixB: 0.45,
    drive: 2.8, cutoff: 700, loadOpen: 2200, rpmOpen: 2400,
    noise: 0.26, lope: 0.08, lopeRate: 1, backfire: 0.1, gain: 0.38,
  },
  cop_bike: {
    idleRpm: 1100, redlineRpm: 11000, pulses: 2,
    waveA: 'sawtooth', waveB: 'square', ratioB: 1, detuneB: 10, mixB: 0.5,
    drive: 3.2, cutoff: 650, loadOpen: 3000, rpmOpen: 3000,
    noise: 0.2, lope: 0.06, lopeRate: 0.5, backfire: 0.5, gain: 0.46,
  },
};

export const GEARS = 5;
/** Ratio between neighbouring gears. */
const GEAR_STEP = 1.38;
/** Top gear reaches the redline at this multiple of the car's top speed (never bounces off it). */
const TOP_GEAR_HEADROOM = 1.08;
/** Upshift at this fraction of the redline... */
const UPSHIFT_AT = 0.9;
/** ...and drop a gear below these (on the gas / coasting or braking). */
const DOWNSHIFT_DRIVING = 0.48;
const DOWNSHIFT_COASTING = 0.3;
/** Seconds the throttle is cut while a gear changes. */
export const SHIFT_TIME = 0.17;
/** Below this speed first gear's clutch slips, so throttle revs the engine freely. */
const CLUTCH_SPEED = 4;
/** Revs a stationary engine reaches at full throttle, as a fraction of the redline. */
const FREE_REV = 0.62;
/** Starter motor time before the engine catches. */
export const CRANK_TIME = 0.55;
/** Revs (× idle) when taking over a running engine. */
const WARM_BLIP = 1.45;

/** Firing frequency (Hz) of an engine turning at `rpm`. */
export function engineHz(rpm: number, p: EngineProfile): number {
  return (rpm / 60) * p.pulses;
}

export class EngineModel {
  rpm: number;
  /** 1..GEARS, or -1 in reverse. */
  gear = 1;
  /** Smoothed throttle the engine is pulling against, 0..1; cut to 0 during a shift. */
  load = 0;
  /** The starter motor is turning (see start()). */
  cranking = false;
  /** +1 / -1 on the step a gear change happened, else 0. */
  shifted: -1 | 0 | 1 = 0;
  /** True on the step the driver lifts off at high revs (overrun pops). */
  overrun = false;
  private shiftTimer = 0;
  private crankTimer = 0;
  private lastGas = 0;

  constructor(
    readonly profile: EngineProfile,
    readonly maxSpeed: number,
  ) {
    this.rpm = profile.idleRpm;
  }

  /** 0 at idle, 1 at the redline. */
  get rpmNorm(): number {
    const p = this.profile;
    return clamp01((this.rpm - p.idleRpm) / (p.redlineRpm - p.idleRpm));
  }

  get hz(): number {
    return engineHz(this.rpm, this.profile);
  }

  get shifting(): boolean {
    return this.shiftTimer > 0;
  }

  /** Speed (m/s) at which gear `g` reaches the redline. */
  gearTopSpeed(g: number): number {
    return (this.maxSpeed * TOP_GEAR_HEADROOM) / Math.pow(GEAR_STEP, GEARS - Math.max(1, g));
  }

  /** RPM the wheels force through gear `g` at `v` m/s. */
  wheelRpm(g: number, v: number): number {
    return (v / this.gearTopSpeed(g)) * this.profile.redlineRpm;
  }

  /** Turn the key: crank for CRANK_TIME, then catch with a flare of revs. */
  start(): void {
    this.cranking = true;
    this.crankTimer = CRANK_TIME;
    this.rpm = this.profile.idleRpm * 0.3;
    this.gear = 1;
    this.load = 0;
    this.shiftTimer = 0;
  }

  /** Take over an engine that's already running (a carjack): no starter, just a blip of revs that settles to idle. */
  warm(): void {
    this.cranking = false;
    this.crankTimer = 0;
    this.rpm = this.profile.idleRpm * WARM_BLIP;
    this.gear = 1;
    this.load = 0;
    this.shiftTimer = 0;
  }

  step(dt: number, forward: number, throttle: number, slip = 0): void {
    const p = this.profile;
    this.shifted = 0;
    this.overrun = false;
    if (this.cranking) {
      this.crankTimer -= dt;
      this.load = 0;
      if (this.crankTimer <= 0) {
        this.cranking = false;
        this.rpm = p.idleRpm * 1.9;
      }
      return;
    }

    const v = Math.abs(forward);
    const reversing = forward < -0.5 || (v < 0.5 && throttle < 0);
    const gas = reversing ? Math.max(0, -throttle) : Math.max(0, throttle);

    if (reversing) {
      this.gear = -1;
      this.shiftTimer = 0;
    } else {
      if (this.gear === -1) this.gear = 1;
      if (this.shiftTimer <= 0) this.chooseGear(v, gas);
    }
    const g = this.gear === -1 ? 1 : this.gear;
    const wheel = this.wheelRpm(g, v) * (this.gear === -1 ? 1.15 : 1);

    // A slipping clutch in first (or reverse) lets the throttle rev the engine at a standstill.
    const clutch = g === 1 ? clamp01(1 - v / CLUTCH_SPEED) : 0;
    let target = Math.max(p.idleRpm, wheel);
    if (clutch > 0) target = Math.max(target, p.idleRpm + gas * clutch * (FREE_REV * p.redlineRpm - p.idleRpm));
    // Wheelspin in a slide flares the revs.
    if (gas > 0 && slip > 3) target += p.redlineRpm * Math.min(0.15, (slip - 3) / 25);
    target = Math.min(target, p.redlineRpm * 1.02);

    // Redlines per second the needle can move: locked to the wheels when the clutch is in.
    const rate = this.shiftTimer > 0 ? 2.6 : clutch < 0.5 ? 7 : target > this.rpm ? 1.3 : 0.6;
    const maxDelta = rate * p.redlineRpm * dt;
    this.rpm += clamp(target - this.rpm, -maxDelta, maxDelta);

    const want = this.shiftTimer > 0 ? 0 : gas;
    const k = this.shiftTimer > 0 ? 40 : 14;
    this.load += (want - this.load) * Math.min(1, dt * k);
    if (this.shiftTimer > 0) this.shiftTimer = Math.max(0, this.shiftTimer - dt);

    if (this.lastGas > 0.5 && gas < 0.1 && this.rpmNorm > 0.5) this.overrun = true;
    this.lastGas = gas;
  }

  private chooseGear(v: number, gas: number): void {
    const norm = this.wheelRpm(this.gear, v) / this.profile.redlineRpm;
    if (this.gear < GEARS && norm > UPSHIFT_AT && gas > 0.05) {
      this.gear++;
      this.shifted = 1;
      this.shiftTimer = SHIFT_TIME;
      return;
    }
    if (this.gear <= 1) return;
    const lower = this.wheelRpm(this.gear - 1, v) / this.profile.redlineRpm;
    const floor = gas > 0.1 ? DOWNSHIFT_DRIVING : DOWNSHIFT_COASTING;
    // Kickdown: flooring it low in a tall gear drops one for the pull.
    const kickdown = gas > 0.85 && norm < 0.55 && lower < 0.85;
    if (norm < floor || kickdown) {
      this.gear--;
      this.shifted = -1;
      this.shiftTimer = SHIFT_TIME * 0.6;
    }
  }
}

export function createEngine(archetype: VehicleArchetype): EngineModel {
  return new EngineModel(ENGINE_PROFILES[archetype], VEHICLE_SPECS[archetype].maxSpeed);
}

/** Tyre squeal 0..1: sliding sideways, handbraking at speed, or braking hard. */
export function squealAmount(c: CarSound): number {
  const slide = smoothstep(2.5, 8, c.slip) * smoothstep(3, 9, c.speed);
  const hand = c.handbrake ? 0.55 * smoothstep(3, 14, c.speed) : 0;
  const braking = c.throttle < -0.3 && c.forwardSpeed > 10 ? 0.45 * -c.throttle * smoothstep(10, 26, c.forwardSpeed) : 0;
  return clamp01(Math.max(slide, hand, braking));
}

/** Tyre roar on the tarmac, 0..1. */
export function roadAmount(speedMs: number): number {
  return smoothstep(0.5, 40, speedMs);
}

/** Wind rush, 0..1: only at a real lick. */
export function windAmount(speedMs: number): number {
  return smoothstep(18, 48, speedMs);
}

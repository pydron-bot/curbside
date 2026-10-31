/**
 * Clip sampling for the character batch, without an AnimationMixer.
 *
 * Every body GLB carries the same 22 clips on the same 8 bones. A ClipBank
 * turns them, once per body, into samplers (one rotation interpolant per
 * bone, plus the root's position) shared by everyone wearing that body. Each
 * person then builds a pose by hand every frame: a locomotion base (Idle /
 * Walk / Run by speed), a whole-body layer over it (Fall, Down, GetUp,
 * Arrested, Cower, Cheer, EnterCar, Ride, Stagger) and upper-body layers
 * over that (Aim*, Shoot*, Punch*, Throw, Hail), each crossfaded by weight.
 *
 * Sampling by hand rather than through a mixer per person: no bookkeeping
 * per action, no garbage, layers that mask bones (arms over walking legs).
 * The clips key every bone, so a bone a clip leaves out is taken as its rest
 * pose; the exporter's constant scale and non-root position tracks are
 * dropped at load (they are the rest pose anyway).
 *
 * Each track is baked at load into evenly spaced frames in a Float32Array
 * (its own keys when they're even and linear, as Blender exports them;
 * constant tracks into one frame) and sampled with the math written inline:
 * three's interpolants box every keyframe read and blend through calls V8
 * doesn't inline, which made them ~10 KB of garbage a frame.
 */
import { InterpolateLinear, Quaternion, Vector3, type AnimationClip, type Interpolant, type KeyframeTrack, type Object3D } from 'three';

/** Bones the upper-body layers drive, as GLTFLoader names them ("arm.R" → "armR"). */
export const UPPER_BONES: readonly string[] = ['armR', 'armL', 'chest', 'head'];

/** Frames per second for tracks that aren't evenly keyed and linear (resampled). */
export const BAKE_FPS = 30;

/** A track baked into evenly spaced frames: `dim` values per frame, `step` s apart. */
export interface BakedTrack {
  readonly dim: number;
  readonly frames: number;
  readonly step: number;
  readonly values: Float32Array;
}

/** One clip ready to sample: per bone slot, its rotation track (null = rest), and the root's position. */
export interface ClipData {
  readonly name: string;
  readonly duration: number;
  readonly rot: ReadonlyArray<BakedTrack | null>;
  /** Position track for `posSlot` (the root bone), or null (rest). */
  readonly pos: BakedTrack | null;
}

/** The animated bones of one body and its clips by name. */
export class ClipBank {
  /** Animated bone names, by slot. */
  readonly bones: string[] = [];
  readonly restQ: Quaternion[] = [];
  readonly restP: Vector3[] = [];
  /** Slot whose position the clips move (the root bone), or -1. */
  readonly posSlot: number = -1;
  /** Slot lists for the layers' masks. */
  readonly all: number[] = [];
  readonly upper: number[] = [];
  private readonly clips = new Map<string, ClipData>();

  constructor(rig: Object3D, clips: readonly AnimationClip[]) {
    // Slots: every bone some clip rotates, found in the rig.
    for (const clip of clips) {
      for (const t of clip.tracks) {
        const [node, prop] = splitTrack(t);
        if (prop !== 'quaternion' || this.bones.includes(node)) continue;
        const bone = rig.getObjectByName(node);
        if (!bone) continue;
        this.bones.push(node);
        this.restQ.push(bone.quaternion.clone());
        this.restP.push(bone.position.clone());
      }
    }
    this.bones.forEach((name, i) => {
      this.all.push(i);
      if (UPPER_BONES.includes(name)) this.upper.push(i);
    });
    // The position track that actually moves something (the root's lift, lunge and kneel).
    let posSlot = -1;
    for (const clip of clips) {
      for (const t of clip.tracks) {
        const [node, prop] = splitTrack(t);
        const slot = this.bones.indexOf(node);
        if (prop === 'position' && slot >= 0 && !constantAt(t, this.restP[slot])) posSlot = posSlot < 0 ? slot : posSlot;
      }
    }
    this.posSlot = posSlot;
    for (const clip of clips) {
      const duration = Math.max(1e-3, clip.duration);
      const rot: Array<BakedTrack | null> = this.bones.map(() => null);
      let pos: BakedTrack | null = null;
      for (const t of clip.tracks) {
        const [node, prop] = splitTrack(t);
        const slot = this.bones.indexOf(node);
        if (slot < 0) continue;
        if (prop === 'quaternion') rot[slot] = bake(t, duration, 4);
        else if (prop === 'position' && slot === posSlot) pos = bake(t, duration, 3);
      }
      this.clips.set(clip.name, { name: clip.name, duration, rot, pos });
    }
  }

  get(name: string): ClipData | null {
    return this.clips.get(name) ?? null;
  }

  has(name: string): boolean {
    return this.clips.has(name);
  }
}

/** A pose under construction: one rotation per slot (x, y, z, w) and the root's position. */
export class Pose {
  readonly q: Float64Array;
  readonly p = new Float64Array(3);
  private readonly restQ: Float64Array;
  private readonly restP = new Float64Array(3);

  constructor(readonly bank: ClipBank) {
    this.restQ = new Float64Array(bank.restQ.length * 4);
    bank.restQ.forEach((q, i) => q.toArray(this.restQ, i * 4));
    if (bank.posSlot >= 0) bank.restP[bank.posSlot].toArray(this.restP);
    this.q = this.restQ.slice();
    this.p.set(this.restP);
  }

  /** Back to the rest pose. */
  rest(): void {
    this.q.set(this.restQ);
    this.p.set(this.restP);
  }

  /**
   * Blend `clip` at time `t` over the pose by `w` on the bones in `mask`
   * (the root's position too when the mask has it). A bone the clip leaves
   * out blends toward its rest pose.
   */
  overlay(clip: ClipData, t: number, w: number, mask: readonly number[]): void {
    if (w <= 0) return;
    const k = Math.min(1, w);
    const ps = this.bank.posSlot;
    for (let m = 0; m < mask.length; m++) {
      const i = mask[m];
      const s = clip.rot[i];
      if (s) {
        // Sample: nlerp between the two frames either side of t.
        const v = s.values;
        let a = 0;
        let f = 0;
        if (s.frames > 1) {
          const u = Math.max(0, t / s.step);
          a = Math.min(Math.floor(u), s.frames - 2);
          f = Math.min(1, u - a);
          a *= 4;
        }
        let x = v[a];
        let y = v[a + 1];
        let z = v[a + 2];
        let qw = v[a + 3];
        if (f > 0) {
          const b = a + 4;
          const sg = x * v[b] + y * v[b + 1] + z * v[b + 2] + qw * v[b + 3] < 0 ? -f : f;
          const g = 1 - f;
          x = x * g + v[b] * sg;
          y = y * g + v[b + 1] * sg;
          z = z * g + v[b + 2] * sg;
          qw = qw * g + v[b + 3] * sg;
          const n = 1 / Math.sqrt(x * x + y * y + z * z + qw * qw);
          x *= n;
          y *= n;
          z *= n;
          qw *= n;
        }
        const sq = sampleQ;
        sq[0] = x;
        sq[1] = y;
        sq[2] = z;
        sq[3] = qw;
        sq[4] = k;
        blendQ(this.q, i * 4, sq, 0);
      } else {
        sampleQ[4] = k;
        blendQ(this.q, i * 4, this.restQ, i * 4);
      }
      if (i === ps) {
        const pt = clip.pos;
        const out = this.p;
        if (pt) {
          const v = pt.values;
          let a = 0;
          let f = 0;
          if (pt.frames > 1) {
            const u = Math.max(0, t / pt.step);
            a = Math.min(Math.floor(u), pt.frames - 2);
            f = Math.min(1, u - a);
            a *= 3;
          }
          for (let c = 0; c < 3; c++) {
            const sv = f > 0 ? v[a + c] + (v[a + 3 + c] - v[a + c]) * f : v[a + c];
            out[c] += (sv - out[c]) * k;
          }
        } else {
          const r = this.restP;
          for (let c = 0; c < 3; c++) out[c] += (r[c] - out[c]) * k;
        }
      }
    }
  }

  /** Write the pose into a rig's bones (looked up per slot by the caller). */
  apply(bones: ReadonlyArray<Object3D | null>): void {
    const ps = this.bank.posSlot;
    const q = this.q;
    for (let i = 0; i < bones.length; i++) {
      const bone = bones[i];
      if (!bone) continue;
      const o = i * 4;
      bone.quaternion.set(q[o], q[o + 1], q[o + 2], q[o + 3]);
      if (i === ps) bone.position.set(this.p[0], this.p[1], this.p[2]);
    }
  }
}

/** The sampled rotation and the blend weight, handed to blendQ in an array (doubles passed as arguments get boxed). */
const sampleQ = new Float64Array(5);

/**
 * q[o..o+3] slerped toward src[so..so+3] by sampleQ[4], as three's
 * Quaternion.slerp (shortest way round, linear when nearly equal).
 */
function blendQ(q: Float64Array, o: number, src: Float64Array, so: number): void {
  const k = sampleQ[4];
  let x = src[so];
  let y = src[so + 1];
  let z = src[so + 2];
  let w = src[so + 3];
  if (k >= 1) {
    q[o] = x;
    q[o + 1] = y;
    q[o + 2] = z;
    q[o + 3] = w;
    return;
  }
  const ax = q[o];
  const ay = q[o + 1];
  const az = q[o + 2];
  const aw = q[o + 3];
  let cos = ax * x + ay * y + az * z + aw * w;
  if (cos < 0) {
    x = -x;
    y = -y;
    z = -z;
    w = -w;
    cos = -cos;
  }
  let ka = 1 - k;
  let kb = k;
  if (cos < 0.9995) {
    const sin = Math.sqrt(1 - cos * cos);
    const half = Math.atan2(sin, cos);
    ka = Math.sin(ka * half) / sin;
    kb = Math.sin(kb * half) / sin;
  }
  let rx = ax * ka + x * kb;
  let ry = ay * ka + y * kb;
  let rz = az * ka + z * kb;
  let rw = aw * ka + w * kb;
  if (cos >= 0.9995) {
    const n = 1 / Math.sqrt(rx * rx + ry * ry + rz * rz + rw * rw);
    rx *= n;
    ry *= n;
    rz *= n;
    rw *= n;
  }
  q[o] = rx;
  q[o + 1] = ry;
  q[o + 2] = rz;
  q[o + 3] = rw;
}

/** One clip playing in a layer. */
interface Slot {
  clip: ClipData | null;
  time: number;
  speed: number;
  loop: boolean;
}

/**
 * A layer of the pose: a clip (crossfading from the one before it) laid
 * over what's below by `weight`, which eases toward `target`.
 */
export class Layer {
  readonly cur: Slot = { clip: null, time: 0, speed: 1, loop: false };
  private readonly prev: Slot = { clip: null, time: 0, speed: 1, loop: false };
  /** The current clip's share against the one fading out, 0..1. */
  private fade = 1;
  private fadeRate = 10;
  weight = 0;
  target = 0;
  /** How fast `weight` moves toward `target`, per second. */
  rate = 8;

  /**
   * Start `clip` from `from` s at `speed`, crossfading from whatever was
   * showing over `fadeTime` s (a layer at no weight just fades in instead).
   */
  play(clip: ClipData, loop: boolean, from = 0, speed = 1, fadeTime = 0.12): void {
    if (this.weight > 0.02 && this.cur.clip && fadeTime > 0) {
      Object.assign(this.prev, this.cur);
      this.fade = 0;
      this.fadeRate = 1 / fadeTime;
    } else {
      this.prev.clip = null;
      this.fade = 1;
    }
    const c = this.cur;
    c.clip = clip;
    c.time = Math.min(from, clip.duration);
    c.speed = speed;
    c.loop = loop;
  }

  /** The current clip is a one-shot that has run to its end. */
  get finished(): boolean {
    const c = this.cur;
    return c.clip === null || (!c.loop && c.time >= c.clip.duration);
  }

  /** Share of the current one-shot played, 0..1 (1 for loops and nothing). */
  get progress(): number {
    const c = this.cur;
    return c.clip && !c.loop ? Math.min(1, c.time / c.clip.duration) : 1;
  }

  step(dt: number): void {
    this.weight += Math.sign(this.target - this.weight) * Math.min(Math.abs(this.target - this.weight), this.rate * dt);
    advance(this.cur, dt);
    if (this.prev.clip) {
      advance(this.prev, dt);
      this.fade = Math.min(1, this.fade + this.fadeRate * dt);
      if (this.fade >= 1) this.prev.clip = null;
    }
  }

  /** Lay the layer over `pose` on `mask`, scaled by `scale`. */
  apply(pose: Pose, mask: readonly number[], scale = 1): void {
    const w = this.weight * scale;
    if (w <= 0.001 || !this.cur.clip) return;
    if (this.prev.clip) pose.overlay(this.prev.clip, this.prev.time, w, mask);
    pose.overlay(this.cur.clip, this.cur.time, this.prev.clip ? w * this.fade : w, mask);
  }

  /** Drop everything at once (a pooled person reused). */
  clear(): void {
    this.cur.clip = this.prev.clip = null;
    this.weight = this.target = 0;
    this.fade = 1;
  }
}

function advance(s: Slot, dt: number): void {
  if (!s.clip) return;
  s.time += dt * s.speed;
  const d = s.clip.duration;
  if (s.loop) s.time = ((s.time % d) + d) % d;
  else s.time = Math.min(s.time, d);
}

/** "hips.quaternion" → ["hips", "quaternion"]. */
function splitTrack(t: KeyframeTrack): [string, string] {
  const dot = t.name.lastIndexOf('.');
  return [t.name.slice(0, dot), t.name.slice(dot + 1)];
}

/**
 * Bake a track into frames 0..duration through its own interpolant (slerp
 * for rotations, GLTF cubic splines too), once at load. A track that holds
 * one value the whole way bakes into a single frame.
 */
export function bake(t: KeyframeTrack, duration: number, dim: number): BakedTrack {
  const sampler = (t as unknown as { createInterpolant(): Interpolant }).createInterpolant();
  // Evenly spaced linear keys over the whole clip are kept as they are
  // (resampling them would cut the corners between keys); anything else is
  // resampled at BAKE_FPS. Either way the last frame lands exactly on
  // `duration` (GetUp, Throw and EnterCar time off it).
  const frames = evenKeys(t, duration) ? t.times.length : Math.max(2, Math.ceil(duration * BAKE_FPS) + 1);
  const step = duration / (frames - 1);
  const values = new Float32Array(frames * dim);
  for (let f = 0; f < frames; f++) {
    const v = sampler.evaluate(Math.min(duration, f * step)) as unknown as ArrayLike<number>;
    for (let c = 0; c < dim; c++) values[f * dim + c] = v[c];
  }
  for (let i = dim; i < values.length; i++) {
    if (Math.abs(values[i] - values[i % dim]) > 1e-6) return { dim, frames, step, values };
  }
  return { dim, frames: 1, step, values: values.slice(0, dim) };
}

/** Linear keys from 0 to `duration`, evenly spaced. */
function evenKeys(t: KeyframeTrack, duration: number): boolean {
  const k = t.times;
  const n = k.length;
  if (n < 2 || t.getInterpolation() !== InterpolateLinear || k[0] !== 0 || Math.abs(k[n - 1] - duration) > 1e-5) return false;
  const gap = duration / (n - 1);
  for (let i = 1; i < n; i++) if (Math.abs(k[i] - i * gap) > 1e-5) return false;
  return true;
}

/** Does a position track hold `rest` the whole way (as the exporter writes for every bone)? */
function constantAt(t: KeyframeTrack, rest: Vector3): boolean {
  const v = t.values;
  for (let i = 0; i + 2 < v.length; i += 3) {
    if (Math.abs(v[i] - rest.x) > 1e-4 || Math.abs(v[i + 1] - rest.y) > 1e-4 || Math.abs(v[i + 2] - rest.z) > 1e-4) return false;
  }
  return true;
}

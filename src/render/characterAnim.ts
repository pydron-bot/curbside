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
 * per action, no garbage, layers that mask bones (arms over walking legs),
 * and it costs a few dozen interpolant reads per person per frame. The
 * clips key every bone, so a bone a clip leaves out is taken as its rest
 * pose; the exporter's constant scale and non-root position tracks are
 * dropped at load (they are the rest pose anyway).
 */
import { Quaternion, Vector3, type AnimationClip, type Interpolant, type KeyframeTrack, type Object3D } from 'three';

/** Bones the upper-body layers drive, as GLTFLoader names them ("arm.R" → "armR"). */
export const UPPER_BONES: readonly string[] = ['armR', 'armL', 'chest', 'head'];

/** One clip ready to sample: per bone slot, its rotation sampler (null = rest), and the root's position. */
export interface ClipData {
  readonly name: string;
  readonly duration: number;
  readonly rot: ReadonlyArray<Interpolant | null>;
  /** Position sampler for `posSlot` (the root bone), or null (rest). */
  readonly pos: Interpolant | null;
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
      const rot: Array<Interpolant | null> = this.bones.map(() => null);
      let pos: Interpolant | null = null;
      for (const t of clip.tracks) {
        const [node, prop] = splitTrack(t);
        const slot = this.bones.indexOf(node);
        if (slot < 0) continue;
        if (prop === 'quaternion') rot[slot] = interpolant(t);
        else if (prop === 'position' && slot === posSlot) pos = interpolant(t);
      }
      this.clips.set(clip.name, { name: clip.name, duration: Math.max(1e-3, clip.duration), rot, pos });
    }
  }

  get(name: string): ClipData | null {
    return this.clips.get(name) ?? null;
  }

  has(name: string): boolean {
    return this.clips.has(name);
  }
}

/** A pose under construction: one rotation per slot and the root's position. */
export class Pose {
  readonly q: Quaternion[];
  readonly p = new Vector3();

  constructor(readonly bank: ClipBank) {
    this.q = bank.restQ.map((q) => q.clone());
    this.p.copy(bank.posSlot >= 0 ? bank.restP[bank.posSlot] : new Vector3());
  }

  /** Back to the rest pose. */
  rest(): void {
    const b = this.bank;
    for (let i = 0; i < this.q.length; i++) this.q[i].copy(b.restQ[i]);
    if (b.posSlot >= 0) this.p.copy(b.restP[b.posSlot]);
  }

  /**
   * Blend `clip` at time `t` over the pose by `w` on the bones in `mask`
   * (the root's position too when the mask has it). A bone the clip leaves
   * out blends toward its rest pose.
   */
  overlay(clip: ClipData, t: number, w: number, mask: readonly number[]): void {
    if (w <= 0) return;
    const b = this.bank;
    const k = Math.min(1, w);
    for (let m = 0; m < mask.length; m++) {
      const i = mask[m];
      const s = clip.rot[i];
      if (s) {
        const v = s.evaluate(t) as unknown as ArrayLike<number>;
        sampleQ.set(v[0], v[1], v[2], v[3]);
        this.q[i].slerp(sampleQ, k);
      } else this.q[i].slerp(b.restQ[i], k);
      if (i === b.posSlot) {
        if (clip.pos) {
          const v = clip.pos.evaluate(t) as unknown as ArrayLike<number>;
          sampleP.set(v[0], v[1], v[2]);
          this.p.lerp(sampleP, k);
        } else this.p.lerp(b.restP[i], k);
      }
    }
  }

  /** Write the pose into a rig's bones (looked up per slot by the caller). */
  apply(bones: ReadonlyArray<Object3D | null>): void {
    const ps = this.bank.posSlot;
    for (let i = 0; i < bones.length; i++) {
      const bone = bones[i];
      if (!bone) continue;
      bone.quaternion.copy(this.q[i]);
      if (i === ps) bone.position.copy(this.p);
    }
  }
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

const sampleQ = new Quaternion();
const sampleP = new Vector3();

/** "hips.quaternion" → ["hips", "quaternion"]. */
function splitTrack(t: KeyframeTrack): [string, string] {
  const dot = t.name.lastIndexOf('.');
  return [t.name.slice(0, dot), t.name.slice(dot + 1)];
}

/** Each track has its own interpolant factory (slerp for rotations, GLTF cubic splines too). */
function interpolant(t: KeyframeTrack): Interpolant {
  return (t as unknown as { createInterpolant(): Interpolant }).createInterpolant();
}

/** Does a position track hold `rest` the whole way (as the exporter writes for every bone)? */
function constantAt(t: KeyframeTrack, rest: Vector3): boolean {
  const v = t.values;
  for (let i = 0; i + 2 < v.length; i += 3) {
    if (Math.abs(v[i] - rest.x) > 1e-4 || Math.abs(v[i + 1] - rest.y) > 1e-4 || Math.abs(v[i + 2] - rest.z) > 1e-4) return false;
  }
  return true;
}

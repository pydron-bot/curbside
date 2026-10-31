import { readFileSync } from 'node:fs';
import {
  AnimationClip,
  Group,
  InterpolateDiscrete,
  Object3D,
  PropertyBinding,
  Quaternion,
  QuaternionKeyframeTrack,
  Vector3,
  VectorKeyframeTrack,
  type KeyframeTrack,
} from 'three';
import { describe, expect, it } from 'vitest';
import { ClipBank, Pose, bake } from '../src/render/characterAnim';

const BODIES = ['player', 'ped_slim', 'ped_stocky', 'ped_coat', 'cop', 'pike', 'tuna', 'vex'];

/**
 * The bones and clips of a body GLB, read straight from the file (the
 * animation accessors aren't Draco-compressed, so no loader is needed).
 * Node names are sanitised the way GLTFLoader does ("arm.R" → "armR").
 */
function readBody(name: string): { rig: Group; clips: AnimationClip[] } {
  const d = readFileSync(`public/assets/${name}.glb`);
  const jsonLen = d.readUInt32LE(12);
  const gltf = JSON.parse(d.subarray(20, 20 + jsonLen).toString('utf8'));
  const binStart = 20 + jsonLen + 8;
  const floats = (index: number): Float32Array => {
    const acc = gltf.accessors[index];
    const view = gltf.bufferViews[acc.bufferView];
    const n = acc.count * { SCALAR: 1, VEC3: 3, VEC4: 4 }[acc.type as 'SCALAR' | 'VEC3' | 'VEC4'];
    const at = binStart + (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    return new Float32Array(d.buffer.slice(d.byteOffset + at, d.byteOffset + at + n * 4));
  };
  const nodeName = (i: number) => PropertyBinding.sanitizeNodeName(gltf.nodes[i].name);
  const rig = new Group();
  gltf.nodes.forEach((n: { name: string; rotation?: number[]; translation?: number[] }, i: number) => {
    const o = new Object3D();
    o.name = nodeName(i);
    if (n.rotation) o.quaternion.fromArray(n.rotation);
    if (n.translation) o.position.fromArray(n.translation);
    rig.add(o);
  });
  const clips = gltf.animations.map((a: { name: string; channels: any[]; samplers: any[] }) => {
    const tracks: KeyframeTrack[] = [];
    for (const ch of a.channels) {
      const s = a.samplers[ch.sampler];
      const times = Array.from(floats(s.input));
      const values = Array.from(floats(s.output));
      const step = s.interpolation === 'STEP' ? InterpolateDiscrete : undefined;
      const node = nodeName(ch.target.node);
      if (ch.target.path === 'rotation') tracks.push(new QuaternionKeyframeTrack(`${node}.quaternion`, times, values, step));
      else if (ch.target.path === 'translation') tracks.push(new VectorKeyframeTrack(`${node}.position`, times, values, step));
    }
    return new AnimationClip(a.name, -1, tracks);
  });
  return { rig, clips };
}

/** Deterministic times across a clip, including both ends. */
function times(duration: number, n: number): number[] {
  let seed = 7;
  const out = [0, duration];
  for (let i = 0; i < n; i++) {
    seed = (seed * 16807) % 2147483647;
    out.push((seed / 2147483647) * duration);
  }
  return out;
}

describe('baked clip sampling', () => {
  it.each(BODIES)('%s: every clip and bone matches three’s own interpolants', (name) => {
    const { rig, clips } = readBody(name);
    const bank = new ClipBank(rig, clips);
    const pose = new Pose(bank);
    const want = new Quaternion();
    const got = new Quaternion();
    const wantP = new Vector3();
    let worstDot = 1;
    let worstP = 0;
    for (const clip of clips) {
      const data = bank.get(clip.name)!;
      for (const track of clip.tracks) {
        const [node, prop] = [track.name.slice(0, track.name.lastIndexOf('.')), track.name.slice(track.name.lastIndexOf('.') + 1)];
        const slot = bank.bones.indexOf(node);
        if (slot < 0) continue;
        if (prop === 'position' && slot !== bank.posSlot) continue;
        const sampler = (track as unknown as { createInterpolant(): { evaluate(t: number): ArrayLike<number> } }).createInterpolant();
        for (const t of times(data.duration, 200)) {
          pose.rest();
          pose.overlay(data, t, 1, [slot]);
          const v = sampler.evaluate(t);
          if (prop === 'quaternion') {
            want.set(v[0], v[1], v[2], v[3]).normalize();
            got.fromArray(pose.q, slot * 4);
            worstDot = Math.min(worstDot, Math.abs(want.dot(got)));
          } else {
            wantP.set(v[0], v[1], v[2]);
            worstP = Math.max(worstP, Math.hypot(pose.p[0] - wantP.x, pose.p[1] - wantP.y, pose.p[2] - wantP.z));
          }
        }
      }
    }
    expect(worstDot).toBeGreaterThan(0.9999);
    expect(worstP).toBeLessThan(2e-3);
  });

  it('keeps the clip’s exact end and collapses constant tracks to one frame', () => {
    const t = new VectorKeyframeTrack('root.position', [0, 0.7], [0, 1, 0, 0, 3, 0]);
    const baked = bake(t, 0.7, 3);
    expect((baked.frames - 1) * baked.step).toBeCloseTo(0.7, 12);
    expect(Array.from(baked.values.slice(-3))).toEqual([0, 3, 0]);
    const still = bake(new VectorKeyframeTrack('root.position', [0, 1], [1, 2, 3, 1, 2, 3]), 1, 3);
    expect(still.frames).toBe(1);
    expect(Array.from(still.values)).toEqual([1, 2, 3]);
  });

  it('blends a layer by weight as three’s slerp does', () => {
    const { rig, clips } = readBody('player');
    const bank = new ClipBank(rig, clips);
    const pose = new Pose(bank);
    const walk = bank.get('Walk')!;
    const run = bank.get('Run')!;
    for (const slot of bank.all) {
      pose.rest();
      pose.overlay(walk, 0.3, 1, [slot]);
      const a = new Quaternion().fromArray(pose.q, slot * 4);
      pose.rest();
      pose.overlay(run, 0.2, 1, [slot]);
      const b = new Quaternion().fromArray(pose.q, slot * 4);
      pose.rest();
      pose.overlay(walk, 0.3, 1, [slot]);
      pose.overlay(run, 0.2, 0.35, [slot]);
      const got = new Quaternion().fromArray(pose.q, slot * 4);
      expect(Math.abs(got.dot(a.clone().slerp(b, 0.35)))).toBeGreaterThan(0.999999);
    }
  });
});

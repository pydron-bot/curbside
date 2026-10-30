import { AnimationClip, Bone, Color, Group, Quaternion, QuaternionKeyframeTrack, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { CharacterModel, type CharacterBatch } from '../src/render/characterModel';

/** A stand-in for the GLB: a root, hips, chest, head and arms, plus whichever clips the test gives. */
function template(clipNames: string[]) {
  const rig = new Group();
  const hips = new Bone();
  hips.name = 'hips';
  const chest = new Bone();
  chest.name = 'chest';
  const head = new Bone();
  head.name = 'head';
  const armR = new Bone();
  armR.name = 'armR';
  const armL = new Bone();
  armL.name = 'armL';
  rig.add(hips);
  hips.add(chest);
  chest.add(head, armR, armL);
  // Each clip turns the hips (legs) and the right arm by its own angle, so a pose says which clips played.
  const angle = (name: string) => 0.1 + clipNames.indexOf(name) * 0.1;
  const clips = clipNames.map((name) => {
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), angle(name)).toArray();
    return new AnimationClip(name, 1, [
      new QuaternionKeyframeTrack('hips.quaternion', [0, 1], [...q, ...q]),
      new QuaternionKeyframeTrack('armR.quaternion', [0, 1], [...q, ...q]),
    ]);
  });
  return {
    t: { rig, boneNames: ['hips', 'chest', 'head', 'armR', 'armL'], clips, walkSpeed: 1.6, palette: [0, 1, 2, 3, 4].map(() => new Color()) },
    angle,
  };
}

const batch = { defaultColour: (_i: number, out: Color) => out, forget() {} } as unknown as CharacterBatch;

function model(clips: string[]) {
  const m = new CharacterModel(batch, {});
  const { t, angle } = template(clips);
  m.attach(t as unknown as Parameters<CharacterModel['attach']>[0]);
  const bone = (name: string) => (m as unknown as { rig: Group }).rig.getObjectByName(name)!;
  /** Rotation about Z of a bone (what the fake clips animate). */
  const zAngle = (name: string) => 2 * Math.atan2(bone(name).quaternion.z, bone(name).quaternion.w);
  return { m, bone, zAngle, angle };
}

describe('character animation hooks', () => {
  it('blends Idle → Walk → Run by speed when the clips exist', () => {
    const { m, zAngle, angle } = model(['Idle', 'Walk', 'Run']);
    m.update(0.016, 0);
    expect(zAngle('hips')).toBeCloseTo(angle('Idle'), 2);
    m.update(0.016, 1.6);
    expect(zAngle('hips')).toBeCloseTo(angle('Walk'), 2);
    m.update(0.016, 6);
    expect(zAngle('hips')).toBeCloseTo(angle('Run'), 2);
  });

  it('without a Run clip, sprints on a faster Walk and leans into it', () => {
    const { m, zAngle, angle } = model(['Idle', 'Walk']);
    for (let i = 0; i < 30; i++) m.update(0.016, 6);
    expect(zAngle('hips')).toBeCloseTo(angle('Walk'), 2);
    expect(m.body.rotation.x).toBeGreaterThan(0.05);
  });

  it('Aim plays on the arms only, over the legs; without it the arms are raised by hand', () => {
    const withAim = model(['Idle', 'Walk', 'Aim']);
    withAim.m.armed = 'one';
    for (let i = 0; i < 40; i++) withAim.m.update(0.016, 1.6);
    expect(withAim.zAngle('hips')).toBeCloseTo(withAim.angle('Walk'), 2); // legs keep walking
    expect(withAim.zAngle('armR')).toBeCloseTo(withAim.angle('Aim'), 2); // arm holds the aim

    const fake = model(['Idle', 'Walk']);
    fake.m.update(0.016, 0);
    const rest = fake.bone('armR').quaternion.clone();
    fake.m.armed = 'two';
    for (let i = 0; i < 40; i++) fake.m.update(0.016, 0);
    expect(fake.bone('armR').quaternion.angleTo(rest)).toBeGreaterThan(1); // raised forward
    fake.m.armed = false;
    for (let i = 0; i < 60; i++) fake.m.update(0.016, 0);
    expect(fake.bone('armR').quaternion.angleTo(rest)).toBeLessThan(0.05);
  });

  it('knocked down: Fall then Down with clips (the body stays upright); tipped over without', () => {
    const clips = model(['Idle', 'Walk', 'Fall', 'Down', 'GetUp']);
    clips.m.update(0.016, 0, true);
    expect(clips.zAngle('hips')).toBeCloseTo(clips.angle('Fall'), 2);
    for (let i = 0; i < 50; i++) clips.m.update(0.016, 0, true);
    expect(clips.zAngle('hips')).toBeCloseTo(clips.angle('Down'), 2);
    expect(clips.m.lying).toBe(true);
    expect(clips.m.body.rotation.x).toBe(0);
    clips.m.update(0.016, 0, false);
    expect(clips.zAngle('hips')).toBeCloseTo(clips.angle('GetUp'), 2);
    for (let i = 0; i < 70; i++) clips.m.update(0.016, 0, false);
    expect(clips.zAngle('hips')).toBeCloseTo(clips.angle('Idle'), 2);

    const fake = model(['Idle', 'Walk']);
    for (let i = 0; i < 40; i++) fake.m.update(0.016, 0, true);
    expect(fake.m.lying).toBe(true);
    expect(fake.m.body.rotation.x).toBeLessThan(-1.4);
  });

  it('punches, shots and staggers move the upper body and settle', () => {
    const { m, bone } = model(['Idle', 'Walk']);
    m.update(0.016, 0);
    const restR = bone('armR').quaternion.clone();
    const restL = bone('armL').quaternion.clone();
    m.punch(1); // a left
    m.update(0.06, 0);
    expect(bone('armL').quaternion.angleTo(restL)).toBeGreaterThan(0.5);
    for (let i = 0; i < 30; i++) m.update(0.016, 0);
    m.shoot();
    m.update(0.016, 0);
    expect(bone('armR').quaternion.angleTo(restR)).toBeGreaterThan(0.1);
    m.stagger();
    for (let i = 0; i < 5; i++) m.update(0.016, 0);
    expect(m.body.rotation.x).toBeLessThan(-0.05);
    for (let i = 0; i < 60; i++) m.update(0.016, 0);
    expect(Math.abs(m.body.rotation.x)).toBeLessThan(0.02);
  });
});

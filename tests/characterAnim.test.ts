import { AnimationClip, Bone, Color, Group, Matrix4, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack } from 'three';
import { describe, expect, it } from 'vitest';
import { CharacterModel, poseFor, type CharacterBatch } from '../src/render/characterModel';
import { ClipBank } from '../src/render/characterAnim';
import { PeoplePose, POSE_MARGIN, nearView } from '../src/render/peoplePose';
import { EventBus } from '../src/core/events';
import type { Player } from '../src/game/player';

/**
 * A stand-in for a body GLB: root, hips, chest, head and arms, plus whichever
 * clips the test gives. Each clip turns every bone about Z by its own angle
 * (so a pose says which clip a bone is showing) and lifts the root by it.
 */
function template(clipNames: string[], durations: Record<string, number> = {}) {
  const rig = new Group();
  const bone = (name: string) => Object.assign(new Bone(), { name });
  const root = bone('root');
  const hips = bone('hips');
  const chest = bone('chest');
  const head = bone('head');
  const armR = bone('armR');
  const armL = bone('armL');
  armR.position.set(-0.27, 0.3, 0);
  rig.add(root);
  root.add(hips);
  hips.add(chest);
  chest.add(head, armR, armL);
  const angle = (name: string) => 0.1 + clipNames.indexOf(name) * 0.1;
  const clips = clipNames.map((name) => {
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), angle(name)).toArray();
    const d = durations[name] ?? 1;
    const tracks = ['root', 'hips', 'chest', 'head', 'armR', 'armL'].map((b) => new QuaternionKeyframeTrack(`${b}.quaternion`, [0, d], [...q, ...q]));
    const y = angle(name);
    return new AnimationClip(name, d, [...tracks, new VectorKeyframeTrack('root.position', [0, d], [0, y, 0, 0, y, 0])]);
  });
  return {
    t: { rig, boneNames: ['hips', 'chest', 'head', 'armR', 'armL'], clips, walkSpeed: 1.6, palette: [0, 1, 2, 3, 4, 5].map(() => new Color()) },
    angle,
  };
}

const batch = { kind: 'player', defaultColour: (_i: number, out: Color) => out, forget() {} } as unknown as CharacterBatch;

const ALL = ['Idle', 'Walk', 'Run', 'Punch', 'Punch2', 'Uppercut', 'Aim', 'AimBoth', 'AimRocket', 'Shoot', 'ShootBoth', 'ShootRocket', 'Throw', 'Stagger', 'Fall', 'Down', 'GetUp', 'Arrested', 'EnterCar', 'Hail', 'Cower', 'Cheer', 'Ride'];
const SHORT: Record<string, number> = { Punch: 0.333, Punch2: 0.333, Uppercut: 0.417, Shoot: 0.125, ShootBoth: 0.125, ShootRocket: 0.208, Throw: 0.417, Stagger: 0.292, Fall: 0.5, GetUp: 0.917, EnterCar: 0.5 };

function model(clips: string[]) {
  const m = new CharacterModel(batch, {});
  const { t, angle } = template(clips, SHORT);
  m.attach(t as unknown as Parameters<CharacterModel['attach']>[0]);
  const bone = (name: string) => (m as unknown as { rig: Group }).rig.getObjectByName(name)!;
  /** Rotation about Z of a bone (what the fake clips animate). */
  const zAngle = (name: string) => 2 * Math.atan2(bone(name).quaternion.z, bone(name).quaternion.w);
  const run = (frames: number, speed = 0, down = false, downLeft = Infinity) => {
    for (let i = 0; i < frames; i++) m.update(1 / 60, speed, down, downLeft);
  };
  return { m, bone, zAngle, angle, run };
}

describe('character animation: legs', () => {
  it('blends Idle → Walk → Run by speed when the clips exist', () => {
    const { m, zAngle, angle } = model(['Idle', 'Walk', 'Run']);
    m.update(0.016, 0);
    expect(zAngle('hips')).toBeCloseTo(angle('Idle'), 2);
    m.update(0.016, 1.6);
    expect(zAngle('hips')).toBeCloseTo(angle('Walk'), 2);
    m.update(0.016, 6);
    expect(zAngle('hips')).toBeCloseTo(angle('Run'), 2);
    // Halfway between walking and running: both, evenly.
    m.update(0.016, 3.75);
    expect(zAngle('hips')).toBeCloseTo((angle('Walk') + angle('Run')) / 2, 2);
  });

  it('without a Run clip, sprints on a faster Walk and leans into it', () => {
    const { m, zAngle, angle, run } = model(['Idle', 'Walk']);
    run(30, 6);
    expect(zAngle('hips')).toBeCloseTo(angle('Walk'), 2);
    expect(m.body.rotation.x).toBeGreaterThan(0.05);
  });
});

describe('character animation: arms', () => {
  it('each weapon raises its own aim over the legs; without the clips the arms are raised by hand', () => {
    const { m, zAngle, angle, run } = model(ALL);
    for (const [weapon, clip] of [['pistol', 'Aim'], ['smg', 'AimBoth'], ['shotgun', 'AimBoth'], ['rocket', 'AimRocket']] as const) {
      m.hold(weapon);
      run(40, 1.6);
      expect(zAngle('hips'), weapon).toBeCloseTo(angle('Walk'), 2); // legs keep walking
      expect(zAngle('armR'), weapon).toBeCloseTo(angle(clip), 2);
      expect(m.aimAmount).toBeGreaterThan(0.95);
    }
    // Throwables are held low: no aim.
    m.hold('grenade');
    run(40, 0);
    expect(zAngle('armR')).toBeCloseTo(angle('Idle'), 2);
    expect(m.aimAmount).toBeLessThan(0.05);

    const fake = model(['Idle', 'Walk']);
    fake.m.update(0.016, 0);
    const rest = fake.bone('armR').quaternion.clone();
    fake.m.armed = 'two';
    fake.run(40);
    expect(fake.bone('armR').quaternion.angleTo(rest)).toBeGreaterThan(1); // raised forward
    fake.m.armed = false;
    fake.run(60);
    expect(fake.bone('armR').quaternion.angleTo(rest)).toBeLessThan(0.05);
  });

  it('a shot plays the kick that matches the aim', () => {
    for (const [weapon, clip] of [['pistol', 'Shoot'], ['shotgun', 'ShootBoth'], ['rocket', 'ShootRocket']] as const) {
      const { m, zAngle, angle, run } = model(ALL);
      m.hold(weapon);
      run(30);
      m.shoot();
      run(4);
      expect(zAngle('armR'), weapon).toBeCloseTo(angle(clip), 1);
      run(40);
      expect(zAngle('armR'), weapon).toBeCloseTo(angle(poseFor(weapon) === 'one' ? 'Aim' : poseFor(weapon) === 'two' ? 'AimBoth' : 'AimRocket'), 2);
    }
  });

  it('the punch combo plays Punch, Punch2 and Uppercut over the legs, then lets go', () => {
    const { m, zAngle, angle, run } = model(ALL);
    run(5, 1.6);
    PUNCHES.forEach((clip, step) => {
      m.punch(step);
      run(6, 1.6);
      expect(zAngle('armR'), clip).toBeCloseTo(angle(clip), 1);
      expect(zAngle('hips'), clip).toBeCloseTo(angle('Walk'), 2);
    });
    run(60, 1.6);
    expect(zAngle('armR')).toBeCloseTo(angle('Walk'), 2);
  });

  it('a throw plays Throw and hides what was in the hand until the arm is back', () => {
    const { m, zAngle, angle, run } = model(ALL);
    m.hold('molotov');
    run(5);
    expect(m.showsWeapon).toBe(true);
    m.throw();
    run(4);
    expect(zAngle('armR')).toBeCloseTo(angle('Throw'), 1);
    expect(m.showsWeapon).toBe(false);
    run(30);
    expect(m.showsWeapon).toBe(true);
  });

  it('hails while asked to (Hail on the arms), then stops', () => {
    const { m, zAngle, angle, run } = model(ALL);
    for (let i = 0; i < 4; i++) {
      m.hail(0.8);
      run(30);
      expect(zAngle('armR')).toBeCloseTo(angle('Hail'), 2);
    }
    run(60);
    expect(zAngle('armR')).toBeCloseTo(angle('Idle'), 2);
  });

  it('the weapon grip sits at the hand, along the arm when lowered and straight ahead when aimed', () => {
    const { m, run } = model(ALL);
    const g = new Matrix4();
    m.hold('pistol', false);
    run(40);
    expect(m.gripMatrix(g)).toBe(true);
    const lowered = new Vector3(0, 0, 1).transformDirection(g);
    m.hold('pistol', true);
    run(40);
    m.gripMatrix(g);
    const aimed = new Vector3(0, 0, 1).transformDirection(g);
    expect(aimed.z).toBeCloseTo(1, 3);
    expect(lowered.distanceTo(aimed)).toBeGreaterThan(0.5);
  });
});

const PUNCHES = ['Punch', 'Punch2', 'Uppercut'];

describe('character animation: whole body', () => {
  it('knocked down: Fall, then Down, then GetUp timed to finish as they rise; the body is never tipped', () => {
    const { m, zAngle, angle, run } = model(ALL);
    run(5, 1.6);
    run(6, 0, true, 3);
    expect(zAngle('hips')).toBeCloseTo(angle('Fall'), 2);
    // The root moves with the clip (lays the body down), not the instance transform.
    expect(m.body.rotation.x).toBe(0);
    run(40, 0, true, 2);
    expect(zAngle('hips')).toBeCloseTo(angle('Down'), 2);
    expect(m.lying).toBe(true);
    expect(m.showsWeapon).toBe(false);
    // Up soon: GetUp starts while still down, so they're standing when they can move.
    run(12, 0, true, 0.5);
    expect(zAngle('hips')).toBeCloseTo(angle('GetUp'), 2);
    run(40, 3);
    expect(zAngle('hips')).toBeCloseTo(angle('Walk'), 2);
    expect(m.lying).toBe(false);
    expect(m.body.rotation.x).toBe(0);
  });

  it('without the clips a knock-down tips the whole body over (and back)', () => {
    const fake = model(['Idle', 'Walk']);
    fake.run(40, 0, true);
    expect(fake.m.lying).toBe(true);
    expect(fake.m.body.rotation.x).toBeLessThan(-1.4);
    fake.run(60);
    expect(fake.m.body.rotation.x).toBeGreaterThan(-0.05);
  });

  it('busted kneels in Arrested (not a fall), and only lies down without the clip', () => {
    const { m, zAngle, angle, run } = model(ALL);
    m.arrested = true;
    run(30, 0, true, 3);
    expect(zAngle('hips')).toBeCloseTo(angle('Arrested'), 2);
    expect(m.body.rotation.x).toBe(0);
    expect(m.kneeling).toBe(true);
    expect(m.lying).toBe(false);

    const fake = model(['Idle', 'Walk']);
    fake.m.arrested = true;
    fake.run(40, 0, true);
    expect(fake.m.lying).toBe(true);
  });

  it('a hit plays Stagger over the legs and a fresh hit restarts it', () => {
    const { m, zAngle, angle, run } = model(ALL);
    m.stagger(0.3);
    run(4);
    expect(zAngle('hips')).toBeCloseTo(angle('Stagger'), 1);
    expect(m.body.rotation.x).toBe(0);
    run(40);
    expect(zAngle('hips')).toBeCloseTo(angle('Idle'), 2);

    const fake = model(['Idle', 'Walk']);
    fake.m.stagger();
    fake.run(5);
    expect(fake.m.body.rotation.x).toBeLessThan(-0.05);
    fake.run(60);
    expect(Math.abs(fake.m.body.rotation.x)).toBeLessThan(0.02);
  });

  it("follows the sim's stagger: a rise is a hit, a countdown held still (sim frozen) plays it once", () => {
    const { m, zAngle, angle } = model(ALL);
    // A hit, then the sim stops (a card over the game) while people keep moving.
    for (let i = 0; i < 60; i++) {
      m.followStagger(0.3);
      m.update(1 / 60, 0);
    }
    expect(zAngle('hips')).toBeCloseTo(angle('Idle'), 2); // played once, not restarted every few frames
    // A fresh hit while the sim runs again.
    m.followStagger(0.25);
    m.followStagger(0.3);
    m.update(1 / 60, 0);
    m.update(1 / 60, 0);
    expect((m as unknown as { fullState: string }).fullState).toBe('stagger');
  });

  it('cowers, cheers (standing only), rides and gets in a car on request', () => {
    const { m, zAngle, angle, run } = model(ALL);
    m.cowering = true;
    run(30, 0);
    expect(zAngle('hips')).toBeCloseTo(angle('Cower'), 2);
    m.cowering = false;
    m.cheer(2);
    run(30, 0);
    expect(zAngle('hips')).toBeCloseTo(angle('Cheer'), 2);
    m.cheer(2);
    run(30, 2);
    expect(zAngle('hips')).toBeCloseTo(angle('Walk'), 2); // no cheering on the move
    m.riding = true;
    run(30, 0);
    expect(zAngle('hips')).toBeCloseTo(angle('Ride'), 2);
    m.riding = false;
    expect(m.enterCar()).toBeCloseTo(0.5, 3);
    run(6, 0);
    expect(zAngle('hips')).toBeCloseTo(angle('EnterCar'), 1);
  });

  it('the upper-body aim gives way to a whole-body clip, and comes back after', () => {
    const { m, zAngle, angle, run } = model(ALL);
    m.hold('smg');
    run(30);
    expect(zAngle('armR')).toBeCloseTo(angle('AimBoth'), 2);
    m.cowering = true;
    run(30);
    expect(zAngle('armR')).toBeCloseTo(angle('Cower'), 2);
    m.cowering = false;
    run(30);
    expect(zAngle('armR')).toBeCloseTo(angle('AimBoth'), 2);
  });

  it('reset() stands a pooled person straight back up with nothing playing', () => {
    const { m, zAngle, angle, run } = model(ALL);
    run(60, 0, true, 5);
    m.reset();
    run(1, 0);
    expect(zAngle('hips')).toBeCloseTo(angle('Idle'), 2);
    expect(m.lying).toBe(false);
  });
});

describe('clip bank', () => {
  it('keeps rotations for every bone and only the position track that moves', () => {
    const { t } = template(['Idle', 'Walk']);
    // A constant position track on another bone (as the exporter writes for every bone) is dropped.
    t.clips[0].tracks.push(new VectorKeyframeTrack('hips.position', [0, 1], [0, 0, 0, 0, 0, 0]));
    const bank = new ClipBank(t.rig, t.clips);
    expect(bank.bones).toEqual(['root', 'hips', 'chest', 'head', 'armR', 'armL']);
    expect(bank.bones[bank.posSlot]).toBe('root');
    expect(bank.upper.map((i) => bank.bones[i]).sort()).toEqual(['armL', 'armR', 'chest', 'head']);
    expect(bank.get('Walk')!.rot.every((r) => r !== null)).toBe(true);
    expect(bank.get('Nope')).toBeNull();
  });
});

describe('boarding (PeoplePose)', () => {
  it('steps to the door of a car at hand, but is in at once when put into one across town', () => {
    const { m } = model(ALL);
    const bus = new EventBus();
    const car = { sim: { x: 0, z: 0, heading: 0, vx: 0, vz: 0 }, mesh: { root: { visible: true } } };
    const player = { driving: null as typeof car | null, alive: true, down: false };
    new PeoplePose({ bus, player: player as unknown as Player, model: m, crowd: [], locked: () => false, playing: () => true });
    // Beside the driver's door (left of the car): EnterCar, still shown.
    m.root.position.set(2.5, 0, 0.3);
    player.driving = car;
    bus.emit({ type: 'enterVehicle', archetype: 'sedan' });
    expect(m.root.visible).toBe(true);
    // A Chaos Run's start: boarded 120 m away, no slide across the city.
    m.reset();
    m.root.visible = true;
    m.root.position.set(120, 0, 40);
    bus.emit({ type: 'enterVehicle', archetype: 'sports' });
    expect(m.root.visible).toBe(false);
  });
});

describe('character animation: off screen', () => {
  const BONES = ['root', 'hips', 'chest', 'head', 'armR', 'armL'];
  /** Walk with a gun, get knocked down, lie there, get up and wave: `hidden` says which frames are off screen. */
  function script(hidden: (frame: number) => boolean) {
    const { m, bone } = model(ALL);
    m.hold('pistol', true);
    for (let i = 0; i < 240; i++) {
      const down = i >= 60 && i < 150;
      if (i === 30) m.punch(1);
      if (i === 170) m.hail(1);
      m.update(1 / 60, down ? 0 : 1.6 + (i % 7) * 0.3, down, down ? (150 - i) / 60 : Infinity, !hidden(i));
    }
    return { m, bone };
  }

  it('advances clips and timers while hidden, so the first frame back matches never hiding', () => {
    const shown = script(() => false);
    const back = script((i) => i < 239 && (i % 50 > 5 || i > 200));
    for (const name of BONES) {
      const a = shown.bone(name);
      const b = back.bone(name);
      expect(b.quaternion.angleTo(a.quaternion), name).toBeLessThan(1e-6);
      expect(b.position.distanceTo(a.position), name).toBeLessThan(1e-6);
      expect(b.matrixWorld.equals(a.matrixWorld), name).toBe(true);
    }
    expect(back.m.body.rotation.x).toBeCloseTo(shown.m.body.rotation.x, 6);
    // Still hidden on the last frame, the bones are left behind (the skip is real).
    const stale = script((i) => i > 200);
    expect(BONES.some((name) => stale.bone(name).quaternion.angleTo(shown.bone(name).quaternion) > 1e-3)).toBe(true);
  });

  it('nearView takes in the visible ground plus a margin wider than the draw cull', () => {
    const view = { minX: -10, minZ: -5, maxX: 10, maxZ: 5 };
    expect(nearView(view, 0, 0, POSE_MARGIN)).toBe(true);
    expect(nearView(view, 10 + POSE_MARGIN - 0.1, 0, POSE_MARGIN)).toBe(true);
    expect(nearView(view, 10 + POSE_MARGIN + 0.1, 0, POSE_MARGIN)).toBe(false);
    expect(nearView(view, 0, -5 - POSE_MARGIN - 0.1, POSE_MARGIN)).toBe(false);
    expect(POSE_MARGIN).toBeGreaterThan(8);
  });
});

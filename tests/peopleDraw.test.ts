import { Matrix4, Scene, Vector3 } from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { CharacterBatch, peopleDraw } from '../src/render/characterModel';
import type { ContactShadows } from '../src/render/contactShadows';
import { CAMERA_PRESETS, CODE_LOOK, LOOK_SPECS, PEOPLE_SCALE, clampLook } from '../src/render/lookTuning';

function drawn(scale: number, riding = false) {
  peopleDraw.scale = scale;
  const batch = new CharacterBatch('', 'player', 4);
  const scene = new Scene();
  const m = batch.create({});
  m.riding = riding;
  m.root.position.set(5, 0, -3);
  scene.add(m.root);
  const shadows: number[][] = [];
  batch.flush({ add: (...a: number[]) => shadows.push(a) } as unknown as ContactShadows);
  const at = new Matrix4();
  batch.mesh.getMatrixAt(0, at);
  const p = new Vector3();
  const s = new Vector3();
  at.decompose(p, new (m.root.quaternion.constructor as new () => typeof m.root.quaternion)(), s);
  return { p, s, shadow: shadows[0] };
}

describe('people drawn larger than life', () => {
  afterEach(() => {
    peopleDraw.scale = 1;
  });

  it('scales the drawing about the feet, the contact shadow with it', () => {
    const one = drawn(1);
    const big = drawn(1.35);
    expect(big.s.x).toBeCloseTo(1.35, 5);
    expect(big.p.toArray()).toEqual(one.p.toArray());
    // halfWidth, halfLength, soft grow with the body.
    expect(big.shadow[3] / one.shadow[3]).toBeCloseTo(1.35, 5);
    expect(big.shadow[5] / one.shadow[5]).toBeCloseTo(1.35, 5);
  });

  it("grows a rider from the seat (0.75 m above the root), not from the feet", () => {
    const r = drawn(1.4, true);
    // The seat point stays put: root.y + 0.75 = drawn.y + 0.75 × scale.
    expect(r.p.y + 0.75 * 1.4).toBeCloseTo(0.75, 5);
  });
});

describe('readability and camera sliders', () => {
  it('ship people larger than life and today’s camera', () => {
    expect(CODE_LOOK.peopleScale).toBe(PEOPLE_SCALE);
    expect(PEOPLE_SCALE).toBeGreaterThanOrEqual(1.3);
    expect(PEOPLE_SCALE).toBeLessThanOrEqual(1.4);
    expect(CODE_LOOK.cameraTilt).toBe(0.12);
    expect(CODE_LOOK.footHeight).toBe(1);
    expect(CODE_LOOK.fieldOfView).toBe(1);
  });

  it('presets are slider values the panel can hold, the first today’s camera', () => {
    expect(CAMERA_PRESETS[0]).toMatchObject({ cameraTilt: 0.12, footHeight: 1, fieldOfView: 1 });
    expect(CAMERA_PRESETS.map((p) => p.cameraTilt)).toEqual([0.12, 0.2, 0.3]);
    for (const p of CAMERA_PRESETS) {
      for (const k of ['cameraTilt', 'footHeight', 'fieldOfView'] as const) expect(clampLook(k, p[k])).toBe(p[k]);
    }
    expect(LOOK_SPECS.filter((s) => s.group === 'camera').map((s) => s.key)).toEqual(['cameraTilt', 'footHeight', 'fieldOfView']);
  });
});

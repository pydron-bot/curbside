import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { CameraRig } from '../src/render/cameraRig';
import {
  AttractShow,
  FADE_IN,
  FADE_OUT,
  Rotation,
  SHOW_TIMING,
  TitleFraming,
  fadeAlpha,
  freeCentreOffsetPx,
  groundPerPx,
  type ShowCue,
  type ShowStage,
} from '../src/ui/attractShow';
import { random } from './helpers';

const IDS = ['chase', 'race', 'fire', 'turf', 'bus'] as const;
type Id = (typeof IDS)[number];

/** A city whose scenes start (or not) and resolve as the test says. */
class FakeStage implements ShowStage<Id> {
  ready_ = true;
  refuse = new Set<Id>();
  quiet = new Set<Id>();
  live_ = true;
  started: Id[] = [];
  stopped: Id[] = [];
  ready(): boolean {
    return this.ready_;
  }
  start(id: Id): boolean {
    this.started.push(id);
    return !this.refuse.has(id);
  }
  live(id: Id): boolean {
    return this.live_ && !this.quiet.has(id);
  }
  stop(id: Id): void {
    this.stopped.push(id);
  }
}

/** Step until `cue` (or give up after `seconds`); the time it took. */
function until(show: AttractShow<Id>, stage: FakeStage, cue: ShowCue, seconds = 120): number {
  for (let t = 0; t < seconds; t += 0.1) if (show.step(0.1, stage) === cue) return t + 0.1;
  return Infinity;
}

describe('attract show rotation', () => {
  it('plays every highlight once a round, never the same twice running', () => {
    const rot = new Rotation(IDS, random(3));
    let last: Id | null = null;
    for (let round = 0; round < 40; round++) {
      const seen = new Set<Id>();
      for (let i = 0; i < IDS.length; i++) {
        const id = rot.next();
        expect(id).not.toBe(last);
        seen.add(id);
        last = id;
      }
      expect(seen.size).toBe(IDS.length);
    }
  });
});

describe('attract show timing', () => {
  it('cruises, cuts to a highlight, follows it till it resolves, lingers, and cruises again', () => {
    const stage = new FakeStage();
    const show = new AttractShow(IDS, random(1));
    const first = until(show, stage, 'cut');
    // The first comes after the opening wait; it went live at once.
    expect(first).toBeGreaterThanOrEqual(SHOW_TIMING.first[0]);
    expect(first).toBeLessThanOrEqual(SHOW_TIMING.first[1] + 0.2);
    expect(show.phase).toBe('watch');
    const id = show.current!;
    expect(stage.started).toEqual([id]);
    // It resolves: a short linger on it, then back to cruising.
    show.step(5, stage);
    stage.live_ = false;
    expect(show.step(0.1, stage)).toBeNull();
    expect(show.phase).toBe('linger');
    const back = until(show, stage, 'release');
    expect(back).toBeCloseTo(SHOW_TIMING.linger, 0);
    expect(stage.stopped).toEqual([id]);
    expect(show.phase).toBe('cruise');
    // Then a normal cruise before the next one, a different one.
    stage.live_ = true;
    const gap = until(show, stage, 'cut');
    expect(gap).toBeGreaterThanOrEqual(SHOW_TIMING.cruise[0]);
    expect(gap).toBeLessThanOrEqual(SHOW_TIMING.cruise[1] + 0.2);
    expect(show.current).not.toBe(id);
  });

  it('leaves a highlight that runs on after its watch time', () => {
    const stage = new FakeStage();
    const show = new AttractShow(IDS, random(2));
    until(show, stage, 'cut');
    const watched = until(show, stage, 'release');
    expect(watched).toBeGreaterThanOrEqual(SHOW_TIMING.watch[0]);
    expect(watched).toBeLessThanOrEqual(SHOW_TIMING.watch[1] + 0.2);
    expect(stage.stopped.length).toBe(1);
  });

  it("skips one that won't start, and one that never shows anything", () => {
    const stage = new FakeStage();
    const show = new AttractShow(IDS, random(5));
    // Find the order, then make the first refuse and the second stay quiet.
    const r = random(5);
    // The show's constructor draws its opening wait before the first shuffle.
    r();
    const peek = new Rotation(IDS, r);
    const order = [peek.next(), peek.next(), peek.next()];
    stage.refuse.add(order[0]);
    stage.quiet.add(order[1]);
    const t = until(show, stage, 'cut');
    expect(stage.started).toEqual(order);
    expect(stage.stopped).toEqual([order[1]]);
    expect(show.current).toBe(order[2]);
    // The quiet one had its settle time before the next was tried.
    expect(t).toBeGreaterThan(SHOW_TIMING.first[0] + SHOW_TIMING.settle - 0.2);
  });

  it('waits while the title is closed, and rests after a run of refusals', () => {
    const stage = new FakeStage();
    stage.ready_ = false;
    const show = new AttractShow(IDS, random(7));
    expect(until(show, stage, 'cut', 60)).toBe(Infinity);
    expect(stage.started).toEqual([]);
    stage.ready_ = true;
    for (const id of IDS) stage.refuse.add(id);
    for (let t = 0; t < SHOW_TIMING.recheck + 0.2; t += 0.1) show.step(0.1, stage);
    expect(stage.started.length).toBe(SHOW_TIMING.tries);
    // A full cruise before trying again.
    for (let t = 0; t < SHOW_TIMING.cruise[0] - 0.5; t += 0.1) show.step(0.1, stage);
    expect(stage.started.length).toBe(SHOW_TIMING.tries);
    stage.refuse.clear();
    expect(until(show, stage, 'cut', SHOW_TIMING.cruise[1])).toBeLessThan(Infinity);
  });

  it('starts over from reset (PLAY, back to the title)', () => {
    const stage = new FakeStage();
    const show = new AttractShow(IDS, random(9));
    until(show, stage, 'cut');
    show.reset();
    expect(show.phase).toBe('cruise');
    expect(show.current).toBeNull();
    expect(until(show, stage, 'cut')).toBeGreaterThanOrEqual(SHOW_TIMING.first[0]);
  });
});

describe('attract cut fade', () => {
  it('goes dark, then clears, smoothly', () => {
    expect(fadeAlpha(-1)).toBe(0);
    expect(fadeAlpha(0)).toBe(0);
    expect(fadeAlpha(FADE_OUT)).toBeCloseTo(1);
    expect(fadeAlpha(FADE_OUT / 2)).toBeCloseTo(0.5);
    expect(fadeAlpha(FADE_OUT + FADE_IN / 2)).toBeCloseTo(0.5);
    expect(fadeAlpha(FADE_OUT + FADE_IN)).toBe(0);
    let prev = 0;
    for (let t = 0; t <= FADE_OUT; t += 0.01) {
      expect(fadeAlpha(t)).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = fadeAlpha(t);
    }
  });
});

describe('title framing', () => {
  it('centres the subject in the free area right of the menu', () => {
    expect(freeCentreOffsetPx(0, 852)).toBe(0);
    // A 440 px column: the free area is 440..852, its middle 206 px right of centre.
    expect(freeCentreOffsetPx(440, 852)).toBe(220);
    // A column wider than most of the screen is capped.
    expect(freeCentreOffsetPx(900, 852)).toBeCloseTo(852 * 0.35);
  });

  it('turns px into ground metres through the rig camera at every title size', () => {
    for (const [w, h, menu] of [
      [852, 393, 476],
      [852, 340, 476],
      [1280, 720, 476],
      [1920, 1080, 476],
    ]) {
      const rig = new CameraRig(w / h);
      rig.resize(w / h);
      for (let i = 0; i < 120; i++) rig.update(1 / 60, 0, 0, 0, 0);
      const cam = rig.camera;
      const per = groundPerPx(rig.currentHeight, rig.opts.tilt, cam.fov, cam.aspect, w);
      const framing = new TitleFraming();
      framing.snap(menu, w);
      const shift = framing.world(rig.currentHeight, rig.opts.tilt, cam.fov, cam.aspect, w);
      expect(shift).toBeCloseTo(framing.px * per);
      // The camera looks `shift` left of the subject: the subject lands mid free area.
      const subjectX = 37;
      rig.snapTo(subjectX - shift, 12);
      cam.updateMatrixWorld();
      const p = new Vector3(subjectX, 0, 12).project(cam);
      const px = ((p.x + 1) / 2) * w;
      expect(px).toBeCloseTo((menu + w) / 2, 0);
      expect(p.y).toBeCloseTo(0, 3);
    }
  });

  it('eases to a new layout rather than jumping', () => {
    const f = new TitleFraming();
    f.snap(440, 852);
    const a = f.update(1 / 60, 0, 852);
    expect(a).toBeLessThan(220);
    expect(a).toBeGreaterThan(200);
    for (let i = 0; i < 60 * 4; i++) f.update(1 / 60, 0, 852);
    expect(f.px).toBeLessThan(1);
  });
});

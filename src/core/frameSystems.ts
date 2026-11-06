/**
 * Per-frame presentation systems (looks, radar blips, stamps): each one is
 * added where it is made, with the clock it runs on, and the frame loop
 * updates them all in the order they were added. A new look then needs no
 * edit to main.ts's frame loop. The simulation and the systems whose order
 * matters (people, the camera, audio, HUD, the render) stay explicit there.
 */

/**
 * real: time since the last frame (capped). world: real slowed by hit-stop
 * and TEST slow motion, for anything that freezes with the people. sim: the
 * simulation's time this frame, which also stops for cards and pauses.
 */
export type FrameClock = 'real' | 'world' | 'sim';

/** The ground in view this frame (a `Rect` in world/city.ts). */
export interface GroundView {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/** This frame, as the frame loop hands it over (one object, reused). */
export interface FrameContext {
  real: number;
  world: number;
  sim: number;
  /** The ground the camera sees (filled once a frame, before the systems run). */
  readonly view: GroundView;
}

export type FrameUpdate = (dt: number, frame: Readonly<FrameContext>) => void;

interface Entry {
  readonly name: string;
  readonly clock: FrameClock;
  readonly update: FrameUpdate;
}

export class FrameSystems {
  private readonly entries: Entry[] = [];

  /** Run `update` every frame with `clock`'s time; names are for profiling and must be unique. */
  add(name: string, clock: FrameClock, update: FrameUpdate): void {
    if (this.entries.some((e) => e.name === name)) throw new Error(`frame system "${name}" added twice`);
    this.entries.push({ name, clock, update });
  }

  /** The systems in the order they run. */
  get names(): readonly string[] {
    return this.entries.map((e) => e.name);
  }

  run(frame: Readonly<FrameContext>): void {
    // Indexed: no iterator allocated per frame.
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i];
      e.update(frame[e.clock], frame);
    }
  }
}

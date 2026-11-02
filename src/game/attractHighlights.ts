/**
 * The title's highlights: now and then the attract camera leaves the
 * traffic it cruises with for something happening in the city (a police
 * chase, a street race, a fire and its truck, a turf war, an accident, the
 * ice cream van, a bus stop, a busker, a mugging, stray dogs after a
 * runner, and the V2 incidents: the cash van, chucking-out time, a funeral,
 * a burst hydrant, a conga, a film shoot; the night's only at night),
 * follows it while it plays out and goes back to cruising. When
 * and which is ui/attractShow.ts (pure); this starts the scenes round the
 * camera (game/sceneStarter.ts, shared with the TEST menu), asks each for
 * its subject (Scene.subject) and fades a long cut.
 *
 * One at a time: the scene directed is CityLife.featured (nothing holds it
 * off, its people gather), everything else stays held by the title. A
 * scene left running when the show moves on is reset once it's out of
 * view; PLAY clears the lot (reset(), then CityLife.reset with the run).
 */
import { DISTRICT_NAMES, districtAt } from '../world/districts';
import { AttractShow, FADE_IN, FADE_OUT, GLIDE_RANGE, fadeAlpha, type ShowStage } from '../ui/attractShow';
import type { CityLife, Scene, Subject } from './cityLife';
import { FireCrews } from './scenes/fireCrews';
import type { SceneId, SceneStarter } from './sceneStarter';
import { len2 } from '../core/len';
import { CASH_HOURS, FILM_HOURS, FUNERAL_HOURS, inHours } from '../systems/incidents';

export type HighlightId =
  | 'chase'
  | 'race'
  | 'fire'
  | 'turf'
  | 'accident'
  | 'iceCream'
  | 'bus'
  | 'busker'
  | 'mugging'
  | 'dogs'
  | 'cashRun'
  | 'kebab'
  | 'funeral'
  | 'hydrant'
  | 'conga'
  | 'filmShoot';

interface Highlight {
  /** The caption's first half ("POLICE CHASE · NEON MILE"). */
  caption: string;
  /** Its scene's clock kind (CityLife.featured). */
  kind: string;
  /** What starts it (SceneStarter). */
  start: SceneId;
  /** Reset it once out of view if the show moves on before it's over (false: it winds down by itself). */
  clear: boolean;
  /** Only shown at these hours (the title's clock), wrapping past midnight: the night's incidents at night. */
  hours?: readonly [number, number];
}

export const HIGHLIGHTS: Readonly<Record<HighlightId, Highlight>> = {
  chase: { caption: 'POLICE CHASE', kind: 'chase', start: 'chaseCar', clear: true },
  race: { caption: 'STREET RACE', kind: 'race', start: 'race', clear: true },
  fire: { caption: 'FIRE CALL', kind: 'fire', start: 'fire', clear: false },
  turf: { caption: 'TURF WAR', kind: 'turf', start: 'turf', clear: false },
  accident: { caption: 'FENDER BENDER', kind: 'accident', start: 'accident', clear: true },
  iceCream: { caption: 'ICE CREAM', kind: 'iceCream', start: 'iceCream', clear: true },
  bus: { caption: 'NEXT BUS', kind: 'bus', start: 'bus', clear: true },
  busker: { caption: 'STREET SHOW', kind: 'busker', start: 'busker', clear: true },
  mugging: { caption: 'MUGGING', kind: 'mugging', start: 'mugging', clear: true },
  dogs: { caption: 'STRAY DOGS', kind: 'dog', start: 'dogChase', clear: false },
  cashRun: { caption: 'CASH RUN', kind: 'cashRun', start: 'cashRun', clear: true, hours: CASH_HOURS },
  kebab: { caption: 'CHUCKING-OUT TIME', kind: 'kebab', start: 'kebab', clear: true, hours: [22, 5] },
  funeral: { caption: 'FUNERAL', kind: 'funeral', start: 'funeral', clear: true, hours: FUNERAL_HOURS },
  hydrant: { caption: 'BURST MAIN', kind: 'hydrant', start: 'hydrant', clear: true },
  conga: { caption: 'CONGA', kind: 'conga', start: 'conga', clear: true, hours: [19, 4] },
  filmShoot: { caption: 'ON SET', kind: 'filmShoot', start: 'filmShoot', clear: true, hours: FILM_HOURS },
};
const IDS = Object.keys(HIGHLIGHTS) as HighlightId[];
/** A chase is the scooter this share of the time. */
const BIKE_CHASE = 0.25;
/** A scene left running is reset after this long anyway (winding down where it's seen), s. */
const LEFTOVER_MAX = 30;

export interface AttractHighlightsDeps {
  life: CityLife;
  starter: SceneStarter;
  rand: () => number;
  /** May one start now (the title is up)? */
  ready(): boolean;
  /** The title's hour, 0..24 (a night's incident only shows at night). */
  hour?(): number;
}

/** What the title camera should do this frame (step's answer). */
export type HighlightCue = 'cut' | 'jump' | 'release' | null;

export class AttractHighlights implements ShowStage<HighlightId> {
  readonly show: AttractShow<HighlightId>;
  /** What to watch (while watching): the scene's subject, kept still while the show lingers on it. */
  readonly subject: Subject = { x: 0, z: 0, vx: 0, vz: 0 };
  /** The caption for the highlight just cut to ("POLICE CHASE · NEON MILE"). */
  caption = '';
  /** How dark the title's fade is (0..1). */
  fade = 0;
  private cutT = -1;
  private leftover: Scene | null = null;
  private leftAge = 0;
  private tidy = 0;
  private readonly tmp: Subject = { x: 0, z: 0, vx: 0, vz: 0 };

  constructor(private readonly d: AttractHighlightsDeps) {
    this.show = new AttractShow(IDS, d.rand);
  }

  /** Fading across to a highlight? */
  get cutting(): boolean {
    return this.cutT >= 0;
  }

  /** Following a highlight (the camera watches `subject`)? */
  get watching(): boolean {
    return this.show.phase === 'watch' || this.show.phase === 'linger';
  }

  /**
   * One frame behind the title. 'cut': a highlight came live close by (the
   * camera glides over); 'jump': mid-fade, put the camera on `subject`
   * now; 'release': back to cruising.
   */
  step(dt: number): HighlightCue {
    let cue: HighlightCue = this.show.step(dt, this);
    const life = this.d.life;
    if (cue === 'cut') {
      const s = this.subject;
      const id = this.show.current!;
      this.caption = `${HIGHLIGHTS[id].caption} · ${DISTRICT_NAMES[districtAt(s.x, s.z)]}`;
      const at = life.d.focus();
      // Far or off screen: fade across rather than fly.
      if (len2(s.x - at.x, s.z - at.z) > GLIDE_RANGE || !life.inView(s.x, s.z, 4)) this.cutT = 0;
    }
    if (this.show.phase === 'linger') this.subject.vx = this.subject.vz = 0;
    if (this.cutT >= 0) {
      const was = this.cutT;
      this.cutT += dt;
      if (was < FADE_OUT && this.cutT >= FADE_OUT) cue = 'jump';
      this.fade = fadeAlpha(this.cutT);
      if (this.cutT >= FADE_OUT + FADE_IN) {
        this.cutT = -1;
        this.fade = 0;
      }
    }
    if ((this.tidy -= dt) <= 0) {
      this.tidy = 1;
      this.tidyLeftover();
    }
    return cue;
  }

  /** Stop the show (PLAY, quit to title): no scene directed, back to a fresh wait. The run's CityLife.reset clears the scenes. */
  reset(): void {
    this.show.reset();
    this.d.life.featured = null;
    this.leftover = null;
    this.cutT = -1;
    this.fade = 0;
    this.caption = '';
  }

  // --- ShowStage ---

  ready(): boolean {
    return this.d.ready();
  }

  start(id: HighlightId): boolean {
    const { life, starter } = this.d;
    const h = HIGHLIGHTS[id];
    if (h.hours && !inHours(this.d.hour?.() ?? 13, h.hours)) return false;
    // One at a time: whatever the last left running goes now.
    if (this.leftover) {
      this.leftover.reset();
      this.leftover = null;
    }
    const kind = id === 'chase' && this.d.rand() < BIKE_CHASE ? 'chaseBike' : h.start;
    life.featured = h.kind;
    const at = life.d.focus();
    starter.start(kind, at.x, at.z, Math.atan2(at.vx, at.vz));
    if (!starter.ok) life.featured = null;
    return starter.ok;
  }

  live(id: HighlightId): boolean {
    return this.sceneOf(id)?.subject?.(this.subject) ?? false;
  }

  stop(id: HighlightId): void {
    this.d.life.featured = null;
    const scene = this.sceneOf(id);
    if (scene && HIGHLIGHTS[id].clear && scene.running > 0) {
      this.leftover = scene;
      this.leftAge = 0;
    }
  }

  // --- Internals ---

  private sceneOf(id: HighlightId): Scene | null {
    const { life, starter } = this.d;
    switch (id) {
      case 'chase':
        return life.chases;
      case 'race':
        return life.races;
      case 'fire':
        return FireCrews.of(life);
      case 'turf':
        return life.turfWar;
      case 'accident':
        return life.accidents;
      case 'dogs':
        return life.dogs;
      default:
        return starter.people(HIGHLIGHTS[id].start);
    }
  }

  /** A scene the show moved on from: reset once what it shows is out of view (or it's been too long). */
  private tidyLeftover(): void {
    const s = this.leftover;
    if (!s) return;
    this.leftAge += 1;
    if (s.running === 0) this.leftover = null;
    else if (this.leftAge > LEFTOVER_MAX || (s.subject?.(this.tmp) && !this.d.life.inView(this.tmp.x, this.tmp.z, 20))) {
      s.reset();
      this.leftover = null;
    }
  }
}

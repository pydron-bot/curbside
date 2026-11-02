/**
 * The camera behind the title, each frame: the show's highlights
 * (game/attractHighlights.ts) or cruising traffic (attract.ts), framed so
 * what it follows sits in the open screen right of the menu column
 * (attractShow.ts TitleFraming: the column's right edge in px, turned into
 * ground metres through the rig's camera), with the title's fade for a
 * long cut and its caption. Only while attract mode is on: in play the rig
 * follows the player as ever.
 */
import type { AttractHighlights } from '../game/attractHighlights';
import type { Vehicle } from '../game/population';
import { LEAD_CAR, type CameraRig } from '../render/cameraRig';
import { LEAD_ATTRACT, type AttractCamera } from './attract';
import { TitleFraming } from './attractShow';
import type { TitleScreen } from './titleScreen';

export interface TitleCameraDeps {
  attract: AttractCamera;
  highlights: AttractHighlights;
  rig: CameraRig;
  title: TitleScreen;
  vehicles: readonly Vehicle[];
  /** The camera jumped (a cut): fill the streets round the new spot. */
  moved(): void;
}

export class TitleCamera {
  private readonly framing = new TitleFraming();
  private shift = 0;

  constructor(private readonly d: TitleCameraDeps) {}

  /** Into attract mode at (x, z): cruising, the first highlight a little way off. */
  start(x: number, z: number): void {
    const d = this.d;
    d.attract.start(x, z);
    d.highlights.reset();
    d.rig.setLead(LEAD_ATTRACT);
    d.title.setFade(0);
  }

  /** Out of attract mode (PLAY): the show stops; the run's reset clears its scenes. */
  stop(): void {
    const d = this.d;
    d.highlights.reset();
    d.attract.stop();
    d.rig.setLead(LEAD_CAR);
    d.title.setFade(0);
    this.framing.px = this.shift = 0;
  }

  update(dt: number, viewW: number): void {
    const { attract, highlights: h, rig, title } = this.d;
    const cue = h.step(dt);
    // The caption as the new view comes up: at once for a glide, in the dark for a fade.
    if ((cue === 'cut' && !h.cutting) || cue === 'jump') title.showCaption(h.caption);
    attract.update(dt, this.d.vehicles, h.watching ? h.subject : null);
    if (cue === 'jump') {
      const s = h.subject;
      attract.jump(s.x, s.z, s.vx, s.vz);
      rig.snapTo(s.x - this.shift, s.z);
      this.d.moved();
    }
    title.setFade(h.fade);
    // The menu column's right edge (0 with the title closed: back to centre).
    this.framing.update(dt, title.isOpen ? title.menuRight : 0, viewW);
    const cam = rig.camera;
    this.shift = this.framing.world(rig.currentHeight, rig.opts.tilt, cam.fov, cam.aspect, viewW);
    rig.update(dt, attract.x - this.shift, attract.z, attract.vx, attract.vz);
  }
}

import './feel.css';
import type { InputSource } from '../core/input';
import { shapeStick, type Vec2 } from '../core/stick';
import { tune } from '../core/touchTuning';
import type { ToolKind } from '../systems/serviceTools';
import type { WeaponKind } from '../systems/weapons';
import type { Haptics } from './haptics';
import { ICONS } from './icons';

/** The touch controls' car-only extras (see touchControls.ts for the rest). */
export interface CarButtons {
  /**
   * Per frame: the drive-by gun FIRE would use (null hides the button), and
   * the nitro tank 0..1 (`ready`: enough to light it). A borrowed service
   * vehicle's `tool` takes the button instead (V2-09: HOSE, CHIME, WINCH).
   */
  update(gun: WeaponKind | null, nitro: number, ready: boolean, tool?: ToolKind | null): void;
  /** Let go of both (pause, resume). */
  reset(): void;
}

/**
 * Two car-only buttons inboard of the pedal pad: FIRE (drive-bys out of
 * whichever window has a target; hold for the SMG) and NITRO (hold to
 * boost; its level fills the button). Added into the touch layer, so they
 * show and mirror with the rest of the touch controls. In a borrowed
 * service vehicle FIRE is its tool; the hose aims like the twin-stick aim
 * pad: hold the button and drag the way to spray (aimX/aimY), let go and
 * it points ahead again.
 */
export function mountCarButtons(layer: HTMLElement, out: InputSource, haptics?: Haptics): CarButtons {
  const fire = document.createElement('div');
  fire.className = 'tbtn car-only btn-carfire';
  fire.innerHTML = `<span class="fire-icon">${ICONS.pistol}</span><b class="tool-label"></b>`;
  const fireIcon = fire.firstElementChild as HTMLElement;
  const toolLabel = fire.lastElementChild as HTMLElement;
  let tool: ToolKind | null = null;
  // The hose's drag-to-aim: where the press started and the shaped aim.
  const origin: Vec2 = { x: 0, y: 0 };
  const shaped: Vec2 = { x: 0, y: 0 };
  let aimId: number | null = null;
  const nitro = document.createElement('div');
  nitro.className = 'tbtn car-only btn-nitro';
  nitro.innerHTML = `${ICONS.nitro}<b>NOS</b>`;
  layer.append(fire, nitro);

  press(
    fire,
    (e) => {
      out.punchPresses++;
      out.fireHeld = true;
      haptics?.touch(true);
      if (tool === 'hose') {
        aimId = e.pointerId;
        origin.x = e.clientX;
        origin.y = e.clientY;
      }
    },
    () => {
      out.fireHeld = false;
      endAim();
    },
  );
  fire.addEventListener('pointermove', (e) => {
    if (e.pointerId !== aimId) return;
    shapeStick(e.clientX - origin.x, e.clientY - origin.y, tune.aimR, tune.aimDz, 1, shaped);
    out.aimX = shaped.x;
    out.aimY = -shaped.y;
  });
  function endAim() {
    if (aimId === null) return;
    aimId = null;
    out.aimX = out.aimY = 0;
  }
  press(
    nitro,
    () => {
      out.boost = true;
      haptics?.touch(true);
    },
    () => (out.boost = false),
  );

  let shownGun: WeaponKind | null | undefined;
  let shownTool: ToolKind | null | undefined;
  let shownFill = -1;
  let shownReady: boolean | undefined;
  return {
    update(gun, level, ready, t = null) {
      if (t !== shownTool) {
        shownTool = tool = t;
        shownGun = undefined;
        fire.classList.toggle('tool', t !== null);
        if (t) fire.dataset.tool = t;
        toolLabel.textContent = t ? t.toUpperCase() : '';
        if (t !== 'hose') endAim();
      }
      if (t) {
        if (shownGun !== null) {
          shownGun = null;
          fire.classList.add('available');
          fireIcon.innerHTML = ICONS[t];
        }
      } else if (gun !== shownGun) {
        shownGun = gun;
        fire.classList.toggle('available', gun !== null);
        if (gun) fireIcon.innerHTML = ICONS[gun];
      }
      const fill = Math.round(level * 20) / 20;
      if (fill !== shownFill) {
        shownFill = fill;
        nitro.style.setProperty('--fill', String(fill));
        nitro.classList.toggle('available', level > 0.001 || out.boost);
      }
      if (ready !== shownReady) nitro.classList.toggle('empty', !(shownReady = ready));
    },
    reset() {
      out.fireHeld = false;
      endAim();
      out.boost = false;
      fire.classList.remove('pressed');
      nitro.classList.remove('pressed');
    },
  };
}

/** A button that tracks its own pointer: `down` on press, `up` on any kind of release. */
function press(target: HTMLElement, down: (e: PointerEvent) => void, up: () => void): void {
  target.addEventListener('pointerdown', (e) => {
    target.setPointerCapture(e.pointerId);
    target.classList.add('pressed');
    down(e);
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
    target.addEventListener(type, () => {
      if (!target.classList.contains('pressed')) return;
      target.classList.remove('pressed');
      up();
    });
  }
}

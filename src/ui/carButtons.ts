import './feel.css';
import type { InputSource } from '../core/input';
import type { WeaponKind } from '../systems/weapons';
import type { Haptics } from './haptics';
import { ICONS } from './icons';

/** The touch controls' car-only extras (see touchControls.ts for the rest). */
export interface CarButtons {
  /**
   * Per frame: the drive-by gun FIRE would use (null hides the button), and
   * the nitro tank 0..1 (`ready`: enough to light it).
   */
  update(gun: WeaponKind | null, nitro: number, ready: boolean): void;
  /** Let go of both (pause, resume). */
  reset(): void;
}

/**
 * Two car-only buttons inboard of the pedal pad: FIRE (drive-bys out of
 * whichever window has a target; hold for the SMG) and NITRO (hold to
 * boost; its level fills the button). Added into the touch layer, so they
 * show and mirror with the rest of the touch controls.
 */
export function mountCarButtons(layer: HTMLElement, out: InputSource, haptics?: Haptics): CarButtons {
  const fire = document.createElement('div');
  fire.className = 'tbtn car-only btn-carfire';
  fire.innerHTML = `<span class="fire-icon">${ICONS.pistol}</span>`;
  const fireIcon = fire.firstElementChild as HTMLElement;
  const nitro = document.createElement('div');
  nitro.className = 'tbtn car-only btn-nitro';
  nitro.innerHTML = `${ICONS.nitro}<b>NOS</b>`;
  layer.append(fire, nitro);

  press(
    fire,
    () => {
      out.punchPresses++;
      out.fireHeld = true;
      haptics?.touch(true);
    },
    () => (out.fireHeld = false),
  );
  press(
    nitro,
    () => {
      out.boost = true;
      haptics?.touch(true);
    },
    () => (out.boost = false),
  );

  let shownGun: WeaponKind | null | undefined;
  let shownFill = -1;
  let shownReady: boolean | undefined;
  return {
    update(gun, level, ready) {
      if (gun !== shownGun) {
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
      out.boost = false;
      fire.classList.remove('pressed');
      nitro.classList.remove('pressed');
    },
  };
}

/** A button that tracks its own pointer: `down` on press, `up` on any kind of release. */
function press(target: HTMLElement, down: () => void, up: () => void): void {
  target.addEventListener('pointerdown', (e) => {
    target.setPointerCapture(e.pointerId);
    target.classList.add('pressed');
    down();
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
    target.addEventListener(type, () => {
      if (!target.classList.contains('pressed')) return;
      target.classList.remove('pressed');
      up();
    });
  }
}

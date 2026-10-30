import './tokens.css';
import './touch.css';
import { AIM_FIRE_AT } from '../core/aim';
import type { InputSource } from '../core/input';
import { onSettingsChange, settings } from '../core/settings';
import { clampToRect, followThumb, footScale, shapeAxis, shapeStick, type Vec2 } from '../core/stick';
import { PLAYER_ON_FOOT } from '../entities/pedestrian';
import type { WeaponKind } from '../systems/weapons';
import type { Haptics } from './haptics';
import { ICONS } from './icons';
import { chordBetween, pedalsAt, type PedalCircle, type PedalLayout, type PedalState } from './pedalZones';
import { safeInsets } from './safeArea';

export type ControlMode = 'foot' | 'car';

export interface TouchControls {
  readonly layer: HTMLElement;
  /** Switch button layout; `canAct` shows (and pulses) the ENTER button on foot. */
  setMode(mode: ControlMode, canAct: boolean): void;
  /** Show the current weapon on the fire button (null = fists). */
  setWeapon(weapon: WeaponKind | null): void;
  /** Release every on-screen control (pause, blur, lost touches). */
  reset(): void;
}

/** Joystick radius, CSS px (the base is twice this). */
const STICK_R = 58;
/** Gap from the safe area to a resting stick, px. */
const STICK_REST_GAP = 22;
/** Stick shaping: deadzone (fraction) and expo per use. */
const STEER_DZ = 0.08;
const STEER_EXPO = 1.5;
const DRIVE_DZ = 0.1;
const DRIVE_EXPO = 1.15;
const WALK_DZ = 0.08;
const AIM_DZ = 0.14;
const AIM_R = 52;
/** A quick touch on the aim side that hardly moves is a tap-to-fire. */
const TAP_MS = 230;
const TAP_PX = 12;

const WEAPON_ICON: Record<WeaponKind | 'fists', string> = {
  fists: ICONS.fist,
  pistol: ICONS.pistol,
  smg: ICONS.smg,
  shotgun: ICONS.shotgun,
};

/**
 * On-screen controls, plain DOM over the canvas:
 *  - Left half: a floating joystick. On foot it walks (pushing further runs,
 *    continuously); in a car it steers — "directional" (default: point where
 *    to go) or "classic" (left/right) per settings.steering. The base appears
 *    under the thumb, stays inside the safe area and follows a thumb dragged
 *    past its rim.
 *  - Right half on foot: a twin-stick aim pad anywhere outside the buttons
 *    (aim; push past AIM_FIRE_AT to fire; tap to fire), FIRE, weapon swap and
 *    ENTER (pulses when a car is in reach).
 *  - Right side in a car: one pedal pad tracking every finger (slide between
 *    GAS and BRAKE; the band between GAS and HAND presses both, to drift with
 *    one thumb) and EXIT, well away from HAND.
 * settings.leftHanded mirrors it all. Shown only while the player is on touch
 * (body[data-device], see touch.css).
 */
export function mountTouchControls(root: HTMLElement, out: InputSource, haptics?: Haptics): TouchControls {
  const layer = el('div', 'touch-layer');
  layer.dataset.mode = 'foot';

  // --- Move / steer stick ---
  const stickZone = el('div', 'stick-zone');
  const stickBase = el('div', 'stick-base');
  const stickKnob = el('div', 'stick-knob');
  stickBase.append(el('div', 'stick-arrow'), stickKnob);
  stickZone.append(stickBase);

  // --- Aim pad (foot) ---
  const aimZone = el('div', 'aim-zone foot-only');
  const aimBase = el('div', 'aim-base');
  const aimKnob = el('div', 'aim-knob');
  aimKnob.innerHTML = ICONS.crosshair;
  aimBase.append(aimKnob);
  aimZone.append(aimBase);

  // --- Pedal pad (car) ---
  const pad = el('div', 'pedal-pad car-only');
  const gasEl = pedal('gas', 'GAS', ICONS.gas);
  const brakeEl = pedal('brake', 'BRAKE', ICONS.brake);
  const handEl = pedal('hand', 'HAND', ICONS.hand);
  const chordEl = el('div', 'pedal-chord');
  chordEl.innerHTML = '<span>DRIFT</span>';
  pad.append(handEl, chordEl, brakeEl, gasEl);

  // --- Buttons ---
  const door = el('div', 'tbtn btn-door');
  door.innerHTML = `${ICONS.door}<b>ENTER</b>`;
  const doorLabel = door.querySelector('b')!;
  const fire = el('div', 'tbtn btn-fire foot-only');
  fire.innerHTML = `<span class="fire-icon">${ICONS.fist}</span>`;
  const fireIcon = fire.firstElementChild as HTMLElement;
  const swap = el('div', 'tbtn btn-swap foot-only');
  swap.innerHTML = ICONS.swap;

  layer.append(stickZone, aimZone, pad, door, swap, fire);
  root.append(layer);

  const applySettings = () => {
    layer.dataset.hand = settings.leftHanded ? 'left' : 'right';
    layer.dataset.steer = settings.steering;
    restStick();
  };
  onSettingsChange(applySettings);
  window.addEventListener('resize', () => restStick());
  // Deliver any iOS haptic tick queued by a crash or shot on the next touch.
  for (const type of ['pointerdown', 'pointerup'] as const) layer.addEventListener(type, () => haptics?.touch(), { capture: true });

  let mode: ControlMode = 'foot';

  // ---------------------------------------------------------------- stick
  const origin: Vec2 = { x: 0, y: 0 };
  const thumb: Vec2 = { x: 0, y: 0 };
  const shaped: Vec2 = { x: 0, y: 0 };
  let stickPointer: number | null = null;

  /** Where the stick waits when nobody's touching it. */
  function restStick() {
    const s = safeInsets();
    const left = !settings.leftHanded;
    const x = left ? s.left + STICK_REST_GAP + STICK_R : window.innerWidth - s.right - STICK_REST_GAP - STICK_R;
    const y = window.innerHeight - Math.max(s.bottom, 8) - STICK_REST_GAP - STICK_R;
    if (stickPointer === null) placeBase(stickBase, x, y);
  }

  /** Keep a stick origin inside its half of the screen and the safe area. */
  function clampOrigin(p: Vec2, ownHalfIsLeft: boolean, r: number) {
    const s = safeInsets();
    const w = window.innerWidth;
    const h = window.innerHeight;
    const m = r * 0.6;
    const minX = ownHalfIsLeft ? s.left + m : w / 2 + m;
    const maxX = ownHalfIsLeft ? w / 2 - m : w - s.right - m;
    clampToRect(p, minX, maxX, s.top + m, h - s.bottom - m);
  }

  stickZone.addEventListener('pointerdown', (e) => {
    if (stickPointer !== null) return;
    // Swipes from the bottom edge belong to the home indicator.
    const s = safeInsets();
    if (s.bottom > 0 && e.clientY > window.innerHeight - s.bottom) return;
    stickPointer = e.pointerId;
    stickZone.setPointerCapture(e.pointerId);
    origin.x = thumb.x = e.clientX;
    origin.y = thumb.y = e.clientY;
    clampOrigin(origin, !settings.leftHanded, STICK_R);
    stickBase.classList.add('active');
    updateStick();
  });
  stickZone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== stickPointer) return;
    thumb.x = e.clientX;
    thumb.y = e.clientY;
    updateStick();
  });
  const releaseStick = (e: { pointerId: number }) => {
    if (e.pointerId !== stickPointer) return;
    stickPointer = null;
    stickBase.classList.remove('active');
    out.steer = out.moveX = out.moveY = 0;
    out.sprint = false;
    moveKnob(stickKnob, 0, 0);
    restStick();
  };
  stickZone.addEventListener('pointerup', releaseStick);
  stickZone.addEventListener('pointercancel', releaseStick);
  stickZone.addEventListener('lostpointercapture', releaseStick);

  function updateStick() {
    followThumb(origin, thumb.x, thumb.y, STICK_R);
    clampOrigin(origin, !settings.leftHanded, STICK_R);
    const dx = thumb.x - origin.x;
    const dy = thumb.y - origin.y;
    placeBase(stickBase, origin.x, origin.y);
    const len = Math.hypot(dx, dy);
    const k = len > STICK_R ? STICK_R / len : 1;
    moveKnob(stickKnob, dx * k, dy * k);
    writeStick(dx, dy);
  }

  function writeStick(dx: number, dy: number) {
    if (stickPointer === null) return;
    if (mode === 'car') {
      out.steer = shapeAxis(dx / STICK_R, STEER_DZ, STEER_EXPO);
      const m = shapeStick(dx, dy, STICK_R, DRIVE_DZ, DRIVE_EXPO, shaped);
      out.moveX = shaped.x;
      out.moveY = -shaped.y; // screen-up is positive
      out.sprint = false;
      // The directional arrow on the base shows where the car is being sent.
      stickBase.style.setProperty('--dir', `${Math.atan2(dx, -dy).toFixed(3)}rad`);
      stickBase.classList.toggle('aiming', m > 0);
    } else {
      const m = shapeStick(dx, dy, STICK_R, WALK_DZ, 1, shaped);
      const scale = m > 0 ? footScale(m, PLAYER_ON_FOOT.walkSpeed, PLAYER_ON_FOOT.runSpeed) / m : 0;
      out.moveX = shaped.x * scale;
      out.moveY = -shaped.y * scale;
      out.sprint = m > 0; // footScale is a fraction of run speed
      out.steer = 0;
      stickBase.classList.remove('aiming');
    }
  }

  // ---------------------------------------------------------------- aim
  const aimOrigin: Vec2 = { x: 0, y: 0 };
  const aimThumb: Vec2 = { x: 0, y: 0 };
  let aimPointer: number | null = null;
  let aimDownAt = 0;
  let aimTravel = 0;

  aimZone.addEventListener('pointerdown', (e) => {
    if (aimPointer !== null || mode !== 'foot') return;
    aimPointer = e.pointerId;
    aimZone.setPointerCapture(e.pointerId);
    aimOrigin.x = aimThumb.x = e.clientX;
    aimOrigin.y = aimThumb.y = e.clientY;
    clampOrigin(aimOrigin, settings.leftHanded, AIM_R);
    aimDownAt = performance.now();
    aimTravel = 0;
    aimBase.classList.add('active');
    updateAim();
  });
  aimZone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== aimPointer) return;
    aimTravel += Math.abs(e.clientX - aimThumb.x) + Math.abs(e.clientY - aimThumb.y);
    aimThumb.x = e.clientX;
    aimThumb.y = e.clientY;
    updateAim();
  });
  const releaseAim = (e: { pointerId: number; type?: string }) => {
    if (e.pointerId !== aimPointer) return;
    aimPointer = null;
    if (e.type === 'pointerup' && aimTravel < TAP_PX && performance.now() - aimDownAt < TAP_MS) out.punchPresses++;
    out.aimX = out.aimY = 0;
    out.aimFire = false;
    aimBase.classList.remove('active', 'firing');
    moveKnob(aimKnob, 0, 0);
  };
  aimZone.addEventListener('pointerup', releaseAim);
  aimZone.addEventListener('pointercancel', releaseAim);
  aimZone.addEventListener('lostpointercapture', releaseAim);

  function updateAim() {
    followThumb(aimOrigin, aimThumb.x, aimThumb.y, AIM_R);
    clampOrigin(aimOrigin, settings.leftHanded, AIM_R);
    const dx = aimThumb.x - aimOrigin.x;
    const dy = aimThumb.y - aimOrigin.y;
    placeBase(aimBase, aimOrigin.x, aimOrigin.y);
    const len = Math.hypot(dx, dy);
    const k = len > AIM_R ? AIM_R / len : 1;
    moveKnob(aimKnob, dx * k, dy * k);
    const m = shapeStick(dx, dy, AIM_R, AIM_DZ, 1, shaped);
    out.aimX = shaped.x;
    out.aimY = -shaped.y;
    const firing = m > 0 && Math.min(1, len / AIM_R) >= AIM_FIRE_AT;
    if (firing !== out.aimFire) {
      out.aimFire = firing;
      aimBase.classList.toggle('firing', firing);
    }
  }

  // ---------------------------------------------------------------- pedals
  const fingers = new Map<number, Vec2>();
  const held: PedalState = { gas: false, brake: false, hand: false };
  const next: PedalState = { gas: false, brake: false, hand: false };
  let layout: PedalLayout | null = null;
  let padLeft = 0;
  let padTop = 0;

  function measurePedals(): PedalLayout {
    const r = pad.getBoundingClientRect();
    padLeft = r.left;
    padTop = r.top;
    const circle = (p: HTMLElement): PedalCircle => {
      const b = p.getBoundingClientRect();
      return { x: b.left + b.width / 2 - r.left, y: b.top + b.height / 2 - r.top, r: Math.max(b.width, b.height) / 2 };
    };
    const gas = circle(gasEl);
    const hand = circle(handEl);
    return { gas, brake: circle(brakeEl), hand, chord: chordBetween(hand, gas) };
  }

  function updatePedals() {
    next.gas = next.brake = next.hand = false;
    if (layout) for (const f of fingers.values()) pedalsAt(f.x - padLeft, f.y - padTop, layout, next);
    if (next.gas !== held.gas) gasEl.classList.toggle('pressed', (held.gas = next.gas));
    if (next.brake !== held.brake) brakeEl.classList.toggle('pressed', (held.brake = next.brake));
    if (next.hand !== held.hand) handEl.classList.toggle('pressed', (held.hand = next.hand));
    chordEl.classList.toggle('pressed', held.gas && held.hand);
    out.throttle = (held.gas ? 1 : 0) - (held.brake ? 1 : 0);
    out.handbrake = held.hand;
  }

  pad.addEventListener('pointerdown', (e) => {
    pad.setPointerCapture(e.pointerId);
    if (fingers.size === 0) layout = measurePedals();
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    updatePedals();
    haptics?.touch(true);
  });
  pad.addEventListener('pointermove', (e) => {
    const f = fingers.get(e.pointerId);
    if (!f) return;
    f.x = e.clientX;
    f.y = e.clientY;
    updatePedals();
  });
  const liftFinger = (e: PointerEvent) => {
    if (!fingers.delete(e.pointerId)) return;
    updatePedals();
  };
  pad.addEventListener('pointerup', liftFinger);
  pad.addEventListener('pointercancel', liftFinger);
  pad.addEventListener('lostpointercapture', liftFinger);

  function releasePedals() {
    fingers.clear();
    updatePedals();
  }

  // ---------------------------------------------------------------- buttons
  pressable(
    fire,
    () => {
      out.punchPresses++;
      out.fireHeld = true;
      haptics?.touch(true);
    },
    () => (out.fireHeld = false),
  );
  pressable(swap, () => out.cyclePresses++);
  pressable(door, () => {
    out.actionPresses++;
    haptics?.touch(true);
  });

  applySettings();

  let doorText = '';
  let weapon: WeaponKind | null | undefined;
  return {
    layer,
    reset() {
      if (stickPointer !== null) releaseStick({ pointerId: stickPointer });
      if (aimPointer !== null) releaseAim({ pointerId: aimPointer });
      releasePedals();
      out.fireHeld = false;
      for (const b of [fire, swap, door]) b.classList.remove('pressed');
    },
    setWeapon(w) {
      if (w === weapon) return;
      weapon = w;
      fireIcon.innerHTML = WEAPON_ICON[w ?? 'fists'];
      fire.classList.toggle('armed', w !== null);
    },
    setMode(m, canAct) {
      if (m !== mode) {
        mode = m;
        layer.dataset.mode = m;
        // Don't carry held pedals or aim into or out of a car.
        releasePedals();
        if (aimPointer !== null) releaseAim({ pointerId: aimPointer });
        // A thumb still on the stick keeps going, re-read for the new mode.
        if (stickPointer !== null) writeStick(thumb.x - origin.x, thumb.y - origin.y);
      }
      const text = m === 'car' ? 'EXIT' : 'ENTER';
      if (text !== doorText) doorLabel.textContent = doorText = text;
      door.classList.toggle('available', m === 'car' || canAct);
    },
  };
}

/** A button that tracks its own pointer: `down` on press, `up` on any kind of release. */
function pressable(target: HTMLElement, down: () => void, up?: () => void): void {
  target.addEventListener('pointerdown', (e) => {
    target.setPointerCapture(e.pointerId);
    target.classList.add('pressed');
    down();
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
    target.addEventListener(type, () => {
      if (!target.classList.contains('pressed')) return;
      target.classList.remove('pressed');
      up?.();
    });
  }
}

/** Centre a stick base on (x, y) (client px); transforms only, no layout. */
function placeBase(base: HTMLElement, x: number, y: number): void {
  base.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
}

function moveKnob(knob: HTMLElement, dx: number, dy: number): void {
  knob.style.transform = `translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, 0)`;
}

function el(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function pedal(kind: string, label: string, svgIcon: string): HTMLElement {
  const p = el('div', `pedal pedal-${kind}`);
  p.innerHTML = `${svgIcon}<b>${label}</b>`;
  return p;
}

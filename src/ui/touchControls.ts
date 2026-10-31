import './tokens.css';
import './touch.css';
import { AIM_FIRE_AT } from '../core/aim';
import type { InputSource } from '../core/input';
import { onSettingsChange, settings } from '../core/settings';
import { onTuneChange, tune } from '../core/touchTuning';
import { clampToRect, followThumb, footScale, shapeAxis, shapeStick, type Vec2 } from '../core/stick';
import { PLAYER_ON_FOOT } from '../entities/pedestrian';
import { WEAPONS, type WeaponKind } from '../systems/weapons';
import type { Haptics } from './haptics';
import { ICONS } from './icons';
import { chordBetween, pedalsAt, type PedalCircle, type PedalLayout, type PedalState } from './pedalZones';
import { safeInsets } from './safeArea';

export type ControlMode = 'foot' | 'car';

export interface TouchControls {
  readonly layer: HTMLElement;
  /** Switch button layout; `canAct` shows (and pulses) the ENTER button on foot. */
  setMode(mode: ControlMode, canAct: boolean): void;
  /**
   * Show the current weapon on the fire button (null = fists); `canSwap`
   * (a gun is owned) shows the swap button, which is no use with fists alone.
   */
  setWeapon(weapon: WeaponKind | null, canSwap: boolean): void;
  /**
   * Release every on-screen control (pause, resume, blur). A thumb that
   * stays on a stick or the pedals takes it back when it next moves; the
   * buttons need a fresh press.
   */
  reset(): void;
}

/** Gap from the safe area to a resting stick, px. */
const STICK_REST_GAP = 22;
/**
 * Stick radii (CSS px; a base is twice this) and deadzones, the steer expo:
 * read from `tune` at use (core/touchTuning.ts, adjustable on the
 * Diagnostics sheet). The drive expo isn't tuned.
 */
const DRIVE_EXPO = 1.15;
/** A quick touch on the aim side that hardly moves is a tap-to-fire. */
const TAP_MS = 230;
const TAP_PX = 12;

const WEAPON_ICON: Record<WeaponKind | 'fists', string> = {
  fists: ICONS.fist,
  pistol: ICONS.pistol,
  smg: ICONS.smg,
  shotgun: ICONS.shotgun,
  grenade: ICONS.grenade,
  molotov: ICONS.molotov,
  rocket: ICONS.rocket,
};

/**
 * On-screen controls, plain DOM over the canvas:
 *  - Left half: a floating joystick. On foot it walks (pushing further runs,
 *    continuously); in a car it steers — "directional" (default: point where
 *    to go) or "classic" (left/right) per settings.steering. The base appears
 *    under the thumb, stays inside the safe area and follows a thumb dragged
 *    past its rim.
 *  - Right half on foot: a twin-stick aim pad anywhere outside the buttons
 *    (aim; push past AIM_FIRE_AT to fire; tap to fire; with a grenade or
 *    molotov, aim and let go to throw), FIRE, weapon swap and
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
    const hand = settings.leftHanded ? 'left' : 'right';
    layer.dataset.hand = hand;
    // The HUD mirrors too, so the radar stays clear of the buttons (hud.css).
    document.body.dataset.hand = hand;
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
  /**
   * A reset (pause, resume) let go of the stick while the thumb stayed down.
   * That thumb takes it back when it next moves, so thumbs placed during the
   * 3-2-1 after turning the phone back are live at GO; a new touch takes
   * the stick at once (a parked pointer may never report its release).
   */
  let stickParked = false;

  /** Where the stick waits when nobody's touching it. */
  function restStick() {
    const s = safeInsets();
    const left = !settings.leftHanded;
    const x = left ? s.left + STICK_REST_GAP + tune.stickR : window.innerWidth - s.right - STICK_REST_GAP - tune.stickR;
    const y = window.innerHeight - Math.max(s.bottom, 8) - STICK_REST_GAP - tune.stickR;
    if (stickPointer === null || stickParked) placeBase(stickBase, x, y);
  }

  // Stick and pedal sizes follow the live tuning (the pedal pad is measured on each first touch, so its hit zones follow too).
  const sizes = () => {
    layer.style.setProperty('--stick-r', `${tune.stickR}px`);
    layer.style.setProperty('--aim-r', `${tune.aimR}px`);
    layer.style.setProperty('--pedal-scale', String(tune.pedalScale));
    restStick();
  };
  onTuneChange(sizes);
  sizes();

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
    if (stickPointer !== null && !stickParked) return;
    // Swipes from the bottom edge belong to the home indicator.
    const s = safeInsets();
    if (s.bottom > 0 && e.clientY > window.innerHeight - s.bottom) return;
    stickPointer = e.pointerId;
    stickParked = false;
    stickZone.setPointerCapture(e.pointerId);
    origin.x = thumb.x = e.clientX;
    origin.y = thumb.y = e.clientY;
    clampOrigin(origin, !settings.leftHanded, tune.stickR);
    stickBase.classList.add('active');
    updateStick();
  });
  stickZone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== stickPointer) return;
    if (stickParked) {
      stickParked = false;
      stickBase.classList.add('active');
    }
    thumb.x = e.clientX;
    thumb.y = e.clientY;
    updateStick();
  });
  const releaseStick = (e: { pointerId: number }) => {
    if (e.pointerId !== stickPointer) return;
    stickPointer = null;
    stickParked = false;
    idleStick();
  };
  /** Let go of the stick but remember the thumb (see stickParked). */
  function parkStick() {
    if (stickPointer === null) return;
    stickParked = true;
    idleStick();
  }
  function idleStick() {
    // 'aiming' too: a resting stick mustn't keep the car's direction arrow (it reads as input held).
    stickBase.classList.remove('active', 'aiming');
    out.steer = out.moveX = out.moveY = 0;
    out.sprint = false;
    moveKnob(stickKnob, 0, 0);
    restStick();
  }
  stickZone.addEventListener('pointerup', releaseStick);
  stickZone.addEventListener('pointercancel', releaseStick);
  stickZone.addEventListener('lostpointercapture', releaseStick);

  function updateStick() {
    followThumb(origin, thumb.x, thumb.y, tune.stickR);
    clampOrigin(origin, !settings.leftHanded, tune.stickR);
    const dx = thumb.x - origin.x;
    const dy = thumb.y - origin.y;
    placeBase(stickBase, origin.x, origin.y);
    const len = Math.hypot(dx, dy);
    const k = len > tune.stickR ? tune.stickR / len : 1;
    moveKnob(stickKnob, dx * k, dy * k);
    writeStick(dx, dy);
  }

  function writeStick(dx: number, dy: number) {
    if (stickPointer === null || stickParked) return;
    if (mode === 'car') {
      out.steer = shapeAxis(dx / tune.stickR, tune.steerDz, tune.steerExpo);
      const m = shapeStick(dx, dy, tune.stickR, tune.driveDz, DRIVE_EXPO, shaped);
      out.moveX = shaped.x;
      out.moveY = -shaped.y; // screen-up is positive
      out.sprint = false;
      // The directional arrow on the base shows where the car is being sent.
      stickBase.style.setProperty('--dir', `${Math.atan2(dx, -dy).toFixed(3)}rad`);
      stickBase.classList.toggle('aiming', m > 0);
    } else {
      const m = shapeStick(dx, dy, tune.stickR, tune.walkDz, 1, shaped);
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
  /** As stickParked, for the aim stick. */
  let aimParked = false;
  let aimDownAt = 0;
  let aimTravel = 0;
  let armed = false;
  /**
   * A grenade or molotov in hand: the stick only aims (full deflection, full
   * range) and letting go throws, once; pushing far doesn't fire.
   */
  let throwing = false;
  /** The aim stick is out past its deadzone (a release then throws). */
  let aimDeflected = false;

  /**
   * With a gun out, a faint aim ring waits beside the swap button so the aim
   * pad is discoverable (it works anywhere on that half). Its resting spot is
   * pure CSS (touch.css), so it follows the layout without measuring.
   */
  function restAim() {
    aimBase.classList.toggle('resting', armed && mode === 'foot' && (aimPointer === null || aimParked));
  }

  aimZone.addEventListener('pointerdown', (e) => {
    if ((aimPointer !== null && !aimParked) || mode !== 'foot') return;
    aimPointer = e.pointerId;
    aimParked = false;
    aimZone.setPointerCapture(e.pointerId);
    aimOrigin.x = aimThumb.x = e.clientX;
    aimOrigin.y = aimThumb.y = e.clientY;
    clampOrigin(aimOrigin, settings.leftHanded, tune.aimR);
    aimDownAt = performance.now();
    aimTravel = 0;
    aimBase.classList.remove('resting');
    aimBase.classList.add('active');
    updateAim();
  });
  aimZone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== aimPointer) return;
    if (aimParked) {
      aimParked = false;
      aimBase.classList.remove('resting');
      aimBase.classList.add('active');
    }
    aimTravel += Math.abs(e.clientX - aimThumb.x) + Math.abs(e.clientY - aimThumb.y);
    aimThumb.x = e.clientX;
    aimThumb.y = e.clientY;
    updateAim();
  });
  const releaseAim = (e: { pointerId: number; type?: string }) => {
    if (e.pointerId !== aimPointer) return;
    aimPointer = null;
    const lifted = !aimParked && e.type === 'pointerup';
    const tap = lifted && aimTravel < TAP_PX && performance.now() - aimDownAt < TAP_MS;
    // Letting go of an aimed throw throws it along the last aim (kept in aimX/Y for that read).
    const release = lifted && throwing && aimDeflected && !tap;
    if (tap) out.punchPresses++;
    aimParked = false;
    idleAim(release);
  };
  /** Let go of the aim stick but remember the thumb (see stickParked). */
  function parkAim() {
    if (aimPointer === null) return;
    aimParked = true;
    idleAim();
  }
  function idleAim(release = false) {
    if (release) out.aimRelease = true;
    else out.aimX = out.aimY = 0;
    out.aimFire = false;
    aimDeflected = false;
    aimBase.classList.remove('active', 'firing');
    moveKnob(aimKnob, 0, 0);
    restAim();
  }
  aimZone.addEventListener('pointerup', releaseAim);
  aimZone.addEventListener('pointercancel', releaseAim);
  aimZone.addEventListener('lostpointercapture', releaseAim);

  function updateAim() {
    followThumb(aimOrigin, aimThumb.x, aimThumb.y, tune.aimR);
    clampOrigin(aimOrigin, settings.leftHanded, tune.aimR);
    const dx = aimThumb.x - aimOrigin.x;
    const dy = aimThumb.y - aimOrigin.y;
    placeBase(aimBase, aimOrigin.x, aimOrigin.y);
    const len = Math.hypot(dx, dy);
    const k = len > tune.aimR ? tune.aimR / len : 1;
    moveKnob(aimKnob, dx * k, dy * k);
    const m = shapeStick(dx, dy, tune.aimR, tune.aimDz, 1, shaped);
    out.aimX = shaped.x;
    out.aimY = -shaped.y;
    // A fresh aim replaces one released but not read yet.
    out.aimRelease = false;
    aimDeflected = m > 0;
    const firing = !throwing && m > 0 && Math.min(1, len / tune.aimR) >= AIM_FIRE_AT;
    if (firing !== out.aimFire) {
      out.aimFire = firing;
      aimBase.classList.toggle('firing', firing);
    }
  }

  // ---------------------------------------------------------------- pedals
  const fingers = new Map<number, Vec2>();
  /** Fingers a reset let go of while they stayed down: they press again when they move (see stickParked). */
  const parkedFingers = new Set<number>();
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
    let f = fingers.get(e.pointerId);
    if (!f) {
      if (!parkedFingers.delete(e.pointerId)) return;
      if (!layout) layout = measurePedals();
      fingers.set(e.pointerId, (f = { x: 0, y: 0 }));
    }
    f.x = e.clientX;
    f.y = e.clientY;
    updatePedals();
  });
  const liftFinger = (e: PointerEvent) => {
    parkedFingers.delete(e.pointerId);
    if (!fingers.delete(e.pointerId)) return;
    updatePedals();
  };
  pad.addEventListener('pointerup', liftFinger);
  pad.addEventListener('pointercancel', liftFinger);
  pad.addEventListener('lostpointercapture', liftFinger);

  /** Let go of every pedal; `park` remembers the fingers still down. */
  function releasePedals(park = false) {
    if (park) for (const id of fingers.keys()) parkedFingers.add(id);
    else parkedFingers.clear();
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
  let swapShown: boolean | undefined;
  return {
    layer,
    reset() {
      // Thumbs still down take their control back when they next move.
      parkStick();
      parkAim();
      releasePedals(true);
      out.fireHeld = false;
      for (const b of [fire, swap, door]) b.classList.remove('pressed');
    },
    setWeapon(w, canSwap) {
      if (canSwap !== swapShown) swap.classList.toggle('idle', !(swapShown = canSwap));
      if (w === weapon) return;
      weapon = w;
      fireIcon.innerHTML = WEAPON_ICON[w ?? 'fists'];
      armed = w !== null;
      throwing = w !== null && WEAPONS[w].mode === 'throw';
      // Switched to a throwable with the stick pushed out: stop firing (a release throws).
      if (throwing && out.aimFire) {
        out.aimFire = false;
        aimBase.classList.remove('firing');
      }
      fire.classList.toggle('armed', armed);
      restAim();
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
        restAim();
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

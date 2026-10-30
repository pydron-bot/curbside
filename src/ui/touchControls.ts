import type { InputSource } from '../core/input';

export type ControlMode = 'foot' | 'car';

export interface TouchControls {
  /** Switch button layout; `canAct` shows the ENTER button on foot. */
  setMode(mode: ControlMode, canAct: boolean): void;
  /** Label the attack button for the current weapon (null = fists). */
  setWeapon(label: string | null): void;
}

/**
 * On-screen controls. Left half: a floating joystick (steers in a car, walks
 * on foot; pushing it to the rim sprints). Right side: GAS / BRAKE / HAND in a
 * car, PUNCH on foot, plus an ENTER / EXIT button. Plain DOM over the canvas, shown on the
 * first touch so desktop players never see it.
 */
export function mountTouchControls(root: HTMLElement, out: InputSource): TouchControls {
  const layer = el('div', 'touch-layer');
  layer.hidden = true;
  layer.dataset.mode = 'foot';
  const stickZone = el('div', 'stick-zone');
  const stickBase = el('div', 'stick-base');
  const stickKnob = el('div', 'stick-knob');
  stickBase.append(stickKnob);
  stickZone.append(stickBase);

  const buttons = el('div', 'touch-buttons');
  const action = button('ENTER', 'btn-action');
  const hand = button('HAND', 'btn-hand car-only');
  const brake = button('BRAKE', 'btn-brake car-only');
  const gas = button('GAS', 'btn-gas car-only');
  const punch = button('PUNCH', 'btn-punch foot-only');
  const swap = button('⇄', 'btn-swap foot-only');
  buttons.append(action, hand, brake, gas, punch, swap);
  layer.append(stickZone, buttons);
  root.append(layer);

  const showOnTouch = (e: PointerEvent) => {
    if (e.pointerType === 'touch') layer.hidden = false;
  };
  window.addEventListener('pointerdown', showOnTouch, { capture: true });

  // --- Joystick ---
  const RADIUS = 56;
  let stickPointer: number | null = null;
  let originX = 0;
  let originY = 0;

  stickZone.addEventListener('pointerdown', (e) => {
    if (stickPointer !== null) return;
    stickPointer = e.pointerId;
    stickZone.setPointerCapture(e.pointerId);
    originX = e.clientX;
    originY = e.clientY;
    stickBase.style.left = `${originX}px`;
    stickBase.style.top = `${originY}px`;
    stickBase.classList.add('active');
    moveKnob(0, 0);
  });
  stickZone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== stickPointer) return;
    let dx = e.clientX - originX;
    let dy = e.clientY - originY;
    const len = Math.hypot(dx, dy);
    if (len > RADIUS) {
      dx = (dx / len) * RADIUS;
      dy = (dy / len) * RADIUS;
    }
    moveKnob(dx, dy);
    const nx = dx / RADIUS;
    const ny = dy / RADIUS;
    out.steer = Math.abs(nx) < 0.08 ? 0 : nx;
    out.moveX = nx;
    out.moveY = -ny; // screen-up is positive
    out.sprint = len >= RADIUS * 0.9;
  });
  const releaseStick = (e: PointerEvent) => {
    if (e.pointerId !== stickPointer) return;
    stickPointer = null;
    stickBase.classList.remove('active');
    stickBase.style.left = '';
    stickBase.style.top = '';
    out.steer = out.moveX = out.moveY = 0;
    out.sprint = false;
    moveKnob(0, 0);
  };
  stickZone.addEventListener('pointerup', releaseStick);
  stickZone.addEventListener('pointercancel', releaseStick);

  function moveKnob(dx: number, dy: number) {
    stickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  // --- Buttons (multi-touch: each tracks its own pointers) ---
  const held = { gas: false, brake: false, hand: false };
  const sync = () => {
    out.throttle = (held.gas ? 1 : 0) - (held.brake ? 1 : 0);
    out.handbrake = held.hand;
  };
  bindHold(gas, (v) => ((held.gas = v), sync()));
  bindHold(brake, (v) => ((held.brake = v), sync()));
  bindHold(hand, (v) => ((held.hand = v), sync()));
  punch.addEventListener('pointerdown', (e) => {
    punch.setPointerCapture(e.pointerId);
    out.punchPresses++;
    out.fireHeld = true;
    punch.classList.add('pressed');
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
    punch.addEventListener(type, () => {
      out.fireHeld = false;
      punch.classList.remove('pressed');
    });
  }
  swap.addEventListener('pointerdown', () => out.cyclePresses++);
  action.addEventListener('pointerdown', () => {
    out.actionPresses++;
    action.classList.add('pressed');
  });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const) {
    action.addEventListener(type, () => action.classList.remove('pressed'));
  }

  let weaponLabel: string | null = null;
  return {
    setWeapon(label) {
      if (label === weaponLabel) return;
      weaponLabel = label;
      punch.textContent = label ? 'FIRE' : 'PUNCH';
      punch.classList.toggle('armed', label !== null);
    },
    setMode(mode, canAct) {
      if (layer.dataset.mode !== mode) {
        layer.dataset.mode = mode;
        // Don't carry held pedals into or out of a car.
        held.gas = held.brake = held.hand = false;
        sync();
        for (const b of [gas, brake, hand]) b.classList.remove('pressed');
      }
      action.textContent = mode === 'car' ? 'EXIT' : 'ENTER';
      action.classList.toggle('available', mode === 'car' || canAct);
    },
  };
}

function bindHold(target: HTMLElement, set: (down: boolean) => void): void {
  const active = new Set<number>();
  const update = () => {
    target.classList.toggle('pressed', active.size > 0);
    set(active.size > 0);
  };
  target.addEventListener('pointerdown', (e) => {
    target.setPointerCapture(e.pointerId);
    active.add(e.pointerId);
    update();
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
    target.addEventListener(type, (e) => {
      active.delete(e.pointerId);
      update();
    });
  }
}

function el(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function button(label: string, className: string): HTMLElement {
  const b = el('div', `touch-btn ${className}`);
  b.textContent = label;
  return b;
}

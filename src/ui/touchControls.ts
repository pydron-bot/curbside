import type { InputSource } from '../core/input';

/**
 * On-screen controls: a floating joystick anywhere on the left half (steer),
 * and GAS / BRAKE / HANDBRAKE buttons on the right. Plain DOM over the canvas.
 * Shown on the first touch so desktop players never see it.
 */
export function mountTouchControls(root: HTMLElement, out: InputSource): void {
  const layer = el('div', 'touch-layer');
  layer.hidden = true;
  const stickZone = el('div', 'stick-zone');
  const stickBase = el('div', 'stick-base');
  const stickKnob = el('div', 'stick-knob');
  stickBase.append(stickKnob);
  stickZone.append(stickBase);

  const buttons = el('div', 'touch-buttons');
  const hand = button('HAND', 'btn-hand');
  const brake = button('BRAKE', 'btn-brake');
  const gas = button('GAS', 'btn-gas');
  buttons.append(hand, brake, gas);
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
    out.steer = Math.abs(nx) < 0.08 ? 0 : nx;
  });
  const releaseStick = (e: PointerEvent) => {
    if (e.pointerId !== stickPointer) return;
    stickPointer = null;
    stickBase.classList.remove('active');
    stickBase.style.left = '';
    stickBase.style.top = '';
    out.steer = 0;
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

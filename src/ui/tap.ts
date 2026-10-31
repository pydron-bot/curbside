/**
 * Taps for menu controls that work with other fingers on the glass. A
 * browser only turns a lone finger into a click, and in play a thumb is
 * nearly always on the stick, aim pad or pedals (still down through pause and
 * modals), so click-only buttons showed :active but did nothing. Touch and
 * pen presses on a control registered here are judged from pointer events
 * instead (TapTracker). The action runs in the touchend that follows (a user
 * gesture on every engine: share, clipboard, haptics, fullscreen), and that
 * touchend is cancelled so no click follows to act twice or land on whatever
 * the tap uncovered. Mouse, keyboard and VoiceOver still arrive as click.
 */
import { TapTracker } from './tapTracker';

export interface TapOptions {
  /** Only the browser's click activates it (the Diagnostics ON CLICK probe measures exactly that). */
  clickOnly?: boolean;
}

interface Tap {
  fn: () => void;
  clickOnly: boolean;
}

const taps = new WeakMap<Element, Tap>();
const tracker = new TapTracker<HTMLElement, Element>();
/** The pressed control's scrolling list, and its scrollTop at the press. */
let pressList: Element | null = null;
let pressScroll = 0;
/** The control whose press just lifted: its touchend is cancelled (no click). */
let ending: HTMLElement | null = null;
/** A tap waiting for that touchend to run in. */
let pending: Tap | null = null;
let installed = false;

/**
 * Run `fn` when `el` is tapped (touch / pen, judged on pointer events) or
 * clicked (mouse, keyboard, assistive tech). The innermost registered
 * control under the finger wins, so a button inside a registered row acts
 * alone.
 */
export function onTap(el: HTMLElement, fn: () => void, opts: TapOptions = {}): void {
  install();
  taps.set(el, { fn, clickOnly: opts.clickOnly === true });
  el.addEventListener('click', (e) => {
    // Never the native action (the title's hub link navigates in fn).
    e.preventDefault();
    if (registered(e.target) === el) fn();
  });
}

/** The innermost registered control at or above `t`. */
function registered(t: EventTarget | null): HTMLElement | null {
  for (let n = t instanceof Element ? t : null; n; n = n.parentElement) {
    if (taps.has(n)) return n as HTMLElement;
  }
  return null;
}

function install(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('pointermove', onMove, { capture: true, passive: true });
  document.addEventListener('pointerup', onUp, true);
  document.addEventListener('pointercancel', (e) => tracker.cancel(e.pointerId), true);
  document.addEventListener('touchend', onTouchEnd, { capture: true, passive: false });
  // Scroll doesn't bubble; capture sees every list's.
  document.addEventListener(
    'scroll',
    (e) => {
      if (e.target instanceof Element) tracker.scrolled(e.target, e.timeStamp);
    },
    { capture: true, passive: true },
  );
  window.addEventListener('click', onClick, true);
}

function onDown(e: PointerEvent): void {
  if (e.pointerType === 'mouse' || e.button !== 0) return;
  const el = registered(e.target);
  if (!el || taps.get(el)!.clickOnly) return;
  pressList = el.closest('[data-scroll]');
  pressScroll = pressList ? pressList.scrollTop : 0;
  tracker.down(el, e.pointerId, e.clientX, e.clientY, e.timeStamp, el.getBoundingClientRect(), pressList);
}

function onMove(e: PointerEvent): void {
  if (tracker.active) tracker.move(e.pointerId, e.clientX, e.clientY);
}

function onUp(e: PointerEvent): void {
  const el = tracker.pressing(e.pointerId);
  if (!el) return;
  ending = el;
  window.setTimeout(settle, 0);
  const hit = tracker.up(e.pointerId, e.clientX, e.clientY, e.timeStamp);
  // The list moved (its scroll event may not have been dispatched yet).
  if (!hit || (pressList && Math.abs(pressList.scrollTop - pressScroll) > 1) || !usable(hit, e.clientX, e.clientY)) return;
  pending = taps.get(hit)!;
}

function onTouchEnd(e: TouchEvent): void {
  if (!ending) return;
  const touches = e.changedTouches;
  for (let i = 0; i < touches.length; i++) {
    const t = touches[i].target;
    if (t instanceof Node && ending.contains(t)) {
      e.preventDefault();
      settle();
      return;
    }
  }
}

/** Run the tap in its touchend, or just after the pointerup if none comes (a pen without touch events). */
function settle(): void {
  ending = null;
  const tap = pending;
  pending = null;
  tap?.fn();
}

function onClick(e: MouseEvent): void {
  if (e.isTrusted && tracker.trailingClick(e.clientX, e.clientY, e.timeStamp)) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }
}

/** Still showing, enabled and on top: an overlay that opened over it mid-tap takes the touch (WebKit drops that click too). */
function usable(el: HTMLElement, x: number, y: number): boolean {
  if (el.getClientRects().length === 0 || el.hasAttribute('disabled')) return false;
  if (el.contains(document.elementFromPoint(x, y))) return true;
  // Released just off it (the edge allowance), or the layout moved under the finger.
  const r = el.getBoundingClientRect();
  return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
}

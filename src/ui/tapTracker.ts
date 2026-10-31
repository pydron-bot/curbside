/**
 * The decision behind onTap (tap.ts): a touch or pen press on a menu control
 * is a tap if it lifts near where it landed, before long, still over the
 * control, and its list didn't scroll. Other fingers on the glass don't
 * matter (they do to the browser, which only turns a lone finger into a
 * click). Each finger on a control is tracked; the first to lift as a tap
 * acts and the others then lift as nothing, so a thumb landing on a shop item
 * mid-tap neither loses the tap nor buys. Pure, no DOM; `T` is the control,
 * `C` the scrolling list it sits in.
 */
export interface TapRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Travel (CSS px) that makes a press a drag; just under Chromium's ~15 px tap slop. */
export const TAP_SLOP = 14;
/** A release this far outside the control (CSS px) still counts: thumbs are fat and :active shrinks buttons. */
export const TAP_EDGE = 8;
/** Held longer than this (ms) it's a thumb resting on the button, not a tap (a lone finger's is the browser's call, see `slow`). */
export const TAP_MAX_MS = 1500;
/** A list that scrolled twice within this long (ms), the last just before the press, is still moving: the press stops a fling. */
export const FLING_GAP_MS = 120;
/** The browser's own click can trail a press by this long (ms)… */
export const CLICK_TRAIL_MS = 800;
/** …this close (CSS px) to where it lifted. */
export const CLICK_TRAIL_PX = 24;
/** Fingers on controls tracked at once; a further one replaces the oldest. */
const MAX_PRESSES = 4;

interface Press<T, C> {
  target: T | null;
  list: C | null;
  pointerId: number;
  x: number;
  y: number;
  t: number;
  rect: TapRect | null;
  /** The list's scroll offset at the press. */
  scroll: number;
  /** Still a tap candidate (hasn't travelled past the slop). */
  still: boolean;
  /** Another press acted first: this one lifts as nothing (its click is still eaten). */
  spent: boolean;
}

export class TapTracker<T, C = unknown> {
  private readonly presses: Press<T, C>[] = [];
  private scrolledList: C | null = null;
  private scrolledAt = -Infinity;
  private scrolledBefore = -Infinity;
  private endedAt = -Infinity;
  private endX = 0;
  private endY = 0;
  private slowTarget: T | null = null;

  constructor() {
    for (let i = 0; i < MAX_PRESSES; i++) {
      this.presses.push({ target: null, list: null, pointerId: 0, x: 0, y: 0, t: 0, rect: null, scroll: 0, still: false, spent: false });
    }
  }

  /** The control `pointerId` is pressing, or null. */
  pressing(pointerId: number): T | null {
    return this.find(pointerId)?.target ?? null;
  }

  /** The scrolling list `pointerId`'s control sits in, or null. */
  listOf(pointerId: number): C | null {
    return this.find(pointerId)?.list ?? null;
  }

  /** Any press in progress (cheap: pointermove asks every time). */
  get active(): boolean {
    for (const p of this.presses) if (p.target !== null) return true;
    return false;
  }

  /**
   * The control the press up() just ended would have tapped had it been
   * quicker, or null. A lone finger held that long is the browser's to
   * judge, as before onTap (iOS clicks a button after a long press).
   */
  get slow(): T | null {
    return this.slowTarget;
  }

  /**
   * A finger landed on `target` (`rect` its bounds now, `list` the scrolling
   * list it's in and `scroll` that list's offset).
   */
  down(target: T, pointerId: number, x: number, y: number, t: number, rect: TapRect, list: C | null = null, scroll = 0): void {
    const same = this.find(pointerId);
    if (same) same.target = null;
    // A tap on a moving list stops it, and iOS sends no click for that. Left
    // untracked, so the browser's click decides: none for a real fling, but a
    // lone finger just after two quick programmatic scrolls still gets one.
    if (list !== null && list === this.scrolledList && t - this.scrolledAt < FLING_GAP_MS && this.scrolledAt - this.scrolledBefore < FLING_GAP_MS) return;
    let p = this.presses[0];
    for (const q of this.presses) {
      if (q.target === null) {
        p = q;
        break;
      }
      if (q.t < p.t) p = q;
    }
    p.target = target;
    p.list = list;
    p.pointerId = pointerId;
    p.x = x;
    p.y = y;
    p.t = t;
    p.rect = rect;
    p.scroll = scroll;
    p.still = true;
    p.spent = false;
  }

  move(pointerId: number, x: number, y: number): void {
    const p = this.find(pointerId);
    if (p && p.still && beyond(x - p.x, y - p.y, TAP_SLOP)) p.still = false;
  }

  /** The browser took the touch (pointercancel): no tap, and no click to expect. */
  cancel(pointerId: number): void {
    const p = this.find(pointerId);
    if (p) p.target = null;
  }

  /** A list scrolled: a press on it is a drag, and a press soon after may be stopping a fling. */
  scrolled(list: C, t: number): void {
    if (list === this.scrolledList) this.scrolledBefore = this.scrolledAt;
    else {
      this.scrolledList = list;
      this.scrolledBefore = -Infinity;
    }
    this.scrolledAt = t;
    for (const p of this.presses) if (p.target !== null && p.list === list) p.still = false;
  }

  /**
   * The finger lifted (`scroll` its list's offset now): the control it
   * tapped, or null. A press that ends here is ours either way, so a click
   * the browser sends after it is trailing (see trailingClick) unless
   * releaseClick says otherwise.
   */
  up(pointerId: number, x: number, y: number, t: number, scroll = 0): T | null {
    this.slowTarget = null;
    const p = this.find(pointerId);
    if (!p) return null;
    const target = p.target!;
    p.target = null;
    this.endedAt = t;
    this.endX = x;
    this.endY = y;
    if (p.spent || !p.still || beyond(x - p.x, y - p.y, TAP_SLOP)) return null;
    // The list moved (its scroll event may not have been dispatched yet).
    if (p.list !== null && Math.abs(scroll - p.scroll) > 1) return null;
    const r = p.rect!;
    if (x < r.left - TAP_EDGE || x > r.right + TAP_EDGE || y < r.top - TAP_EDGE || y > r.bottom + TAP_EDGE) return null;
    if (t - p.t > TAP_MAX_MS) {
      this.slowTarget = target;
      return null;
    }
    for (const q of this.presses) q.spent = q.target !== null;
    return target;
  }

  /**
   * A trusted click at (x, y): true if it's the browser's own click for a
   * press up() already decided (eat it, once), so a tap never acts twice and
   * never lands on whatever the tap uncovered.
   */
  trailingClick(x: number, y: number, t: number): boolean {
    if (t - this.endedAt > CLICK_TRAIL_MS || beyond(x - this.endX, y - this.endY, CLICK_TRAIL_PX)) return false;
    this.endedAt = -Infinity;
    return true;
  }

  /** The next click is the browser's own to make (a slow lone press, or a mouse pressed since): don't eat it. */
  releaseClick(): void {
    this.endedAt = -Infinity;
  }

  private find(pointerId: number): Press<T, C> | null {
    for (const p of this.presses) if (p.target !== null && p.pointerId === pointerId) return p;
    return null;
  }
}

function beyond(dx: number, dy: number, r: number): boolean {
  return dx * dx + dy * dy > r * r;
}

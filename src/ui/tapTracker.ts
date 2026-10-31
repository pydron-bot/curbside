/**
 * The decision behind onTap (tap.ts): a touch or pen press on a menu control
 * is a tap if it lifts near where it landed, before long, still over the
 * control, and its list didn't scroll. Other fingers on the glass don't
 * matter (they do to the browser, which only turns a lone finger into a
 * click). One press at a time: the newest wins, so an earlier finger left on
 * a button is just resting. Pure, no DOM; `T` is the control, `C` the
 * scrolling list it sits in.
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
/** Held longer than this (ms) it's a thumb resting on the button, not a tap. */
export const TAP_MAX_MS = 1500;
/** A list that scrolled twice within this long (ms), the last just before the press, is still moving: the press stops a fling. */
export const FLING_GAP_MS = 120;
/** The browser's own click can trail a press by this long (ms)… */
export const CLICK_TRAIL_MS = 800;
/** …this close (CSS px) to where it lifted. */
export const CLICK_TRAIL_PX = 24;

export class TapTracker<T, C = unknown> {
  private target: T | null = null;
  private list: C | null = null;
  private pointerId = 0;
  private x = 0;
  private y = 0;
  private t = 0;
  private rect: TapRect | null = null;
  /** Still a tap candidate (hasn't travelled past the slop). */
  private still = false;
  private scrolledList: C | null = null;
  private scrolledAt = -Infinity;
  private scrolledBefore = -Infinity;
  private endedAt = -Infinity;
  private endX = 0;
  private endY = 0;

  /** The control `pointerId` is pressing, or null. */
  pressing(pointerId: number): T | null {
    return this.target !== null && pointerId === this.pointerId ? this.target : null;
  }

  /** Any press in progress (cheap: pointermove asks every time). */
  get active(): boolean {
    return this.target !== null;
  }

  /**
   * A finger landed on `target` (`rect` its bounds now, `list` the scrolling
   * list it's in). Replaces any press already in progress.
   */
  down(target: T, pointerId: number, x: number, y: number, t: number, rect: TapRect, list: C | null = null): void {
    this.target = null;
    // A tap on a moving list stops it (iOS sends no click for that either).
    if (list !== null && list === this.scrolledList && t - this.scrolledAt < FLING_GAP_MS && this.scrolledAt - this.scrolledBefore < FLING_GAP_MS) return;
    this.target = target;
    this.list = list;
    this.pointerId = pointerId;
    this.x = x;
    this.y = y;
    this.t = t;
    this.rect = rect;
    this.still = true;
  }

  move(pointerId: number, x: number, y: number): void {
    if (this.target === null || pointerId !== this.pointerId || !this.still) return;
    if (beyond(x - this.x, y - this.y, TAP_SLOP)) this.still = false;
  }

  /** The browser took the touch (pointercancel): no tap, and no click to expect. */
  cancel(pointerId: number): void {
    if (pointerId === this.pointerId) this.target = null;
  }

  /** A list scrolled: a press on it is a drag, and a press soon after may be stopping a fling. */
  scrolled(list: C, t: number): void {
    if (list === this.scrolledList) this.scrolledBefore = this.scrolledAt;
    else {
      this.scrolledList = list;
      this.scrolledBefore = -Infinity;
    }
    this.scrolledAt = t;
    if (this.target !== null && list === this.list) this.still = false;
  }

  /**
   * The finger lifted: the control it tapped, or null. A press that ends
   * here is ours either way, so a click the browser sends after it is
   * trailing (see trailingClick).
   */
  up(pointerId: number, x: number, y: number, t: number): T | null {
    const target = this.target;
    if (target === null || pointerId !== this.pointerId) return null;
    this.target = null;
    this.endedAt = t;
    this.endX = x;
    this.endY = y;
    if (!this.still || beyond(x - this.x, y - this.y, TAP_SLOP) || t - this.t > TAP_MAX_MS) return null;
    const r = this.rect!;
    if (x < r.left - TAP_EDGE || x > r.right + TAP_EDGE || y < r.top - TAP_EDGE || y > r.bottom + TAP_EDGE) return null;
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
}

function beyond(dx: number, dy: number, r: number): boolean {
  return dx * dx + dy * dy > r * r;
}

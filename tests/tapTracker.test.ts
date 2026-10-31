import { describe, expect, it } from 'vitest';
import { CLICK_TRAIL_MS, FLING_GAP_MS, TAP_EDGE, TAP_MAX_MS, TAP_SLOP, TapTracker } from '../src/ui/tapTracker';

// A 100×44 button at (100, 50).
const rect = { left: 100, top: 50, right: 200, bottom: 94 };
const LIST = 'list';

function press(id = 1, x = 150, y = 72, t = 1000, list: string | null = null): TapTracker<string, string> {
  const tr = new TapTracker<string, string>();
  tr.down('btn', id, x, y, t, rect, list);
  return tr;
}

describe('tap tracker', () => {
  it('a press that lifts where it landed is a tap', () => {
    const tr = press();
    expect(tr.pressing(1)).toBe('btn');
    expect(tr.up(1, 151, 73, 1090)).toBe('btn');
    expect(tr.active).toBe(false);
  });

  it("ignores other fingers' pointers (a thumb on the stick)", () => {
    const tr = press(5);
    tr.move(2, 400, 300);
    tr.cancel(2);
    expect(tr.up(2, 150, 72, 1050)).toBeNull();
    expect(tr.pressing(5)).toBe('btn');
    expect(tr.up(5, 150, 72, 1080)).toBe('btn');
  });

  it('a drag past the slop is not a tap, even if it comes back', () => {
    const tr = press();
    tr.move(1, 150 + TAP_SLOP + 1, 72);
    tr.move(1, 150, 72);
    expect(tr.up(1, 150, 72, 1100)).toBeNull();
  });

  it('allows a small roll, and a release just off the edge', () => {
    const tr = press(1, 195, 72);
    tr.move(1, 200, 75);
    expect(tr.up(1, 200 + TAP_EDGE - 1, 75, 1100)).toBe('btn');
  });

  it('a release further off the edge than the allowance cancels', () => {
    const tr = press(1, 198, 72);
    expect(tr.up(1, 198 + TAP_SLOP - 1, 72, 1100)).toBeNull(); // within the slop, but 11 px off the button
  });

  it('a thumb left resting on the button is not a tap', () => {
    expect(press().up(1, 150, 72, 1000 + TAP_MAX_MS + 1)).toBeNull();
    expect(press().up(1, 150, 72, 1000 + TAP_MAX_MS - 1)).toBe('btn');
  });

  it('pointercancel (the browser took the touch) ends the press with nothing', () => {
    const tr = press();
    tr.cancel(1);
    expect(tr.pressing(1)).toBeNull();
    expect(tr.up(1, 150, 72, 1100)).toBeNull();
  });

  it('the newest press wins: an earlier finger on a button is just resting', () => {
    const tr = press(1);
    tr.down('other', 2, 150, 72, 1200, rect);
    expect(tr.up(1, 150, 72, 1250)).toBeNull();
    expect(tr.up(2, 150, 72, 1300)).toBe('other');
  });

  it('acts once per press', () => {
    const tr = press();
    expect(tr.up(1, 150, 72, 1100)).toBe('btn');
    expect(tr.up(1, 150, 72, 1110)).toBeNull();
  });

  it('its list scrolling makes the press a drag', () => {
    const tr = press(1, 150, 72, 1000, LIST);
    tr.scrolled('elsewhere', 1010);
    expect(tr.pressing(1)).toBe('btn');
    tr.scrolled(LIST, 1020);
    expect(tr.pressing(1)).toBe('btn'); // still ours (its click is eaten)…
    expect(tr.up(1, 150, 72, 1100)).toBeNull(); // …but no tap
  });

  it('a press that stops a fling is not a tap; one after the list settles is', () => {
    const tr = new TapTracker<string, string>();
    tr.scrolled(LIST, 1000);
    tr.scrolled(LIST, 1016);
    tr.down('btn', 1, 150, 72, 1030, rect, LIST);
    expect(tr.pressing(1)).toBeNull();
    tr.down('btn', 2, 150, 72, 1016 + FLING_GAP_MS + 1, rect, LIST);
    expect(tr.up(2, 150, 72, 1200)).toBe('btn');
  });

  it('one programmatic scroll (scrollIntoView) is not a fling', () => {
    const tr = new TapTracker<string, string>();
    tr.scrolled(LIST, 1000);
    tr.down('btn', 1, 150, 72, 1010, rect, LIST);
    expect(tr.up(1, 150, 72, 1080)).toBe('btn');
  });

  it("eats the browser's own click after a press, once, near where it lifted", () => {
    const tr = press();
    tr.up(1, 150, 72, 1100);
    expect(tr.trailingClick(400, 72, 1150)).toBe(false); // somewhere else
    expect(tr.trailingClick(152, 74, 1150)).toBe(true);
    expect(tr.trailingClick(152, 74, 1160)).toBe(false);
  });

  it('eats a trailing click even when the press was no tap (it would land on whatever is now there)', () => {
    const tr = press();
    tr.move(1, 150 + TAP_SLOP + 1, 72);
    expect(tr.up(1, 150 + TAP_SLOP + 1, 72, 1100)).toBeNull();
    expect(tr.trailingClick(150 + TAP_SLOP + 1, 72, 1120)).toBe(true);
  });

  it('leaves later clicks alone (mouse, keyboard, VoiceOver)', () => {
    const tr = press();
    tr.up(1, 150, 72, 1100);
    expect(tr.trailingClick(150, 72, 1100 + CLICK_TRAIL_MS + 1)).toBe(false);
    expect(new TapTracker().trailingClick(0, 0, 5)).toBe(false);
  });
});

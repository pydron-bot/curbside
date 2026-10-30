/**
 * Keep iOS Safari's own gestures out of the game: pinch-zoom (ignored
 * maximum-scale), double-tap zoom, the text loupe and callout on long
 * presses, and as much of the edge swipe as a page can stop. Two-thumb play
 * (stick + buttons) is exactly when an accidental pinch happens.
 *
 * `surfaces` are the elements played on (canvas, touch controls): their
 * touchstart is cancelled outright (pointer events still fire). Menus are
 * left alone so taps on their buttons still turn into clicks and their
 * lists can scroll.
 */
export function blockBrowserGestures(surfaces: HTMLElement[]): void {
  const stop = (e: Event) => e.preventDefault();
  // Safari's proprietary pinch events.
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(type, stop, { passive: false });
  }
  document.addEventListener('dblclick', stop, { passive: false });
  document.addEventListener('contextmenu', stop);
  // Two fingers anywhere are a pinch in the making.
  document.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length > 1 || !scrollableTarget(e.target)) e.preventDefault();
    },
    { passive: false },
  );
  for (const el of surfaces) el.addEventListener('touchstart', stop, { passive: false });
}

/** Inside something that's meant to scroll (a settings list)? */
function scrollableTarget(t: EventTarget | null): boolean {
  return t instanceof Element && t.closest('[data-scroll]') !== null;
}

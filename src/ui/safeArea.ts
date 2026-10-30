/**
 * The screen's safe-area insets in CSS px (notch, Dynamic Island, home
 * indicator), read through a probe element so JS layout (joystick clamping,
 * threat chevrons) agrees with CSS. CSS exposes them as --safe-t/r/b/l on
 * :root (see touch.css), which a test can override to emulate an iPhone.
 */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
let probe: HTMLElement | null = null;
let stale = true;

// Registered when the module loads, so it runs before any resize handler
// that reads the insets (those modules import this one first).
if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => (stale = true));
  window.addEventListener('orientationchange', () => (stale = true));
}

/** Current insets; re-measured after a resize or rotation, otherwise cached. */
export function safeInsets(): Readonly<Insets> {
  if (typeof document === 'undefined') return insets;
  if (!probe) {
    probe = document.createElement('div');
    probe.className = 'safe-probe';
    document.body.append(probe);
  }
  if (stale) {
    stale = false;
    const cs = getComputedStyle(probe);
    insets.top = parseFloat(cs.paddingTop) || 0;
    insets.right = parseFloat(cs.paddingRight) || 0;
    insets.bottom = parseFloat(cs.paddingBottom) || 0;
    insets.left = parseFloat(cs.paddingLeft) || 0;
  }
  return insets;
}

/** Force a re-measure on the next read (e.g. after injecting test CSS). */
export function invalidateSafeInsets(): void {
  stale = true;
}

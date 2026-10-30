/**
 * Inline SVG icons for the HUD, touch controls and menus. Drawn on a 24×24
 * grid in currentColor so CSS colours them; no icon font or image requests.
 */
const svg = (body: string, extra = '') =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"${extra}>${body}</svg>`;

export const ICONS = {
  /** Accelerator pedal: a ribbed plate. */
  gas: svg(
    '<rect x="6.5" y="2.5" width="11" height="19" rx="3" fill="currentColor" opacity=".22"/>' +
      '<rect x="6.5" y="2.5" width="11" height="19" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/>' +
      '<path d="M9.5 7h5M9.5 10.5h5M9.5 14h5M9.5 17.5h5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  ),
  /** Brake pedal: a wide pad. */
  brake: svg(
    '<rect x="3.5" y="6" width="17" height="12" rx="3" fill="currentColor" opacity=".22"/>' +
      '<rect x="3.5" y="6" width="17" height="12" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/>' +
      '<path d="M7.5 10h9M7.5 14h9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  ),
  /** Handbrake: the (P) brake warning symbol. */
  hand: svg(
    '<circle cx="12" cy="12" r="6.2" fill="none" stroke="currentColor" stroke-width="2"/>' +
      '<path d="M4.6 6.2a9 9 0 0 0 0 11.6M19.4 6.2a9 9 0 0 1 0 11.6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
      '<path d="M10.3 15.2V8.8h2.4a2 2 0 0 1 0 4h-2.4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/>',
  ),
  /** Car door with handle, for getting in and out. */
  door: svg(
    '<path d="M5 20V8.5L10.5 4H19v16z" fill="currentColor" opacity=".2"/>' +
      '<path d="M5 20V8.5L10.5 4H19v16zM5 11h14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/>' +
      '<path d="M14 14h3" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  ),
  fist: svg(
    '<path d="M6 10.5V8.2a1.6 1.6 0 0 1 3.2 0V7a1.6 1.6 0 0 1 3.2 0v.3a1.6 1.6 0 0 1 3.2 0v.6a1.6 1.6 0 0 1 3.2 0v5.6c0 3.6-2.6 6.5-6.3 6.5h-.9C8.3 20 6 17.6 6 14.6z" fill="currentColor"/>' +
      '<path d="M9.2 8.2v3M12.4 7.3v3.6M15.6 7.9v3.2M6 12.5c1.6-.7 3.4-.4 4.6.8" fill="none" stroke="rgb(0 0 0 / .45)" stroke-width="1.2" stroke-linecap="round"/>',
  ),
  pistol: svg(
    '<path d="M3 7h17.5v4H11l-1.2 1.5.9 6.5H6.3l-.4-6.1L3 11z" fill="currentColor"/><path d="M11.4 11.6l1.4 2.6h-2" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  ),
  smg: svg(
    '<path d="M2 8h15v-1.5h2V8h3v3h-5l-.5 1.4h-3.2l1 6.6H9.6l-1-6.6H6.2l-.6 3.6H3.2l.6-4.1L2 11z" fill="currentColor"/><path d="M13.5 12.4l-.7 5.6h1.8" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  ),
  shotgun: svg(
    '<path d="M1.5 9.2h16v-1.2h5v3.2h-12l-1.4 1.6-4 4.6H2.7l3-4.6H1.5z" fill="currentColor"/><path d="M11.5 11.2h4.2v1.6h-4.2z" fill="currentColor" opacity=".55"/>',
  ),
  /** A frag grenade: ribbed body, lever and pin ring. */
  grenade: svg(
    '<ellipse cx="11" cy="14.5" rx="6.2" ry="7" fill="currentColor"/>' +
      '<path d="M5.2 12.5h11.6M5.2 16.5h11.6M11 7.6v13.8" stroke="rgb(0 0 0 / .4)" stroke-width="1.1"/>' +
      '<path d="M8.6 7.8V5.6h4.8v2.2M13.4 6.2l5.4 3.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>' +
      '<circle cx="18.2" cy="4.4" r="2" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  ),
  /** A bottle with a burning rag. */
  molotov: svg(
    '<path d="M10 9.5h4l1.8 3.2V21a1 1 0 0 1-1 1H9.2a1 1 0 0 1-1-1v-8.3z" fill="currentColor"/>' +
      '<path d="M10.4 6.2h3.2v3.3h-3.2z" fill="currentColor" opacity=".8"/>' +
      '<path d="M12 1.6c1.9 1.6 2.6 3 1.8 4.4-.4-.9-1-1.2-1.8-1.3-.8.1-1.4.4-1.8 1.3-.8-1.4-.1-2.8 1.8-4.4z" fill="currentColor"/>' +
      '<path d="M8.3 15h7.4" stroke="rgb(0 0 0 / .4)" stroke-width="1.2"/>',
  ),
  /** A shoulder launcher with a rocket in it. */
  rocket: svg(
    '<path d="M1.5 10h16v4.2h-16z" fill="currentColor"/>' +
      '<path d="M17.5 9.2l3.4 1.6c.8.4.8 1.6 0 2l-3.4 1.6z" fill="currentColor"/>' +
      '<path d="M6 14.2l-1 4.6h2.6l1-4.6M11 14.2v3.4h2.4v-3.4" fill="currentColor" opacity=".85"/>' +
      '<path d="M4 10v4.2M15 10v4.2" stroke="rgb(0 0 0 / .4)" stroke-width="1.2"/>',
  ),
  /** Body armour: a vest. */
  armour: svg(
    '<path d="M8 3h2.2c.4 1.4 1 2 1.8 2s1.4-.6 1.8-2H16l3.5 2.4-1.6 4.4V20a1 1 0 0 1-1 1H7.1a1 1 0 0 1-1-1V9.8L4.5 5.4z" fill="currentColor"/>' +
      '<path d="M12 6.2V21M8.2 12.5h2.4M13.4 12.5h2.4" stroke="rgb(0 0 0 / .4)" stroke-width="1.2"/>',
  ),
  /** Three rounds: ammo. */
  ammo: svg(
    '<path d="M4.5 9.5c0-2.4 1-4.6 2-6 1 1.4 2 3.6 2 6V20h-4zM10 9.5c0-2.4 1-4.6 2-6 1 1.4 2 3.6 2 6V20h-4zM15.5 9.5c0-2.4 1-4.6 2-6 1 1.4 2 3.6 2 6V20h-4z" fill="currentColor"/>' +
      '<path d="M4.5 11h4M10 11h4M15.5 11h4" stroke="rgb(0 0 0 / .4)" stroke-width="1.2"/>',
  ),
  /** Nitro: a bottle with a speed flash. */
  nitro: svg(
    '<path d="M9.5 6h5v2.2c1.6.7 2.5 2.1 2.5 3.8V20a1.4 1.4 0 0 1-1.4 1.4H8.4A1.4 1.4 0 0 1 7 20v-8c0-1.7.9-3.1 2.5-3.8z" fill="currentColor"/>' +
      '<path d="M10.5 2.6h3V6h-3z" fill="currentColor" opacity=".8"/>' +
      '<path d="M12.8 10.5l-2.6 4.2h2.2l-1.2 4 3.4-5h-2.2l1.2-3.2z" fill="rgb(0 0 0 / .5)"/>',
  ),
  swap: svg(
    '<path d="M4 8.5h13.5M14 5l3.5 3.5L14 12M20 15.5H6.5M10 12l-3.5 3.5L10 19" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  ),
  pause: svg('<rect x="6.5" y="5" width="4" height="14" rx="1.2" fill="currentColor"/><rect x="13.5" y="5" width="4" height="14" rx="1.2" fill="currentColor"/>'),
  play: svg('<path d="M8 5.2v13.6a.8.8 0 0 0 1.2.7l10.6-6.8a.8.8 0 0 0 0-1.4L9.2 4.5A.8.8 0 0 0 8 5.2z" fill="currentColor"/>'),
  crosshair: svg(
    '<circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/>',
  ),
  gear: svg(
    '<path d="M12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8z" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M10.4 3h3.2l.5 2.4 1.7.9 2.3-.9 1.6 2.8-1.8 1.6v2.4l1.8 1.6-1.6 2.8-2.3-.9-1.7.9-.5 2.4h-3.2l-.5-2.4-1.7-.9-2.3.9-1.6-2.8 1.8-1.6v-2.4L4.3 8.2l1.6-2.8 2.3.9 1.7-.9z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  ),
  help: svg(
    '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M9.4 9.3a2.7 2.7 0 1 1 3.9 2.4c-.8.4-1.3 1-1.3 1.9v.6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><circle cx="12" cy="17.2" r="1.2" fill="currentColor"/>',
  ),
  restart: svg(
    '<path d="M5 12a7 7 0 1 0 2.1-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M6.2 3.2l.9 3.8 3.8-.9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  ),
  exit: svg(
    '<path d="M14 4h4.5a1.5 1.5 0 0 1 1.5 1.5v13a1.5 1.5 0 0 1-1.5 1.5H14M10 8l-4 4 4 4M6 12h10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  ),
  close: svg('<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>'),
  heart: svg(
    '<path d="M12 20.2s-7.6-4.6-7.6-10.3A4.3 4.3 0 0 1 12 7.4a4.3 4.3 0 0 1 7.6 2.5c0 5.7-7.6 10.3-7.6 10.3z" fill="currentColor"/>',
  ),
  wrench: svg(
    '<path d="M14.6 3.4a5 5 0 0 0-5.3 6.6l-6 6a2 2 0 0 0 2.8 2.8l6-6a5 5 0 0 0 6.6-5.3l-3 3-2.8-.4-.4-2.8z" fill="currentColor"/>',
  ),
  /** Phone outline for the rotate card. */
  phone: svg(
    '<rect x="7" y="2.5" width="10" height="19" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M10.5 5h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  ),
  /** iOS share glyph (box with an up arrow). */
  share: svg(
    '<path d="M8.5 9H6.8A1.3 1.3 0 0 0 5.5 10.3v8.4A1.3 1.3 0 0 0 6.8 20h10.4a1.3 1.3 0 0 0 1.3-1.3v-8.4A1.3 1.3 0 0 0 17.2 9h-1.7M12 14V3.5M8.5 6.8 12 3.3l3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  ),
  plusSquare: svg(
    '<rect x="4" y="4" width="16" height="16" rx="3.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 8.5v7M8.5 12h7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  ),
  chevron: svg('<path d="M4 18 12 6l8 12-8-4z" fill="currentColor"/>'),
} as const;

export type IconName = keyof typeof ICONS;

/** A <span class="icon"> holding the named icon. */
export function icon(name: IconName, className = ''): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = `icon${className ? ` ${className}` : ''}`;
  s.innerHTML = ICONS[name];
  return s;
}

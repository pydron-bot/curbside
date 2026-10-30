import type { Heat } from '../game/heat';
import { SPOT_RADIUS } from '../systems/helicopter';
import type { Rect } from '../world/city';
import type { SprayShop } from '../world/landmarks';
import type { ContactShadows } from './contactShadows';
import { GLOW, type GlowSprites } from './glowSprites';
import { worldUniforms } from './shaderLib';

/** Colours (linear) for the spray bay's light gate: hot pink and cyan. */
const PINK = [1.0, 0.12, 0.45] as const;
const CYAN = [0.1, 0.75, 1.0] as const;
/** The station's marker: police blue. */
const BLUE = [0.2, 0.42, 1.0] as const;
/** Paint flashes cycling over a car in the bay while it's sprayed. */
const MIST = [
  [1.0, 0.15, 0.4],
  [0.1, 0.8, 1.0],
  [1.0, 0.8, 0.1],
  [0.4, 1.0, 0.3],
] as const;

/**
 * What the police add to the picture, all as faked light and shadow in the
 * shared batches (no draw calls of their own, no real lights): the
 * helicopter's shadow sliding over the streets with its searchlight pool,
 * the Pay 'n' Spray bays' light gates (brighter while wanted, a paint mist
 * while spraying) and a blue marker at the police station door.
 * Registered once as a glow source; reads Heat each frame.
 */
export function addHeatLook(look: { addGlowSource(fn: (g: GlowSprites, view: Rect) => void): () => void; contactShadows: ContactShadows }, heat: Heat): () => void {
  const shadows = look.contactShadows;
  return look.addGlowSource((glows, view) => {
    const t = worldUniforms.uTime.value;
    const night = worldUniforms.uNight.value;
    drawHeli(glows, shadows, heat, view, t, night);
    const wanted = heat.wanted.level > 0;
    for (const shop of heat.shops) {
      if (!near(shop.x, shop.z, view, 14)) continue;
      drawBay(glows, shop, t, night, wanted, shop === heat.shop ? heat.sprayProgress : 0);
    }
    const st = heat.station;
    if (near(st.x, st.z, view, 8)) drawStation(glows, st.x, st.z, t, night);
  });
}

function near(x: number, z: number, view: Rect, margin: number): boolean {
  return x > view.minX - margin && x < view.maxX + margin && z > view.minZ - margin && z < view.maxZ + margin;
}

/** The helicopter: its shadow (body, tail boom, a flickering rotor disc) and the searchlight on the ground. */
function drawHeli(glows: GlowSprites, shadows: ContactShadows, heat: Heat, view: Rect, t: number, night: number): void {
  const h = heat.police.heli;
  if (!h.active) return;
  if (near(h.x, h.z, view, 12)) {
    const fx = Math.sin(h.heading);
    const fz = Math.cos(h.heading);
    shadows.add(h.x, h.z, h.heading, 0.95, 2.4, 0.9, 0.42);
    shadows.add(h.x - fx * 4.4, h.z - fz * 4.4, h.heading, 0.28, 2.3, 0.5, 0.32);
    // Blades blur into a disc that flickers at the blade rate.
    const flicker = 0.13 + 0.05 * Math.sin(t * 107);
    shadows.add(h.x, h.z, t * 9, 5.2, 5.2, 1.4, flicker);
  }
  if (!near(h.spotX, h.spotZ, view, SPOT_RADIUS * 1.5)) return;
  // Brighter at night, but a hot pool even by day.
  const k = (0.32 + 0.75 * night) * (0.93 + 0.07 * Math.sin(t * 13));
  const size = SPOT_RADIUS * 2.3;
  glows.addFlat(h.spotX, 0.09, h.spotZ, 0, size, size, 0.85 * k, 0.9 * k, 1.0 * k, GLOW.disc);
  glows.addFlat(h.spotX, 0.1, h.spotZ, 0, size * 0.55, size * 0.55, 0.6 * k, 0.65 * k, 0.7 * k, GLOW.disc);
  glows.addFlat(h.spotX, 0.11, h.spotZ, t * 0.7, size * 0.95, size * 0.95, 0.35 * k, 0.4 * k, 0.5 * k, GLOW.ring);
  if (night > 0.2) {
    // The beam itself, standing in the haze.
    const b = 0.22 * night;
    glows.addUpright(h.spotX, 0, h.spotZ, 0.6, SPOT_RADIUS * 1.2, 14, 0.7 * b, 0.75 * b, 0.85 * b, GLOW.beam);
  }
}

/** A Pay 'n' Spray bay: a glowing outline, chevrons leading in, light posts at the mouth. */
function drawBay(glows: GlowSprites, s: SprayShop, t: number, night: number, wanted: boolean, spray: number): void {
  const fx = Math.sin(s.heading);
  const fz = Math.cos(s.heading);
  // Across the bay (perpendicular to the way in).
  const ax = fz;
  const az = -fx;
  const pulse = 0.5 + 0.5 * Math.sin(t * (wanted ? 6 : 2.5));
  const base = (0.35 + 0.45 * night) * (wanted ? 1.35 : 1);
  const k = base * (0.7 + 0.3 * pulse);
  const [pr, pg, pb] = PINK;
  const [cr, cg, cb] = CYAN;
  const hl = s.halfLength;
  const hw = s.halfWidth;
  // Sides (along the way in) in pink, the back wall in cyan.
  for (let side = -1; side <= 1; side += 2) {
    glows.addFlat(s.x + ax * hw * side, 0.06, s.z + az * hw * side, s.heading, 0.35, hl * 2, pr * k, pg * k, pb * k, GLOW.bar);
  }
  glows.addFlat(s.x + fx * hl, 0.06, s.z + fz * hl, s.heading + Math.PI / 2, 0.35, hw * 2, cr * k, cg * k, cb * k, GLOW.bar);
  // A soft floor wash.
  glows.addFlat(s.x, 0.05, s.z, s.heading, hw * 2.4, hl * 2.4, pr * k * 0.18, pg * k * 0.18, pb * k * 0.25, GLOW.disc);
  // Chevrons marching in from the mouth.
  for (let i = 0; i < 3; i++) {
    const phase = (t * 1.2 + i / 3) % 1;
    const along = -hl - 2 + phase * (hl * 1.3);
    const a = Math.sin(phase * Math.PI) * k;
    glows.addFlat(s.x + fx * along, 0.07, s.z + fz * along, s.heading, 1.6, 1.1, cr * a, cg * a, cb * a, GLOW.chevron);
  }
  // Light posts either side of the mouth.
  for (let side = -1; side <= 1; side += 2) {
    const px = s.x - fx * hl + ax * (hw + 0.3) * side;
    const pz = s.z - fz * hl + az * (hw + 0.3) * side;
    glows.addUpright(px, 0, pz, s.heading, 0.8, 4.2, pr * k * 0.8, pg * k * 0.8, pb * k * 0.8, GLOW.beam);
    glows.addFlat(px, 0.07, pz, 0, 1.6, 1.6, pr * k, pg * k, pb * k, GLOW.disc);
  }
  if (spray > 0 && spray < 1) {
    // Paint mist: colours cycling over the car.
    const c = MIST[Math.floor(t * 8) % MIST.length];
    const m = 0.9 + 0.4 * Math.sin(t * 31);
    glows.addFlat(s.x, 1.4, s.z, t * 2, 6, 6, c[0] * m, c[1] * m, c[2] * m, GLOW.disc);
    glows.addFlat(s.x + Math.sin(t * 5) * 1.2, 0.08, s.z + Math.cos(t * 4) * 1.2, 0, 8, 8, c[0] * 0.4, c[1] * 0.4, c[2] * 0.4, GLOW.disc);
  }
}

/** The police station door: a blue ring with a slow pulse and a lamp either side. */
function drawStation(glows: GlowSprites, x: number, z: number, t: number, night: number): void {
  const k = (0.35 + 0.5 * night) * (0.75 + 0.25 * Math.sin(t * 2));
  const [r, g, b] = BLUE;
  glows.addFlat(x, 0.05, z, t * 0.4, 3.6, 3.6, r * k, g * k, b * k, GLOW.ring);
  glows.addFlat(x, 0.04, z, 0, 4.5, 4.5, r * k * 0.3, g * k * 0.3, b * k * 0.3, GLOW.disc);
  for (let side = -1; side <= 1; side += 2) {
    glows.addUpright(x + side * 2.6, 0, z - 0.6, 0, 0.6, 3, r * k * 0.7, g * k * 0.7, b * k * 0.7, GLOW.beam);
  }
}

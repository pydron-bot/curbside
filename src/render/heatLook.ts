import type { Scene } from 'three';
import type { VehicleState } from '../entities/vehicle';
import type { Heat } from '../game/heat';
import { SPOT_RADIUS } from '../systems/helicopter';
import type { PoliceUnit } from '../systems/police';
import type { Rect } from '../world/city';
import type { SprayShop } from '../world/landmarks';
import type { ContactShadows } from './contactShadows';
import { GLOW, type GlowSprites } from './glowSprites';
import { HeliModel } from './heliModel';
import { worldUniforms } from './shaderLib';
import type { WorldProps } from './worldProps';

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

/** What the heat look needs beyond the look itself (all optional: without them, glows and shadows only). */
export interface HeatLookExtras {
  /** For the helicopter model. */
  scene?: Scene;
  /** The camera's position: the helicopter flies under it, over its shadow on screen. */
  camera?: () => { x: number; y: number; z: number };
  /** The player's car: it scatters roadblock barriers and cones. */
  playerCar?: () => VehicleState | null;
  /** Throw a copy of a knocked prop (render/knockFx.ts). */
  knock?: (kind: string, x: number, z: number, vx: number, vz: number) => void;
}

/** Roadblock dressing per car: a barrier beyond its nose, two cones off its tail (car frame: across, along). */
const DRESSING: ReadonlyArray<readonly [kind: string, along: number, across: number, reach: number]> = [
  ['barrier', 3.6, 0, 1.4],
  ['traffic_cone', -3.4, 0.9, 0.5],
  ['traffic_cone', -3.4, -0.9, 0.5],
];

/**
 * What the police add to the picture: the helicopter (heli.glb, rotors
 * spinning, one draw call) with its shadow sliding over the streets and its
 * searchlight pool, the Pay 'n' Spray bays' light gates (brighter while
 * wanted, a paint mist while spraying), a blue marker at the police station
 * door, and roadblocks dressed with a sawhorse barrier and cones per car
 * (world props' things: no draw call of their own; the player's car sends
 * them flying). The rest is faked light and shadow in the shared batches,
 * no real lights. Registered once as a glow source; reads Heat each frame.
 */
export function addHeatLook(
  look: { addGlowSource(fn: (g: GlowSprites, view: Rect) => void): () => void; contactShadows: ContactShadows; props?: WorldProps },
  heat: Heat,
  extras: HeatLookExtras = {},
): () => void {
  const shadows = look.contactShadows;
  const heli = extras.scene ? new HeliModel() : null;
  if (heli) extras.scene!.add(heli.root);
  const knocked = new Map<number, number>();
  let last = -1;
  return look.addGlowSource((glows, view) => {
    const t = worldUniforms.uTime.value;
    const night = worldUniforms.uNight.value;
    const dt = last < 0 ? 0 : Math.min(0.1, Math.max(0, t - last));
    last = t;
    const cam = extras.camera?.();
    heli?.update(heat.police.heli, dt, cam?.x ?? heat.police.heli.x, cam?.y ?? 40, cam?.z ?? heat.police.heli.z);
    drawHeli(glows, shadows, heat, view, t, night);
    if (look.props?.loaded) drawRoadblocks(look.props, heat.police.units, view, knocked, extras);
    const wanted = heat.wanted.level > 0;
    for (const shop of heat.shops) {
      if (!near(shop.x, shop.z, view, 14)) continue;
      drawBay(glows, shadows, shop, t, night, wanted, shop === heat.shop ? heat.sprayProgress : 0);
    }
    const st = heat.station;
    if (near(st.x, st.z, view, 8)) drawStation(glows, st.x, st.z, t, night);
  });
}

/**
 * Barriers and cones round each roadblock car (for as long as its unit
 * stands); the player's car knocks them flying (once each, per unit).
 */
function drawRoadblocks(props: WorldProps, units: readonly PoliceUnit[], view: Rect, knocked: Map<number, number>, extras: HeatLookExtras): void {
  const car = extras.playerCar?.() ?? null;
  const fast = car !== null && Math.hypot(car.vx, car.vz) > 4;
  for (const u of units) {
    const v = u.vehicle;
    if (u.role !== 'roadblock' || !v) {
      knocked.delete(u.id);
      continue;
    }
    const s = v.sim;
    if (!near(s.x, s.z, view, 10)) continue;
    const fx = Math.sin(s.heading);
    const fz = Math.cos(s.heading);
    let mask = knocked.get(u.id) ?? 0;
    for (let i = 0; i < DRESSING.length; i++) {
      if (mask & (1 << i)) continue;
      const [kind, along, across, reach] = DRESSING[i];
      const x = s.x + fx * along + fz * across;
      const z = s.z + fz * along - fx * across;
      if (fast && Math.abs(car!.x - x) < reach + 1 && Math.abs(car!.z - z) < reach + 1 && Math.hypot(car!.x - x, car!.z - z) < reach + 1) {
        mask |= 1 << i;
        extras.knock?.(kind, x, z, car!.vx, car!.vz);
        continue;
      }
      // The barrier runs across the road (along the car's length), the cones stand.
      props.things.add(kind, x, 0, z, s.heading + Math.PI / 2);
    }
    knocked.set(u.id, mask);
  }
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
  // Brighter at night, but a pool you can see by day; never so hot that it
  // bleaches the cars it lights (it's added to everything under it).
  const k = (0.26 + 0.34 * night) * (0.93 + 0.07 * Math.sin(t * 13));
  const size = SPOT_RADIUS * 2.3;
  glows.addFlat(h.spotX, 0.09, h.spotZ, 0, size, size, 0.8 * k, 0.86 * k, 1.0 * k, GLOW.disc);
  glows.addFlat(h.spotX, 0.1, h.spotZ, 0, size * 0.5, size * 0.5, 0.3 * k, 0.32 * k, 0.36 * k, GLOW.disc);
  // A crisp rim: the edge of the beam.
  glows.addFlat(h.spotX, 0.11, h.spotZ, t * 0.7, size * 0.95, size * 0.95, 0.6 * k, 0.65 * k, 0.8 * k, GLOW.ring);
  if (night > 0.2) {
    // The beam itself, standing in the haze.
    const b = 0.22 * night;
    glows.addUpright(h.spotX, 0, h.spotZ, 0.6, SPOT_RADIUS * 1.2, 14, 0.7 * b, 0.75 * b, 0.85 * b, GLOW.beam);
  }
}

/**
 * A Pay 'n' Spray bay: a dark pad (so it reads by day, when additive light
 * barely shows on grass or paving), a glowing outline, chevrons leading in,
 * light posts at the mouth.
 */
function drawBay(glows: GlowSprites, shadows: ContactShadows, s: SprayShop, t: number, night: number, wanted: boolean, spray: number): void {
  const fx = Math.sin(s.heading);
  const fz = Math.cos(s.heading);
  // Across the bay (perpendicular to the way in).
  const ax = fz;
  const az = -fx;
  const pulse = 0.5 + 0.5 * Math.sin(t * (wanted ? 6 : 2.5));
  const base = (0.5 + 0.3 * night) * (wanted ? 1.35 : 1);
  shadows.add(s.x, s.z, s.heading, s.halfWidth + 0.3, s.halfLength + 0.3, 0.4, 0.42 - 0.17 * night);
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
    const m = 0.35 + 0.15 * Math.sin(t * 31);
    glows.addFlat(s.x, 1.4, s.z, t * 2, 5, 5, c[0] * m, c[1] * m, c[2] * m, GLOW.disc);
    glows.addFlat(s.x + Math.sin(t * 5) * 1.2, 0.08, s.z + Math.cos(t * 4) * 1.2, 0, 7, 7, c[0] * 0.2, c[1] * 0.2, c[2] * 0.2, GLOW.disc);
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

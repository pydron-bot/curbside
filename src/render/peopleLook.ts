/**
 * The people scenes' look (game/scenes/: buskers, muggings, witnesses),
 * one CityLifeLook part: a coin flicked into a busker's hat glints in the
 * air; a mugger on the run is ringed in red, and a dropped bag pulses
 * amber with a little brown bag in it; a witness's phone screen glows in
 * their raised hand. All of it is quads in the shared glow batch: no
 * mesh, no draw call, nothing allocated per frame.
 */
import type { CityLife } from '../game/cityLife';
import { Buskers, TIP_FLIGHT } from '../game/scenes/buskers';
import { Muggings } from '../game/scenes/muggings';
import type { Witnesses } from '../game/scenes/witnesses';
import type { Rect } from '../world/city';
import { near, type CityLookPart } from './cityLifeLook';
import { peopleDraw } from './characterModel';
import { GLOW, type GlowSprites } from './glowSprites';
import { worldUniforms } from './shaderLib';

/** The phone is held this far in front and to the right of the body, this high, m. */
const PHONE_AHEAD = 0.42;
const PHONE_RIGHT = 0.16;
const PHONE_Y = 1.32;

export function peopleLook(life: CityLife): CityLookPart {
  const buskers = life.scenes.find((s): s is Buskers => s instanceof Buskers) ?? null;
  const muggings = life.scenes.find((s): s is Muggings => s instanceof Muggings) ?? null;
  const witnesses: Witnesses = life.witnesses;
  let time = 0;
  return {
    update(dt: number) {
      time += dt;
    },
    draw(glows: GlowSprites, view: Rect) {
      const night = worldUniforms.uNight.value;
      // Coins in the air: a small arc from the tipper's hand to the hat.
      if (buskers) {
        for (const t of buskers.tips) {
          if (t.age >= TIP_FLIGHT || !near(view, t.toX, t.toZ, 3)) continue;
          const k = t.age / TIP_FLIGHT;
          const x = t.fromX + (t.toX - t.fromX) * k;
          const z = t.fromZ + (t.toZ - t.fromZ) * k;
          const y = 1.1 + 1.2 * k * (1 - k) - 1 * k;
          const g = 1.6 + 0.8 * Math.sin(time * 40);
          glows.addFlat(x, Math.max(0.1, y), z, time * 9, 0.22, 0.22, 1.8 * g, 1.4 * g, 0.4 * g, GLOW.disc);
        }
      }
      if (muggings) {
        // The mugger: a red ring at their feet while they run.
        const pulse = 0.5 + 0.5 * Math.sin(time * 7);
        for (const m of muggings.muggings) {
          if (m.phase !== 'run' || m.mugger.agent.mode === 'down' || !life.present(m.mugger)) continue;
          const p = m.mugger.model.root.position;
          if (!near(view, p.x, p.z, 2)) continue;
          const r = 1.3 + 0.25 * pulse;
          glows.addFlat(p.x, 0.06, p.z, time, r, r, 3 + pulse, 0.25, 0.15, GLOW.ring);
        }
        // A dropped bag: a pulsing amber ring round a little brown bag.
        for (const b of muggings.bags) {
          if (b.until === 0 || !near(view, b.x, b.z, 2)) continue;
          const r = 1.2 + 0.3 * pulse;
          glows.addFlat(b.x, 0.05, b.z, time, r, r, 1.1 + 0.5 * pulse, 0.75, 0.2, GLOW.ring);
          glows.addFlat(b.x, 0.12, b.z, 0.6, 0.35, 0.45, 0.45, 0.24, 0.1, GLOW.disc);
        }
      }
      // Phone screens in the raised hand: cool white, brighter at night.
      const lit = 1 + 0.8 * night;
      for (const ph of witnesses.phones) {
        const m = ph.ped.model;
        if (!m.root.visible || ph.ped.agent.mode === 'down') continue;
        const p = m.root.position;
        if (!near(view, p.x, p.z, 2)) continue;
        const h = m.root.rotation.y;
        // People are drawn larger than life: the hand is higher and further out.
        const k = peopleDraw.scale;
        const fx = Math.sin(h);
        const fz = Math.cos(h);
        // Right of heading h is (-cos h, sin h).
        const x = p.x + (fx * PHONE_AHEAD - fz * PHONE_RIGHT) * k;
        const z = p.z + (fz * PHONE_AHEAD + fx * PHONE_RIGHT) * k;
        const blink = ph.role === 'film' && Math.sin(time * 6) > 0.6 ? 1.6 : 1;
        // A touch larger than life, so it reads from the camera's height.
        glows.addFlat(x, PHONE_Y * k, z, h, 0.24, 0.38, 1.3 * lit, 1.6 * lit, 2.2 * lit * blink, GLOW.bar);
        glows.addFlat(x, PHONE_Y * k - 0.02, z, h, 0.9, 0.9, 0.25 * lit, 0.32 * lit, 0.5 * lit, GLOW.disc);
      }
    },
  };
}

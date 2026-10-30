import type { GameAudio } from '../audio/gameAudio';
import type { SirenStyle } from '../audio/loops';
import type { EventBus } from '../core/events';
import type { PoliceUnit } from '../systems/police';
import { evadeBonus } from '../systems/score';
import type { BlipOptions, Radar } from '../ui/radar';
import type { ScoreHud } from '../ui/scoreHud';
import { createWantedFrame, type WantedHud } from '../ui/wantedHud';
import type { Heat } from './heat';

/** Sirens actually voiced (the nearest); the audio engine allows 8 in all. */
const MAX_SIRENS = 5;
/** Sirens further than this aren't worth a voice, m. */
const SIREN_RANGE = 170;
/** Officer blips on the radar at most. */
const MAX_OFFICER_BLIPS = 12;
const RED = '#ff3b4f';
const BLUE = '#4f8bff';

/**
 * Presents the heat each frame: siren voices for the nearest police cars
 * (wail far off, yelp when ramming, two-tone when boxing in), the
 * helicopter's rotor, flashing police blips and the helicopter on the
 * radar, Pay 'n' Spray and station blips (the nearest bay points the way
 * while you're wanted), the wanted HUD, and feed lines for evading and
 * resprays. Nothing here changes the simulation.
 */
export class HeatPresenter {
  private readonly frame = createWantedFrame();
  /** Blip id → the frame it was last set (stale ones are removed). */
  private readonly shown = new Map<string, number>();
  private readonly officerIds = Array.from({ length: MAX_OFFICER_BLIPS }, (_, i) => `officer-${i}`);
  private readonly blip: BlipOptions = { x: 0, z: 0, kind: 'police', colour: BLUE, size: 4.5, pulse: false, edgeArrow: false, icon: '' };
  private readonly near: PoliceUnit[] = [];
  private readonly nearD: number[] = [];
  private stamp = 0;
  private time = 0;
  private wantedBefore = 0;

  constructor(
    private readonly heat: Heat,
    private readonly audio: GameAudio,
    private readonly radar: Radar,
    private readonly hud: WantedHud,
    feed: ScoreHud,
    bus: EventBus,
  ) {
    for (const s of heat.shops) radar.setBlip(s.id, { x: s.x, z: s.z, kind: 'shop', icon: 'S', size: 6 });
    radar.setBlip('station', { x: heat.station.x, z: heat.station.z, kind: 'police', icon: '★', size: 6 });
    bus.on('wanted', (e) => {
      // Shaking off 1-2 stars: a line in the feed (3+ pays the EVADED bonus, which has its own).
      if (e.reason === 'evaded' && evadeBonus(heat.wanted.peak) === 0) feed.notice('EVADED', 'evaded');
    });
    bus.on('respray', (e) => feed.notice(e.cleared ? 'RESPRAYED · CLEAN' : 'RESPRAYED', 'police'));
  }

  /** Per frame (not while paused). (x, z): the listener / camera focus. */
  update(dt: number, x: number, z: number, playing: boolean): void {
    this.time += dt;
    this.stamp++;
    const heat = this.heat;
    const police = heat.police;
    this.voiceSirens(x, z);
    const h = police.heli;
    if (h.active) this.audio.rotor(h.x, h.z, true);

    if (playing) {
      // Police cars: flashing red/blue.
      const flash = Math.floor(this.time * 4) % 2 === 0 ? RED : BLUE;
      const b = this.blip;
      b.kind = 'police';
      b.icon = '';
      b.pulse = false;
      for (const u of police.units) {
        const v = u.vehicle;
        if (!v || u.dismissed) continue;
        b.x = v.sim.x;
        b.z = v.sim.z;
        b.colour = flash;
        b.size = u.kind === 'swat' ? 5.5 : 4.5;
        b.edgeArrow = false;
        this.set(u.label, b);
      }
      // Officers on foot: small blue dots.
      let n = 0;
      b.size = 3;
      b.colour = BLUE;
      for (const u of police.units) for (const p of u.officers) if (n < MAX_OFFICER_BLIPS) this.officer(n++, p.agent.s.x, p.agent.s.z);
      for (const p of police.strays) if (n < MAX_OFFICER_BLIPS) this.officer(n++, p.agent.s.x, p.agent.s.z);
      if (h.active && !h.leaving) {
        b.x = h.x;
        b.z = h.z;
        b.colour = '#ffffff';
        b.icon = 'H';
        b.size = 6;
        b.pulse = true;
        b.edgeArrow = true;
        this.set('heli', b);
      }
    }
    // Drop blips for units and officers that are gone.
    this.shown.forEach(this.dropStale);
    this.updateShopBlips(x, z);

    const f = this.frame;
    f.level = heat.wanted.level;
    f.searching = heat.wanted.searching;
    f.arrest = heat.bust.progress;
    f.spray = heat.shop ? heat.sprayProgress : 0;
    this.hud.update(dt, f);
  }

  private officer(i: number, x: number, z: number): void {
    const b = this.blip;
    b.x = x;
    b.z = z;
    b.icon = '';
    b.pulse = false;
    b.edgeArrow = false;
    b.size = 3;
    b.colour = BLUE;
    this.set(this.officerIds[i], b);
  }

  private set(id: string, b: BlipOptions): void {
    this.radar.setBlip(id, b);
    this.shown.set(id, this.stamp);
  }

  private readonly dropStale = (at: number, id: string): void => {
    if (at === this.stamp) return;
    this.radar.removeBlip(id);
    this.shown.delete(id);
  };

  /** While wanted, the nearest bay pulses and points the way from the radar's rim. */
  private updateShopBlips(x: number, z: number): void {
    const wanted = this.heat.wanted.level;
    if (wanted === this.wantedBefore && this.stamp % 30 !== 0) return;
    this.wantedBefore = wanted;
    let nearest = -1;
    let best = Infinity;
    const shops = this.heat.shops;
    for (let i = 0; i < shops.length; i++) {
      const d = Math.hypot(shops[i].x - x, shops[i].z - z);
      if (d < best) {
        best = d;
        nearest = i;
      }
    }
    for (let i = 0; i < shops.length; i++) {
      const lead = wanted > 0 && i === nearest;
      this.radar.setBlip(shops[i].id, { x: shops[i].x, z: shops[i].z, pulse: lead, edgeArrow: lead });
    }
  }

  /** A siren for each of the nearest police cars on duty, in a style that fits what it's doing. */
  private voiceSirens(x: number, z: number): void {
    const near = this.near;
    const nearD = this.nearD;
    near.length = 0;
    nearD.length = 0;
    for (const u of this.heat.police.units) {
      const v = u.vehicle;
      if (!v || u.dismissed) continue;
      const d = Math.hypot(v.sim.x - x, v.sim.z - z);
      if (d > SIREN_RANGE) continue;
      // Insertion into a short sorted list (no allocation).
      let i = near.length;
      if (i >= MAX_SIRENS && d >= nearD[MAX_SIRENS - 1]) continue;
      if (i >= MAX_SIRENS) i = MAX_SIRENS - 1;
      else {
        near.push(u);
        nearD.push(d);
      }
      while (i > 0 && nearD[i - 1] > d) {
        near[i] = near[i - 1];
        nearD[i] = nearD[i - 1];
        i--;
      }
      near[i] = u;
      nearD[i] = d;
    }
    for (let i = 0; i < near.length; i++) {
      const u = near[i];
      const v = u.vehicle!;
      this.audio.siren(u.id, v.sim.x, v.sim.z, true, sirenStyle(u, nearD[i]));
    }
  }
}

function sirenStyle(u: PoliceUnit, d: number): SirenStyle {
  if (u.kind === 'swat' || u.role === 'roadblock' || u.driver.mode === 'box') return 'twoTone';
  if (u.driver.mode === 'ram' || u.driver.mode === 'pit' || d < 30) return 'yelp';
  return 'wail';
}

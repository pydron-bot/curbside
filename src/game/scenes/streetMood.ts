/**
 * The street's mood by the weather and the hour (game/cityMood.ts has the
 * numbers; crowd upkeep thins and shifts the crowd itself):
 *
 *  - Rain: walkers hurry (rainPace), some put up an umbrella (drawn in the
 *    props' `things` family: render/atmosphereLook.ts), and some of the
 *    rest duck in under the nearest shop awning on their pavement and wait
 *    there, looking out at the road, until it stops.
 *  - Night: little groups hang about under the neon of the bars and shops
 *    (most in the Neon Mile, some in the old town), put there out of view,
 *    more the later it gets; at dawn they drift off as ordinary passers-by.
 *
 * Ambient, so nothing holds it off (the title's city has weather too).
 * Allocation only when someone is borrowed or a group is put down.
 */
import { NIGHTLIFE, rainPace } from '../cityMood';
import type { PedAgent } from '../../systems/crowd';
import type { CrowdPed } from '../population';
import type { Scene, SceneCtx } from '../cityLife';
import { labelMembers, type LabelSink } from '../debugLabels';
import { SpotGrid, inFrontOf, shopSpots, type ShopSpot } from '../../world/shopSpots';
import { len2 } from '../../core/len';

/** Rain above this hurries walkers and opens umbrellas; above SHELTER_RAIN people take cover; below DRY it's over. */
const HURRY_RAIN = 0.15;
const SHELTER_RAIN = 0.3;
const DRY = 0.12;
/** Share of walkers with an umbrella, and how many colours they come in (render/atmosphereLook.ts). */
export const UMBRELLA_SHARE = 0.4;
export const UMBRELLA_COLOURS = 6;
/** Most people sheltering at once, and how far from the player they're picked, m. */
export const MAX_SHELTER = 10;
const SHELTER_RANGE = 60;
/** A walker this close along their pavement to a free awning ducks under it, m. */
const SHELTER_REACH = 16;
/** People under one awning, standing this far apart, m. */
const PER_AWNING = 2;
const SHELTER_GAP = 0.8;
/** Groups under the neon at full nightlife, people in each, and how long they stay, s. */
export const MAX_LOITER_GROUPS = 4;
const GROUP = [2, 3] as const;
const LOITER_STAY = [40, 90] as const;
/** Groups are put down this far from the player (out of view), m. */
const LOITER_RING = [24, 70] as const;
/** Nightlife below this sends the groups home. */
const LOITER_MIN = 0.3;

interface Shelterer {
  ped: CrowdPed;
  spot: number;
  /** -1 / 1: which side of the awning's middle. */
  slot: number;
  arrived: boolean;
  /** Seconds left before they step out (counting once it's dry); Infinity while it rains. */
  leaveIn: number;
}

interface LoiterGroup {
  spot: number;
  peds: CrowdPed[];
  /** Sim time they wander off. */
  until: number;
}

export class StreetMood implements Scene {
  readonly spots: readonly ShopSpot[];
  readonly grid: SpotGrid;
  readonly shelterers: Shelterer[] = [];
  readonly groups: LoiterGroup[] = [];
  /** Walkers with an umbrella up now, and its colour (0..UMBRELLA_COLOURS-1), by index (refreshed twice a second). */
  readonly umbrellas: CrowdPed[] = [];
  readonly umbrellaColour: number[] = [];
  /** People under each awning (shelter) or a group there (loiter). */
  private readonly taken: Uint8Array;
  /** Each walker's own pace (while the rain hurries them) and umbrella (-1: none), by agent. */
  private readonly pace = new WeakMap<PedAgent, number>();
  private readonly brolly = new WeakMap<PedAgent, number>();
  private scan = 0;
  // Spot filters for the grid (bound once).
  private seekX = 0;
  private seekZ = 0;
  private readonly freeAwning = (i: number) => this.taken[i] < PER_AWNING && inFrontOf(this.spots[i], this.seekX, this.seekZ, SHELTER_REACH);
  private readonly freeNeon = (i: number) => {
    const s = this.spots[i];
    if (!s.neon || this.taken[i] > 0 || this.life.inView(s.x, s.z, 4)) return false;
    const d = this.life.distance(s.x, s.z);
    return d > LOITER_RING[0] && d < LOITER_RING[1];
  };

  constructor(private readonly life: SceneCtx) {
    this.spots = shopSpots(life.d.city);
    this.grid = new SpotGrid(this.spots);
    this.taken = new Uint8Array(this.spots.length);
    life.clock.define('shelter', { every: [0.3, 0.8], cap: MAX_SHELTER, first: 1 });
    life.clock.define('loiter', { every: [4, 9], cap: MAX_LOITER_GROUPS, first: 4 });
  }

  get running(): number {
    return this.shelterers.length + this.groups.length;
  }

  step(dt: number): void {
    const mood = this.life.d.mood;
    if (!mood) return;
    for (const s of this.shelterers) s.leaveIn -= dt;
    if ((this.scan -= dt) > 0) return;
    this.scan = 0.5;
    this.weather(mood.rain);
    this.shelter(mood.rain);
    this.loiter(mood.nightlife);
  }

  reset(): void {
    // The director takes the people off itself (they're on its list).
    this.shelterers.length = 0;
    this.groups.length = 0;
    this.umbrellas.length = 0;
    this.umbrellaColour.length = 0;
    this.taken.fill(0);
  }

  describe(out: LabelSink): void {
    for (const s of this.shelterers) out.ped(s.ped, 'SHELTERING', 'people');
    for (const g of this.groups) labelMembers(out, g.peds, 'HANGING OUT', false);
  }

  /** Walkers hurry and put umbrellas up in the rain, slow down again when it stops. */
  private weather(rain: number): void {
    const rand = this.life.d.rand;
    const wet = rain > HURRY_RAIN;
    this.umbrellas.length = 0;
    this.umbrellaColour.length = 0;
    for (const c of this.life.d.population.crowd) {
      const a = c.agent;
      const own = this.pace.get(a);
      if (!wet || !a.street || a.scene) {
        if (own !== undefined) {
          a.pace = own;
          this.pace.delete(a);
        }
        continue;
      }
      if (own === undefined) this.pace.set(a, a.pace);
      a.pace = rainPace(own ?? a.pace, rain);
      let b = this.brolly.get(a);
      if (b === undefined) {
        b = rand() < UMBRELLA_SHARE ? Math.floor(rand() * UMBRELLA_COLOURS) : -1;
        this.brolly.set(a, b);
      }
      if (b >= 0 && a.mode !== 'down') {
        this.umbrellas.push(c);
        this.umbrellaColour.push(b);
      }
    }
  }

  /** In the rain, walkers without an umbrella duck in under an awning on their pavement; out again once it's dry. */
  private shelter(rain: number): void {
    const life = this.life;
    for (let i = this.shelterers.length - 1; i >= 0; i--) {
      const s = this.shelterers[i];
      const c = s.ped;
      const a = c.agent;
      // Gone, knocked over, scared off (a flee ends in a walk), or taken by another scene.
      const lost = !life.present(c) || !a.scene || (a.mode !== 'arrest' && a.mode !== 'walk');
      // Dry again: out from under it, each on their own beat (back under if it starts again).
      if (rain >= DRY) s.leaveIn = Infinity;
      else if (s.leaveIn === Infinity) s.leaveIn = 0.5 + life.d.rand() * 5;
      if (lost || a.mode === 'walk' || s.leaveIn <= 0) {
        this.endShelter(i, lost);
        continue;
      }
      if (s.arrived) continue;
      const sp = this.spots[s.spot];
      const gx = sp.x + sp.alongX * s.slot * SHELTER_GAP;
      const gz = sp.z + sp.alongZ * s.slot * SHELTER_GAP;
      if (len2(a.s.x - gx, a.s.z - gz) < 0.7) {
        s.arrived = true;
        life.lookAt(c, sp.x + sp.outX * 6, sp.z + sp.outZ * 6);
      }
    }
    if (rain < SHELTER_RAIN) return;
    let started = 0;
    for (const c of life.d.population.crowd) {
      if (started >= 2 || !life.due('shelter', this.shelterers.length)) break;
      const a = c.agent;
      if (!a.street || a.scene || a.injured || a.mode !== 'walk' || (this.brolly.get(a) ?? -1) >= 0) continue;
      if (life.distance(a.s.x, a.s.z) > SHELTER_RANGE) continue;
      this.seekX = a.s.x;
      this.seekZ = a.s.z;
      const k = this.grid.nearest(a.s.x, a.s.z, SHELTER_REACH, this.freeAwning);
      if (k < 0) continue;
      const slot = this.taken[k] === 0 ? -1 : 1;
      this.taken[k]++;
      life.borrow(c);
      const sp = this.spots[k];
      life.walkTo(c, sp.x + sp.alongX * slot * SHELTER_GAP, sp.z + sp.alongZ * slot * SHELTER_GAP);
      this.shelterers.push({ ped: c, spot: k, slot, arrived: false, leaveIn: Infinity });
      life.clock.start('shelter', life.now);
      started++;
    }
  }

  private endShelter(i: number, lost: boolean): void {
    const s = this.shelterers[i];
    this.shelterers.splice(i, 1);
    if (this.taken[s.spot] > 0) this.taken[s.spot]--;
    const life = this.life;
    if (!life.present(s.ped)) return;
    if (!lost || s.ped.agent.scene) life.giveBack(s.ped);
  }

  /** At night, groups hang about under the neon (more the later it is); home at dawn or after a while. */
  private loiter(nightlife: number): void {
    const life = this.life;
    const now = life.now;
    for (let i = this.groups.length - 1; i >= 0; i--) {
      const g = this.groups[i];
      for (let j = g.peds.length - 1; j >= 0; j--) {
        const c = g.peds[j];
        if (!life.present(c) || !c.agent.scene || c.agent.mode !== 'arrest') {
          g.peds.splice(j, 1);
          if (life.present(c) && c.agent.scene) life.giveBack(c);
        }
      }
      if (g.peds.length > 0 && nightlife >= LOITER_MIN && now < g.until) continue;
      for (const c of g.peds) life.giveBack(c);
      this.taken[g.spot] = 0;
      this.groups.splice(i, 1);
    }
    if (nightlife < LOITER_MIN) return;
    const want = Math.round(MAX_LOITER_GROUPS * nightlife);
    if (this.groups.length >= want || !life.due('loiter', this.groups.length)) return;
    const rand = life.d.rand;
    const at = life.d.focus();
    const a = rand() * Math.PI * 2;
    const r = LOITER_RING[0] + rand() * (LOITER_RING[1] - LOITER_RING[0]);
    const k = this.grid.nearest(at.x + Math.sin(a) * r, at.z + Math.cos(a) * r, 30, this.freeNeon);
    // The busier the district's nightlife, the likelier a group there.
    if (k < 0 || rand() > Math.max(0.3, NIGHTLIFE[this.spots[k].district])) {
      life.clock.defer('loiter', now, 1);
      return;
    }
    const sp = this.spots[k];
    const n = GROUP[0] + Math.floor(rand() * (GROUP[1] - GROUP[0] + 1));
    // Round a point a little out from the wall, facing in.
    const cx = sp.x + sp.outX * 0.7;
    const cz = sp.z + sp.outZ * 0.7;
    const group: LoiterGroup = { spot: k, peds: [], until: now + LOITER_STAY[0] + rand() * (LOITER_STAY[1] - LOITER_STAY[0]) };
    for (let i = 0; i < n; i++) {
      const along = (i - (n - 1) / 2) * 1.1 + (rand() - 0.5) * 0.3;
      const out = (rand() - 0.5) * 0.8;
      const x = cx + sp.alongX * along + sp.outX * out;
      const z = cz + sp.alongZ * along + sp.outZ * out;
      const c = life.addPed(x, z, Math.atan2(cx - x, cz - z));
      // Ordinary passers-by once they move on.
      c.agent.street = true;
      life.walkTo(c, x, z);
      life.lookAt(c, cx, cz);
      group.peds.push(c);
    }
    this.taken[k] = PER_AWNING;
    this.groups.push(group);
    life.clock.start('loiter', now);
  }
}

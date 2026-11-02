/**
 * Named mayhem: the player's biggest bits of chaos get a stamp across the
 * screen (BARBECUE SEASON for three cars going up in a chain). The table
 * names each stamp and weighs it; StampDetector spots them in the bus
 * events (score awards, explosions, crashes, people knocked down, stars);
 * StampArbiter keeps it to one at a time, at most one every COOLDOWN
 * seconds, and the heavier of two close together wins. game/stamps.ts
 * wires them to the bus; ui/stampHud.ts draws them. Pure, no three.js,
 * tested in tests/stamps.test.ts.
 */
import type { GameEvent } from '../core/events';
import type { VehicleArchetype } from '../entities/vehicle';
import { MAX_COMBO } from './score';

export type StampId =
  | 'barbecueSeason'
  | 'bonfireNight'
  | 'endangeredPandas'
  | 'bankHoliday'
  | 'faresPlease'
  | 'bowledOver'
  | 'lastOrders'
  | 'neighbourhoodWatch'
  | 'healthAndSafety'
  | 'frequentFlyer'
  | 'absoluteScenes'
  | 'bluesAndTwos'
  | 'nothingToSeeHere'
  // Shown by the chase handoff (V2-03) through Stamps.show(); not detected here.
  | 'takeTheHeat'
  | 'citizensArrest'
  | 'haveAGo';

/** Ink: mayhem (hot red), the have-a-go moments (blue), the police (white on blue). */
export type StampTone = 'mayhem' | 'hero' | 'law';

export interface StampDef {
  label: string;
  /** The small line under it: what you did. */
  sub: string;
  /** Bigger wins when two land close together. */
  weight: number;
  tone: StampTone;
}

export const STAMPS: Readonly<Record<StampId, StampDef>> = {
  barbecueSeason: { label: 'BARBECUE SEASON', sub: 'THREE CARS, ONE MATCH', weight: 6, tone: 'mayhem' },
  bonfireNight: { label: 'BONFIRE NIGHT', sub: 'SIX CARS UP IN SMOKE', weight: 9, tone: 'mayhem' },
  endangeredPandas: { label: 'ENDANGERED PANDAS', sub: 'THREE POLICE CARS WRECKED', weight: 7, tone: 'law' },
  bankHoliday: { label: 'BANK HOLIDAY', sub: 'FOUR-CAR PILE-UP', weight: 5, tone: 'mayhem' },
  faresPlease: { label: 'FARES PLEASE', sub: 'BUS THROUGH A CROWD', weight: 6, tone: 'mayhem' },
  bowledOver: { label: 'BOWLED OVER', sub: 'FOUR SKITTLED', weight: 3, tone: 'mayhem' },
  lastOrders: { label: 'LAST ORDERS', sub: 'THREE FLOORED', weight: 3, tone: 'mayhem' },
  neighbourhoodWatch: { label: 'NEIGHBOURHOOD WATCH', sub: 'THREE OF THE CREW DOWN', weight: 4, tone: 'mayhem' },
  healthAndSafety: { label: 'HEALTH AND SAFETY', sub: 'THE FIRE CREW HAD IT HANDLED', weight: 7, tone: 'mayhem' },
  frequentFlyer: { label: 'FREQUENT FLYER', sub: 'BIG AIR', weight: 4, tone: 'mayhem' },
  absoluteScenes: { label: 'ABSOLUTE SCENES', sub: '×10 COMBO', weight: 5, tone: 'mayhem' },
  bluesAndTwos: { label: 'BLUES AND TWOS', sub: 'FIVE STARS', weight: 6, tone: 'law' },
  nothingToSeeHere: { label: 'NOTHING TO SEE HERE', sub: 'SHOOK OFF A BIG CHASE', weight: 5, tone: 'law' },
  takeTheHeat: { label: 'TAKE THE HEAT', sub: 'THEIR COPS ARE YOURS NOW', weight: 8, tone: 'hero' },
  citizensArrest: { label: "CITIZEN'S ARREST", sub: 'THE COPS WAVE YOU THROUGH', weight: 8, tone: 'hero' },
  haveAGo: { label: 'HAVE-A-GO HERO', sub: 'BAG HANDED BACK', weight: 5, tone: 'hero' },
};

export const STAMP_IDS = Object.keys(STAMPS) as StampId[];

/** At most one stamp every this many seconds. */
export const STAMP_COOLDOWN = 4;
/** A heavier stamp this soon after a lighter one replaces it, s. */
export const STAMP_OVERRIDE = 0.6;
/** A stamp waiting out the cooldown is dropped this long after it happened, s: later reads as unrelated. */
export const STAMP_STALE = 1.5;

/** Cars going up within this of the last one are one chain reaction, s (combat.ts fuses are 0.5–1.9 s). */
export const CHAIN_GAP = 2.5;
export const CHAIN_BBQ = 3;
export const CHAIN_BONFIRE = 6;
/** A pile-up: this many car-on-car crashes within PILEUP_SPAN s and PILEUP_RANGE m of one of the player's. */
export const PILEUP_CRASHES = 4;
export const PILEUP_SPAN = 3;
export const PILEUP_RANGE = 30;
/** A crash this hard (closing m/s) counts toward a pile-up. */
export const PILEUP_IMPACT = 6;
/** Police cars wrecked in one pursuit. */
export const PANDAS = 3;
/** A player's blast this close to a fire crew hosing, m. */
export const HOSE_RANGE = 20;
/** A crew hosing is forgotten this long after it started if no fireOut came, s. */
const HOSE_LIFE = 45;
/** A STUNT worth this much (the fx edge flash's "big one"). */
export const FLYER_POINTS = 3500;

/** Fires once when `n` hits land within `span` seconds; re-arms after a gap of more than `span`. */
export class Burst {
  private readonly times: Float64Array;
  private head = 0;
  private size = 0;
  private last = -Infinity;
  private fired = false;

  constructor(
    readonly n: number,
    readonly span: number,
  ) {
    this.times = new Float64Array(n);
  }

  hit(now: number): boolean {
    if (now - this.last > this.span) this.reset();
    this.last = now;
    this.times[this.head] = now;
    this.head = (this.head + 1) % this.n;
    if (this.size < this.n) this.size++;
    if (this.fired || this.size < this.n) return false;
    // Full: head is back on the oldest of the last n.
    if (now - this.times[this.head] > this.span) return false;
    this.fired = true;
    return true;
  }

  reset(): void {
    this.head = this.size = 0;
    this.last = -Infinity;
    this.fired = false;
  }
}

/** Counts links in a chain: each within `gap` seconds of the one before. */
export class Chain {
  count = 0;
  private last = -Infinity;

  constructor(readonly gap: number) {}

  /** One more link at `now`; returns the chain's length. */
  link(now: number): number {
    if (now - this.last > this.gap) this.count = 0;
    this.last = now;
    return ++this.count;
  }

  reset(): void {
    this.count = 0;
    this.last = -Infinity;
  }
}

const heavier = (a: StampId | null, b: StampId): StampId => (a === null || STAMPS[b].weight > STAMPS[a].weight ? b : a);

/**
 * Spots named mayhem in the bus events, all of it the player's own. Set
 * `driving` (the player's vehicle, null on foot) before each handle().
 */
export class StampDetector {
  driving: VehicleArchetype | null = null;
  private readonly chain = new Chain(CHAIN_GAP);
  private readonly pile = new Burst(PILEUP_CRASHES, PILEUP_SPAN);
  private pileAt = -Infinity;
  private pileX = 0;
  private pileZ = 0;
  private readonly bus = new Burst(3, 3);
  private readonly bowled = new Burst(4, 3);
  private readonly punched = new Burst(3, 6);
  private readonly crew = new Burst(3, 5);
  /** Police cars wrecked this pursuit; -1 once PANDAS has fired. */
  private pandas = 0;
  private fiveStars = false;
  private hoseAt = -Infinity;
  private hoseX = 0;
  private hoseZ = 0;

  /** The heaviest stamp `e` earns at sim time `now`, or null. */
  handle(e: GameEvent, now: number): StampId | null {
    let found: StampId | null = null;
    switch (e.type) {
      case 'explosion': {
        if (!e.byPlayer || e.ownCar) break;
        if (now - this.hoseAt < HOSE_LIFE && Math.abs(e.x - this.hoseX) < HOSE_RANGE && Math.abs(e.z - this.hoseZ) < HOSE_RANGE) {
          found = heavier(found, 'healthAndSafety');
          this.hoseAt = -Infinity;
        }
        // Cars only: grenades thrown at an empty road aren't a chain reaction.
        if (e.source !== undefined && e.source !== 'vehicle') break;
        const n = this.chain.link(now);
        if (n === CHAIN_BBQ) found = heavier(found, 'barbecueSeason');
        else if (n === CHAIN_BONFIRE) found = heavier(found, 'bonfireNight');
        break;
      }
      case 'award': {
        const a = e.award;
        if (a.kind === 'copWreck' && this.pandas >= 0 && ++this.pandas >= PANDAS) {
          this.pandas = -1;
          found = heavier(found, 'endangeredPandas');
        }
        if (a.kind === 'evaded' && a.points > 0) found = heavier(found, 'nothingToSeeHere');
        // The chase handoff's moments (scenes/chases.ts) share their score kinds' names.
        if (a.kind === 'takeTheHeat' || a.kind === 'citizensArrest' || a.kind === 'haveAGo') found = heavier(found, a.kind);
        // The award that takes the combo to the top (the fx director's ×10 flash).
        if (a.multiplier === MAX_COMBO - 1) found = heavier(found, 'absoluteScenes');
        break;
      }
      case 'crash': {
        if (e.against !== 'vehicle' || e.impact < PILEUP_IMPACT) break;
        if (e.involvesPlayer) {
          const fresh = now - this.pileAt > PILEUP_SPAN;
          if (fresh) {
            this.pileX = e.x;
            this.pileZ = e.z;
          }
          this.pileAt = now;
          // Only the player's first crash counts: cops ramming you four times isn't a pile-up.
          if (!fresh) break;
        }
        // Only crashes round one of the player's count, and only after it.
        if (now - this.pileAt > PILEUP_SPAN || Math.abs(e.x - this.pileX) > PILEUP_RANGE || Math.abs(e.z - this.pileZ) > PILEUP_RANGE) break;
        if (this.pile.hit(now)) found = heavier(found, 'bankHoliday');
        break;
      }
      case 'pedDown': {
        if (!e.byPlayer || e.isPlayer) break;
        if (e.cause === 'vehicle') {
          if (this.driving === 'bus') {
            if (this.bus.hit(now)) found = heavier(found, 'faresPlease');
          } else if (this.bowled.hit(now)) found = heavier(found, 'bowledOver');
        } else if (e.cause === 'punch' && this.punched.hit(now)) found = heavier(found, 'lastOrders');
        if (e.gang !== undefined && this.crew.hit(now)) found = heavier(found, 'neighbourhoodWatch');
        break;
      }
      case 'wanted':
        if (e.level >= 5 && e.prev < 5 && !this.fiveStars) {
          this.fiveStars = true;
          found = heavier(found, 'bluesAndTwos');
        }
        // A pursuit ends at 0 stars: the police count starts again.
        if (e.level === 0) {
          this.pandas = 0;
          this.fiveStars = false;
        }
        break;
      case 'stunt':
        if (e.points >= FLYER_POINTS) found = heavier(found, 'frequentFlyer');
        break;
      case 'street':
        if (e.what === 'hose') {
          this.hoseAt = now;
          this.hoseX = e.x;
          this.hoseZ = e.z;
        } else if (e.what === 'fireOut' && Math.abs(e.x - this.hoseX) < 1 && Math.abs(e.z - this.hoseZ) < 1) this.hoseAt = -Infinity;
        break;
      case 'respawn':
      case 'busted':
        this.reset();
        break;
      default:
        break;
    }
    return found;
  }

  reset(): void {
    this.chain.reset();
    this.pile.reset();
    this.pileAt = -Infinity;
    this.bus.reset();
    this.bowled.reset();
    this.punched.reset();
    this.crew.reset();
    this.pandas = 0;
    this.fiveStars = false;
    this.hoseAt = -Infinity;
  }
}

/**
 * One stamp at a time: offer() what was spotted, step() says what to show.
 * Within a step the heaviest offer wins (the newer of equals). A stamp shows at once if the last
 * was COOLDOWN ago; a heavier one within OVERRIDE of a lighter one replaces
 * it; otherwise it waits out the cooldown, and is dropped once STALE.
 */
export class StampArbiter {
  /** The one on screen (or last shown) and when. */
  shown: StampId | null = null;
  shownAt = -Infinity;
  private pending: StampId | null = null;
  private pendingAt = 0;

  offer(id: StampId, now: number): void {
    // Ties go to the newer: it's fresher. One past STALE is gone already, whatever it weighed.
    if (this.pending === null || now - this.pendingAt > STAMP_STALE || STAMPS[id].weight >= STAMPS[this.pending].weight) {
      this.pending = id;
      this.pendingAt = now;
    }
  }

  /** The stamp to show now, or null. */
  step(now: number): StampId | null {
    const id = this.pending;
    if (id === null) return null;
    if (now - this.pendingAt > STAMP_STALE) {
      this.pending = null;
      return null;
    }
    const since = now - this.shownAt;
    const ready = since >= STAMP_COOLDOWN || (since <= STAMP_OVERRIDE && this.shown !== null && STAMPS[id].weight > STAMPS[this.shown].weight);
    if (!ready) return null;
    this.pending = null;
    this.shown = id;
    this.shownAt = now;
    return id;
  }

  reset(): void {
    this.shown = this.pending = null;
    this.shownAt = -Infinity;
  }
}

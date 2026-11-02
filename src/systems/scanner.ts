/**
 * The police scanner (V2-11): the city's street events and the player's own
 * heat → short dispatcher lines, one at a time, with a radar ping (two at
 * most) on an incident until it's over. Pure and tested
 * (tests/scanner.test.ts); game/scanner.ts feeds it from the bus and puts
 * its lines and pings on screen.
 *
 * - **Topics**: each street event that's worth a call maps to a topic with a
 *   priority, a cooldown and a few lines (`{place}` is the district). The
 *   player's own (stars up, a new car, a new district, lost, nicked) name
 *   the car's colour and the district (`{suspect}`, `{aSuspect}`).
 * - **One at a time**: one line waits (the heaviest offer; a newer one of
 *   the same weight replaces it), stale after `STALE` s. Lines go out
 *   `gapFor(stars)` apart (the player's own only `YOU_GAP` apart).
 * - **While wanted** the chatter thins: below `MIN_PRIORITY[stars]` a street
 *   line isn't said at all, and at 5★ only a spilled cash van gets through,
 *   one every 14 s at most.
 * - **Pings**: a topic with a `scene` drops a ping where it happened. It
 *   follows the scene's subject, and goes when the scene isn't running (if
 *   `track`), a closing event comes, or after `life` s.
 */
import type { StreetWhat } from '../core/events';
import type { VehicleArchetype } from '../entities/vehicle';
import type { WantedReason } from './wanted';
import { colourName } from '../game/modes/exports';

/** 1 chatter, 2 an incident, 3 an opportunity, 4 the player's own. */
export type ScannerPriority = 1 | 2 | 3 | 4;

export type StreetTopic =
  | 'chase'
  | 'race'
  | 'accident'
  | 'fight'
  | 'mugging'
  | 'turf'
  | 'fire'
  | 'cashRun'
  | 'cashSpill'
  | 'kebab'
  | 'funeral'
  | 'hydrant'
  | 'conga'
  | 'filmShoot'
  | 'doublePark'
  | 'alarm'
  | 'busker'
  | 'iceCream'
  | 'arrest'
  | 'suspectDown'
  | 'citizensArrest'
  | 'bagReturned';

/** The player's own: a star up, a district crossed or a car switched while wanted, and how it ended. */
export type YouTopic = 'wanted' | 'heading' | 'switched' | 'evaded' | 'respray' | 'busted';

export type ScannerTopic = StreetTopic | YouTopic;

export interface TopicSpec {
  priority: ScannerPriority;
  /** Seconds before this topic is said again. */
  cooldown: number;
  /** The city scene it's about (CityLife's label): it gets a radar ping. */
  scene?: string;
  /** Does the scene's `running` say when it's over (else only `life` and closing events end the ping)? */
  track?: boolean;
  /** The ping goes after this many seconds whatever happens. */
  life?: number;
  /** Uppercase, `{place}` the district; the player's own `{suspect}` / `{aSuspect}` too. */
  lines: readonly string[];
}

export const TOPICS: Readonly<Record<ScannerTopic, TopicSpec>> = {
  chase: {
    priority: 2,
    cooldown: 60,
    scene: 'chase',
    track: true,
    life: 150,
    lines: ['POLICE PURSUIT THROUGH {place}. KEEP OUT THE WAY.', 'UNITS IN PURSUIT, {place}. SUSPECT DRIVING LIKE A PRAT.'],
  },
  race: {
    priority: 2,
    cooldown: 60,
    scene: 'race',
    track: true,
    life: 90,
    lines: ['STREET RACERS IN {place}. BOY RACERS AGAIN.', 'RACING REPORTED IN {place}. ALL NOISE, NO MANNERS.'],
  },
  accident: {
    priority: 2,
    cooldown: 45,
    scene: 'accident',
    track: true,
    life: 90,
    lines: ['RTC IN {place}. TWO CARS, TWO TEMPERS.', 'COLLISION IN {place}. DRIVERS HAVING WORDS.'],
  },
  fight: {
    priority: 2,
    cooldown: 45,
    scene: 'fight',
    track: true,
    life: 40,
    lines: ['SCUFFLE IN {place}. HANDBAGS, BY THE LOOKS OF IT.', 'PUNCH-UP IN {place}. ATTEND IF YOU FANCY IT.'],
  },
  mugging: {
    priority: 2,
    cooldown: 60,
    scene: 'mugging',
    track: true,
    life: 45,
    lines: ['BAG SNATCH IN {place}. SUSPECT LEGGING IT.', 'MUGGING IN {place}. HAVE-A-GO HEROES WELCOME.'],
  },
  turf: {
    priority: 2,
    cooldown: 90,
    scene: 'turf',
    track: true,
    life: 90,
    lines: ['GANGS SQUARING UP IN {place}. BRING A MOP.', 'TURF DISPUTE, {place}. NOBODY GO IN ALONE.'],
  },
  fire: {
    priority: 2,
    cooldown: 45,
    // The scene counts its trucks, not its fires: the fire's own clock and fireOut end it.
    scene: 'fire',
    life: 80,
    lines: ['VEHICLE FIRE IN {place}. FIRE CREW EN ROUTE.', 'CAR ALIGHT IN {place}. MARSHMALLOWS NOT ADVISED.'],
  },
  cashRun: {
    priority: 2,
    cooldown: 180,
    scene: 'cashRun',
    track: true,
    life: 120,
    lines: ['CASH VAN ON ITS ROUNDS IN {place}. NOBODY GET IDEAS.', 'SECURITY VAN IN {place}. EYES PEELED.'],
  },
  cashSpill: {
    priority: 3,
    cooldown: 60,
    scene: 'cashRun',
    life: 45,
    lines: ['CASH VAN HIT IN {place}. MONEY ALL OVER THE ROAD.', "SECURITY VAN DOWN, {place}. IT'S RAINING TENNERS."],
  },
  kebab: {
    priority: 2,
    cooldown: 180,
    scene: 'kebab',
    track: true,
    life: 110,
    lines: ['CHUCKING-OUT TIME, {place}. MIND THE CHILLI SAUCE.', 'KEBAB SHOP EMPTYING OUT, {place}. SAFETY IN NUMBERS.'],
  },
  funeral: {
    priority: 2,
    cooldown: 240,
    scene: 'funeral',
    track: true,
    life: 150,
    lines: ['FUNERAL THROUGH {place}. HATS OFF, NO OVERTAKING.', 'HEARSE ON THE MOVE IN {place}. SHOW SOME RESPECT.'],
  },
  hydrant: {
    priority: 2,
    cooldown: 90,
    scene: 'hydrant',
    track: true,
    life: 45,
    lines: ['BURST MAIN IN {place}. KIDS LOVING IT.', 'HYDRANT GONE UP IN {place}. BRING A TOWEL.'],
  },
  conga: {
    priority: 2,
    cooldown: 180,
    scene: 'conga',
    track: true,
    life: 110,
    lines: ['CONGA LINE IN {place}. APPROACH WITH CAUTION.', 'PARTY ON THE PAVEMENT, {place}. DO NOT ENGAGE.'],
  },
  filmShoot: {
    priority: 2,
    cooldown: 240,
    scene: 'filmShoot',
    track: true,
    life: 140,
    lines: ["FILM CREW IN {place}. THOSE AREN'T REAL OFFICERS.", "FILM SHOOT, {place}. IF IT GOES BANG, IT'S MEANT TO."],
  },
  doublePark: { priority: 1, cooldown: 120, lines: ['LORRY DOUBLE-PARKED IN {place}. TUTTING ADVISED.'] },
  alarm: { priority: 1, cooldown: 120, lines: ["CAR ALARM IN {place}. NOBODY'S COMING.", 'ANOTHER ALARM IN {place}. SAME FITTER, PROBABLY.'] },
  busker: { priority: 1, cooldown: 180, lines: ['BUSKER IN {place}. NOISE COMPLAINT LOGGED.'] },
  iceCream: { priority: 1, cooldown: 180, lines: ["ICE CREAM VAN IN {place}. THE MAYOR WON'T LIKE IT."] },
  arrest: { priority: 1, cooldown: 60, lines: ["SUSPECT IN CUSTODY, {place}. KETTLE'S ON."] },
  suspectDown: { priority: 1, cooldown: 60, lines: ['SUSPECT DOWN IN {place}. AMBULANCE REQUESTED.'] },
  citizensArrest: { priority: 1, cooldown: 60, lines: ['GETAWAY STOPPED BY THE PUBLIC, {place}. CHEEKY.'] },
  bagReturned: { priority: 1, cooldown: 60, lines: ['BAG HANDED BACK IN {place}. FAIR PLAY.'] },
  // The player's own (wanted lines: WANTED_LINES by stars).
  wanted: { priority: 4, cooldown: 0, lines: [] },
  heading: { priority: 4, cooldown: 30, lines: ['{suspect} HEADING INTO {place}.', '{suspect} NOW IN {place}. STAY ON IT.'] },
  switched: { priority: 4, cooldown: 15, lines: ["SUSPECT'S SWITCHED MOTORS. NOW {aSuspect}."] },
  evaded: { priority: 4, cooldown: 0, lines: ['LOST THE SUSPECT IN {place}. STAND DOWN.', 'NO SIGN OF THEM IN {place}. ALL UNITS STAND DOWN.'] },
  respray: { priority: 4, cooldown: 0, lines: ["SUSPECT VEHICLE'S VANISHED. CHECK THE PAINT SHOPS."] },
  busted: { priority: 4, cooldown: 0, lines: ["SUSPECT IN CUSTODY, {place}. PAPERWORK'S YOURS, SARGE."] },
};

/** A star gained (1..5): who's sent, and the car and district. */
export const WANTED_LINES: readonly (readonly string[])[] = [
  [],
  ['UNITS TO {place}: {suspect}. NOTHING SILLY.'],
  ['ALL UNITS, {place}: {suspect}. IN A HURRY.'],
  ['{suspect} IN {place}. RAMMING AUTHORISED.'],
  ['ARMED RESPONSE TO {place}. {suspect}.'],
  ['EVERYONE TO {place}, CHOPPER UP. {suspect}.'],
];

/** The street events that are worth a call. */
export const STREET_TOPICS: Readonly<Partial<Record<StreetWhat, StreetTopic>>> = {
  chase: 'chase',
  race: 'race',
  accident: 'accident',
  fight: 'fight',
  mugging: 'mugging',
  turfWar: 'turf',
  fire: 'fire',
  cashRun: 'cashRun',
  cashSpill: 'cashSpill',
  kebab: 'kebab',
  funeral: 'funeral',
  hydrant: 'hydrant',
  conga: 'conga',
  action: 'filmShoot',
  doublePark: 'doublePark',
  alarm: 'alarm',
  busker: 'busker',
  iceCream: 'iceCream',
  arrest: 'arrest',
  suspectDown: 'suspectDown',
  citizensArrest: 'citizensArrest',
  bagReturned: 'bagReturned',
};

/** Street events that end an incident: its scene's pings close by go. */
export const CLOSES: Readonly<Partial<Record<StreetWhat, string>>> = {
  fireOut: 'fire',
  raceWon: 'race',
  arrest: 'chase',
  suspectDown: 'chase',
  citizensArrest: 'chase',
  bagReturned: 'mugging',
};

/** Lowest priority a street line needs at 0..5 stars. */
export const MIN_PRIORITY: readonly ScannerPriority[] = [1, 2, 2, 2, 3, 3];
/** Seconds from one line to the next at 0..5 stars. */
export const GAP: readonly number[] = [6, 7, 8, 9, 11, 14];
/** The player's own lines only wait for the one on screen. */
export const YOU_GAP = 4.5;
/** A waiting line is dropped this long after it was offered, s. */
export const STALE = 6;
/** Street events further off than this aren't called in, m. */
export const SCANNER_RANGE = 220;
/** An offer this close to a ping is the same incident (said only if it outranks it), m. */
export const MERGE = 40;
/** A ping follows its scene's subject while it's within this much of it, m. */
export const FOLLOW = 90;
/** A closing event ends its scene's pings within this, m. */
export const CLOSE_RANGE = 140;
/** Pings stand at least this long before the scene's `running` can end them (it may start the step after), s. */
export const GRACE = 2;
/** How often the pings ask the city about their scenes, s. */
export const PING_CHECK = 0.25;
export const MAX_PINGS = 2;

/** Seconds a line stays on screen: longer lines, longer. */
export function holdFor(text: string): number {
  return Math.min(5.5, Math.max(3.2, 2.4 + text.length * 0.045));
}

export function gapFor(stars: number): number {
  return GAP[Math.max(0, Math.min(5, Math.floor(stars)))];
}

export function minPriority(stars: number): ScannerPriority {
  return MIN_PRIORITY[Math.max(0, Math.min(5, Math.floor(stars)))];
}

/** What the dispatcher calls each model. */
const NOUNS: Readonly<Record<VehicleArchetype, string>> = {
  sedan: 'SALOON',
  compact: 'HATCHBACK',
  sports: 'SPORTS CAR',
  van: 'VAN',
  pickup: 'PICKUP',
  taxi: 'TAXI',
  muscle: 'MUSCLE CAR',
  limo: 'LIMO',
  tow_truck: 'TOW TRUCK',
  ice_cream_van: 'ICE CREAM VAN',
  scooter: 'SCOOTER',
  police: 'PANDA CAR',
  police_suv: 'POLICE SUV',
  swat: 'SWAT TRUCK',
  cop_bike: 'POLICE BIKE',
  ambulance: 'AMBULANCE',
  firetruck: 'FIRE ENGINE',
  garbage_truck: 'BIN LORRY',
  bus: 'BUS',
};

/** Ones with a livery everyone knows: "STOLEN", not a colour. */
const STOLEN: ReadonlySet<VehicleArchetype> = new Set<VehicleArchetype>(['police', 'police_suv', 'swat', 'cop_bike', 'ambulance', 'firetruck', 'garbage_truck', 'bus']);

export const ON_FOOT = 'SUSPECT ON FOOT';

/** The player as the dispatcher has it: 'RED SALOON', 'STOLEN PANDA CAR', or ON_FOOT. */
export function describeSuspect(archetype: VehicleArchetype | null, paint?: Parameters<typeof colourName>[0]): string {
  if (archetype === null) return ON_FOOT;
  const noun = NOUNS[archetype];
  if (STOLEN.has(archetype) || paint === undefined) return `STOLEN ${noun}`;
  return `${colourName(paint)} ${noun}`;
}

/** 'A RED SALOON', 'AN ORANGE VAN'. */
export function withArticle(desc: string): string {
  return /^[AEIOU]/.test(desc) ? `AN ${desc}` : `A ${desc}`;
}

export function fill(template: string, place: string, suspect = ON_FOOT): string {
  return template.replace('{place}', place).replace('{suspect}', suspect).replace('{aSuspect}', withArticle(suspect));
}

/** A line that went out: what the HUD shows and the radio squelches for. */
export interface ScannerLine {
  topic: ScannerTopic;
  text: string;
  priority: ScannerPriority;
  x: number;
  z: number;
  /** Seconds to show it (holdFor). */
  hold: number;
}

export interface ScannerPing {
  /** The radar blip's id. */
  readonly id: string;
  active: boolean;
  topic: ScannerTopic;
  scene: string;
  track: boolean;
  priority: ScannerPriority;
  x: number;
  z: number;
  born: number;
  /** Gone at this time whatever happens. */
  until: number;
}

/** What the pings ask the city (game/scanner.ts: CityLife's scenes by label). */
export interface PingWorld {
  /** Is any of that scene running? */
  alive(scene: string): boolean;
  /** Where its subject is, into `out`; false with nothing to show. */
  where(scene: string, out: { x: number; z: number }): boolean;
}

interface Offer {
  live: boolean;
  topic: ScannerTopic;
  text: string;
  priority: ScannerPriority;
  x: number;
  z: number;
  at: number;
  /** Said whatever the cooldowns and gaps (debug). */
  forced: boolean;
}

export class ScannerFeed {
  /** Off: nothing is offered, nothing goes out, no pings (Settings, observe mode). */
  enabled = true;
  /** The wanted level, as the last `wanted` call left it. */
  stars = 0;
  readonly pings: ScannerPing[] = [];
  /** The line step() last returned (reused). */
  readonly line: ScannerLine = { topic: 'chase', text: '', priority: 2, x: 0, z: 0, hold: 0 };
  /** Lines said so far (tests, the session log). */
  said = 0;
  private readonly pending: Offer = { live: false, topic: 'chase', text: '', priority: 1, x: 0, z: 0, at: 0, forced: false };
  private readonly lastSaid = new Map<ScannerTopic, number>();
  private lastLine = -Infinity;
  private lastCheck = -Infinity;
  private readonly at = { x: 0, z: 0 };

  constructor(private readonly rand: () => number = Math.random) {
    for (let i = 0; i < MAX_PINGS; i++) {
      this.pings.push({ id: `scanner-${i}`, active: false, topic: 'chase', scene: '', track: false, priority: 1, x: 0, z: 0, born: 0, until: 0 });
    }
  }

  /** A street event at (x, z) in `place`, `dist` m from the player. */
  street(what: StreetWhat, x: number, z: number, place: string, dist: number, now: number): void {
    if (!this.enabled) return;
    const scene = CLOSES[what];
    if (scene) this.close(scene, x, z);
    const topic = STREET_TOPICS[what];
    if (!topic || dist > SCANNER_RANGE) return;
    const spec = TOPICS[topic];
    if (spec.priority < minPriority(this.stars)) return;
    if (this.cooling(topic, now)) return;
    // The same incident again (a fight at an accident's cars, the cash van's next stop): only if it's bigger news.
    for (const p of this.pings) if (p.active && p.priority >= spec.priority && near(p.x, p.z, x, z, MERGE)) return;
    this.offer(topic, fill(this.pick(spec.lines), place), spec.priority, x, z, now, false);
  }

  /** The wanted level changed (the bus's `wanted`); `suspect` from describeSuspect, `place` where the player is. */
  wanted(level: number, prev: number, reason: WantedReason, suspect: string, place: string, x: number, z: number, now: number): void {
    this.stars = level;
    if (!this.enabled) return;
    if (level > prev && reason === 'crime') {
      const lines = WANTED_LINES[Math.min(5, level)];
      if (lines.length) this.offer('wanted', fill(this.pick(lines), place, suspect), 4, x, z, now, false);
    } else if (level === 0 && prev > 0) {
      const topic = reason === 'evaded' ? 'evaded' : reason === 'respray' ? 'respray' : reason === 'busted' ? 'busted' : null;
      // A star up still waiting is old news now.
      if (this.pending.live && this.pending.priority === 4) this.pending.live = false;
      if (topic) this.offer(topic, fill(this.pick(TOPICS[topic].lines), place, suspect), 4, x, z, now, false);
    }
  }

  /** While wanted, the player crossed into `place`. */
  heading(suspect: string, place: string, x: number, z: number, now: number): void {
    this.you('heading', suspect, place, x, z, now);
  }

  /** While wanted, the player got into another vehicle (`suspect` describes it). */
  switched(suspect: string, place: string, x: number, z: number, now: number): void {
    this.you('switched', suspect, place, x, z, now);
  }

  /** Say `topic` next step whatever the cooldowns, gap and stars (debug, smoke test). */
  force(topic: ScannerTopic, place: string, x: number, z: number, now: number, suspect = ON_FOOT): void {
    const spec = TOPICS[topic];
    const lines = topic === 'wanted' ? WANTED_LINES[Math.max(1, Math.min(5, this.stars))] : spec.lines;
    this.offer(topic, fill(this.pick(lines), place, suspect), spec.priority, x, z, now, true);
  }

  /**
   * Once a frame: keep the pings (asking `world` 4× a second), and return the
   * line that's due, if any (`this.line`, reused), else null.
   */
  step(now: number, world: PingWorld): ScannerLine | null {
    if (!this.enabled) return null;
    if (now - this.lastCheck >= PING_CHECK) {
      this.lastCheck = now;
      this.keepPings(now, world);
    }
    const o = this.pending;
    if (!o.live) return null;
    if (!o.forced && now - o.at > STALE) {
      o.live = false;
      return null;
    }
    const gap = o.priority === 4 ? YOU_GAP : gapFor(this.stars);
    if (!o.forced && now - this.lastLine < gap) return null;
    o.live = false;
    this.lastLine = now;
    this.lastSaid.set(o.topic, now);
    this.said++;
    const l = this.line;
    l.topic = o.topic;
    l.text = o.text;
    l.priority = o.priority;
    l.x = o.x;
    l.z = o.z;
    l.hold = holdFor(o.text);
    this.ping(o.topic, o.x, o.z, now);
    return l;
  }

  /** Is one of the pings live? */
  get pinging(): boolean {
    for (const p of this.pings) if (p.active) return true;
    return false;
  }

  /** Drop what's waiting and every ping; cooldowns too (a fresh run, the title, switched off). */
  reset(): void {
    this.pending.live = false;
    for (const p of this.pings) p.active = false;
    this.lastSaid.clear();
    this.lastLine = -Infinity;
    this.lastCheck = -Infinity;
    this.stars = 0;
  }

  private you(topic: YouTopic, suspect: string, place: string, x: number, z: number, now: number): void {
    if (!this.enabled || this.stars <= 0 || this.cooling(topic, now)) return;
    this.offer(topic, fill(this.pick(TOPICS[topic].lines), place, suspect), 4, x, z, now, false);
  }

  private cooling(topic: ScannerTopic, now: number): boolean {
    const last = this.lastSaid.get(topic);
    return last !== undefined && now - last < TOPICS[topic].cooldown;
  }

  /** Into the one waiting slot: the heavier offer wins, a newer one of the same weight replaces it. */
  private offer(topic: ScannerTopic, text: string, priority: ScannerPriority, x: number, z: number, now: number, forced: boolean): void {
    const o = this.pending;
    if (o.live && o.forced && !forced) return;
    if (o.live && !forced && now - o.at <= STALE && o.priority > priority) return;
    o.live = true;
    o.topic = topic;
    o.text = text;
    o.priority = priority;
    o.x = x;
    o.z = z;
    o.at = now;
    o.forced = forced;
  }

  /** A ping for a line that went out: the same incident's moves and refreshes; else a free slot, else the oldest no heavier. */
  private ping(topic: ScannerTopic, x: number, z: number, now: number): void {
    const spec = TOPICS[topic];
    if (!spec.scene) return;
    let slot: ScannerPing | null = null;
    for (const p of this.pings) if (p.active && p.scene === spec.scene && near(p.x, p.z, x, z, MERGE)) slot = p;
    if (!slot) for (const p of this.pings) if (!p.active) slot ??= p;
    if (!slot) {
      for (const p of this.pings) if (p.priority <= spec.priority && (!slot || p.born < slot.born)) slot = p;
      if (!slot) return;
    }
    slot.active = true;
    slot.topic = topic;
    slot.scene = spec.scene;
    slot.track = spec.track === true;
    slot.priority = spec.priority;
    slot.x = x;
    slot.z = z;
    slot.born = now;
    slot.until = now + (spec.life ?? 60);
  }

  private keepPings(now: number, world: PingWorld): void {
    for (const p of this.pings) {
      if (!p.active) continue;
      if (now >= p.until || (p.track && now - p.born >= GRACE && !world.alive(p.scene))) {
        p.active = false;
        continue;
      }
      // Moving incidents (a chase, a conga) take the ping with them.
      if (world.where(p.scene, this.at) && near(p.x, p.z, this.at.x, this.at.z, FOLLOW)) {
        p.x = this.at.x;
        p.z = this.at.z;
      }
    }
  }

  /** A closing event: that scene's pings near it go. */
  private close(scene: string, x: number, z: number): void {
    for (const p of this.pings) if (p.active && p.scene === scene && near(p.x, p.z, x, z, CLOSE_RANGE)) p.active = false;
  }

  private pick(lines: readonly string[]): string {
    return lines[Math.min(lines.length - 1, Math.floor(this.rand() * lines.length))];
  }
}

function near(ax: number, az: number, bx: number, bz: number, r: number): boolean {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz <= r * r;
}

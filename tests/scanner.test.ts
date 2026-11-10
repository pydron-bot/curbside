import { describe, expect, it } from 'vitest';
import type { StreetWhat } from '../src/core/events';
import {
  CLOSES,
  describeSuspect,
  fill,
  GAP,
  GRACE,
  holdFor,
  MAX_PINGS,
  ON_FOOT,
  ScannerFeed,
  STALE,
  STREET_TOPICS,
  TOPICS,
  WANTED_LINES,
  withArticle,
  YOU_GAP,
  type PingWorld,
  type ScannerLine,
} from '../src/systems/scanner';
import { DISTRICT_NAMES } from '../src/world/districts';

/** A city where every scene is running and nothing moves. */
const STILL: PingWorld = { alive: () => true, where: () => false };

/** Step the feed from `from` to `to` at 60 Hz; the lines that went out (copied). */
function run(feed: ScannerFeed, from: number, to: number, world: PingWorld = STILL): ScannerLine[] {
  const out: ScannerLine[] = [];
  for (let t = from; t <= to + 1e-9; t += 1 / 60) {
    const l = feed.step(t, world);
    if (l) out.push({ ...l, at: t } as ScannerLine & { at: number });
  }
  return out;
}

const first = () => 0;

describe('scanner: street events', () => {
  it('every mapped street event says its own line, with the district in it', () => {
    for (const [what, topic] of Object.entries(STREET_TOPICS) as [StreetWhat, keyof typeof TOPICS][]) {
      const feed = new ScannerFeed(first);
      feed.street(what, 10, 20, 'COBBLE ROW', 50, 0);
      const l = feed.step(0, STILL);
      expect(l, what).not.toBeNull();
      expect(l!.topic).toBe(topic);
      expect(l!.text).toBe(fill(TOPICS[topic].lines[0], 'COBBLE ROW'));
      expect(l!.text).toContain('COBBLE ROW');
      expect(l!.priority).toBe(TOPICS[topic].priority);
      expect([l!.x, l!.z]).toEqual([10, 20]);
      // A ping for the incidents, none for the chatter and the closing lines.
      expect(feed.pinging, what).toBe(TOPICS[topic].scene !== undefined && CLOSES[what] === undefined);
    }
  });

  it('the rest of the street (barks, hoses, bus stops) says nothing', () => {
    const quiet: StreetWhat[] = ['bark', 'yelp', 'hose', 'busStop', 'iceCreamServed', 'patientLoaded', 'ambulance', 'weaponDrop', 'pyro', 'raceWon', 'fireOut', 'spray' as StreetWhat];
    for (const what of quiet) {
      const feed = new ScannerFeed(first);
      feed.street(what, 0, 0, 'NEON MILE', 10, 0);
      expect(feed.step(0, STILL), what).toBeNull();
    }
  });

  it('too far off is not called in', () => {
    const feed = new ScannerFeed(first);
    feed.street('chase', 0, 0, 'NEON MILE', 400, 0);
    expect(feed.step(0, STILL)).toBeNull();
  });

  it('every line fits two lines of the phone subtitle, whatever the district or car', () => {
    const places = Object.values(DISTRICT_NAMES);
    const longPlace = places.reduce((a, b) => (b.length > a.length ? b : a));
    const suspects = [ON_FOOT, describeSuspect('ice_cream_van', '#d9d6cc'), describeSuspect('garbage_truck'), describeSuspect('sports', '#8a8f96')];
    const longSuspect = suspects.reduce((a, b) => (b.length > a.length ? b : a));
    const all = [...Object.values(TOPICS).flatMap((t) => t.lines), ...WANTED_LINES.flat()];
    expect(all.length).toBeGreaterThan(30);
    for (const line of all) {
      const text = fill(line, longPlace, longSuspect);
      expect(text, line).toMatch(/^[A-Z0-9 ,.:'!?-]+$/);
      expect(text.length, text).toBeLessThanOrEqual(64);
      expect(text).not.toContain('{');
    }
  });

  it('holds longer lines longer, within bounds', () => {
    expect(holdFor('SHORT')).toBe(3.2);
    expect(holdFor('X'.repeat(64))).toBeGreaterThan(holdFor('X'.repeat(30)));
    expect(holdFor('X'.repeat(200))).toBe(5.5);
  });
});

describe('scanner: cooldowns, the gap and priority', () => {
  it('the same topic waits out its cooldown', () => {
    const feed = new ScannerFeed(first);
    feed.street('race', 0, 0, 'NEON MILE', 10, 0);
    expect(feed.step(0, STILL)).not.toBeNull();
    // Another race somewhere else, inside the cooldown: nothing.
    feed.street('race', 500, 500, 'NEON MILE', 10, 20);
    expect(run(feed, 20, 30)).toHaveLength(0);
    feed.street('race', 500, 500, 'NEON MILE', 10, TOPICS.race.cooldown + 1);
    expect(run(feed, TOPICS.race.cooldown + 1, TOPICS.race.cooldown + 2)).toHaveLength(1);
  });

  it('lines go out at least the gap apart', () => {
    const feed = new ScannerFeed(first);
    feed.street('race', 0, 0, 'NEON MILE', 10, 0);
    feed.step(0, STILL);
    feed.street('busker', 300, 300, 'NEON MILE', 10, 1);
    const lines = run(feed, 1, 10) as (ScannerLine & { at: number })[];
    expect(lines).toHaveLength(1);
    expect(lines[0].topic).toBe('busker');
    expect(lines[0].at).toBeGreaterThanOrEqual(GAP[0] - 1e-6);
  });

  it('one line waits: a heavier offer takes its place, a lighter one is dropped', () => {
    const feed = new ScannerFeed(first);
    feed.street('alarm', 0, 0, 'NEON MILE', 10, 0);
    feed.step(0, STILL);
    feed.street('busker', 200, 0, 'NEON MILE', 10, 1);
    feed.street('chase', 400, 0, 'NEON MILE', 10, 1.5);
    feed.street('iceCream', 600, 0, 'NEON MILE', 10, 2);
    const lines = run(feed, 2, 30);
    expect(lines.map((l) => l.topic)).toEqual(['chase']);
  });

  it('held while a story line has the subtitle: nothing is said, then the waiting line goes out once it is free', () => {
    const feed = new ScannerFeed(first);
    feed.street('alarm', 0, 0, 'NEON MILE', 10, 0);
    for (let t = 0; t < 2; t += 1 / 60) expect(feed.step(t, STILL, true), `${t}`).toBeNull();
    expect(feed.step(2, STILL)?.text).toBeTruthy();
    // Held past STALE, it's dropped as any waiting line is.
    const late = new ScannerFeed(first);
    late.street('alarm', 0, 0, 'NEON MILE', 10, 0);
    for (let t = 0; t < STALE + 0.5; t += 1 / 60) late.step(t, STILL, true);
    expect(late.step(STALE + 0.6, STILL)).toBeNull();
  });

  it('a waiting line goes stale', () => {
    const feed = new ScannerFeed(first);
    feed.street('alarm', 0, 0, 'NEON MILE', 10, 0);
    feed.step(0, STILL);
    // Offered just after; the gap runs 6 s, so it is still fresh then.
    feed.street('chase', 300, 0, 'NEON MILE', 10, 0.5);
    expect(run(feed, 0.5, 7)).toHaveLength(1);
    // Offered while a long gap runs (5 stars) and gone stale before it ends.
    const busy = new ScannerFeed(first);
    busy.wanted(5, 4, 'crime', 'RED SALOON', 'NEON MILE', 0, 0, 0);
    busy.step(0, STILL);
    busy.street('cashSpill', 100, 0, 'NEON MILE', 10, 1);
    expect(run(busy, 1, 1 + STALE + 0.5)).toHaveLength(0);
  });

  it('the same incident again only if it is bigger news', () => {
    const feed = new ScannerFeed(first);
    feed.street('accident', 0, 0, 'NEON MILE', 10, 0);
    feed.step(0, STILL);
    // Its drivers come to blows: a fight at the accident is the accident.
    feed.street('fight', 8, 4, 'NEON MILE', 10, 10);
    expect(run(feed, 10, 20)).toHaveLength(0);
    // The cash van's next stop is the same van; its cash spilling is news.
    const van = new ScannerFeed(first);
    van.street('cashRun', 0, 0, 'GLASS HEIGHTS', 10, 0);
    van.step(0, STILL);
    van.street('cashSpill', 5, 5, 'GLASS HEIGHTS', 10, 10);
    const lines = run(van, 10, 12);
    expect(lines.map((l) => l.topic)).toEqual(['cashSpill']);
    // Its ping is moved on, not doubled.
    expect(van.pings.filter((p) => p.active)).toHaveLength(1);
    expect(van.pings.find((p) => p.active)!.topic).toBe('cashSpill');
  });

  it('switched off, it says nothing and pings nothing', () => {
    const feed = new ScannerFeed(first);
    feed.enabled = false;
    feed.street('chase', 0, 0, 'NEON MILE', 10, 0);
    feed.wanted(2, 0, 'crime', 'RED SALOON', 'NEON MILE', 0, 0, 0);
    expect(run(feed, 0, 10)).toHaveLength(0);
    expect(feed.pinging).toBe(false);
    // The stars still track, for when it's back on.
    expect(feed.stars).toBe(2);
  });

  it('force says a line whatever the cooldowns, the gap and the stars', () => {
    const feed = new ScannerFeed(first);
    feed.wanted(5, 4, 'crime', 'RED SALOON', 'NEON MILE', 0, 0, 0);
    feed.step(0, STILL);
    feed.force('busker', 'NEON MILE', 0, 0, 0.1);
    expect(feed.step(0.1, STILL)?.topic).toBe('busker');
  });
});

describe('scanner: while wanted', () => {
  it('a star names the car, its colour and the district', () => {
    const feed = new ScannerFeed(first);
    const suspect = describeSuspect('sedan', '#c8342b');
    expect(suspect).toBe('RED SALOON');
    feed.wanted(1, 0, 'crime', suspect, 'NEON MILE', 0, 0, 0);
    const l = feed.step(0, STILL)!;
    expect(l.topic).toBe('wanted');
    expect(l.priority).toBe(4);
    expect(l.text).toContain('RED SALOON');
    expect(l.text).toContain('NEON MILE');
    // Each level has its line.
    for (let s = 1; s <= 5; s++) expect(fill(WANTED_LINES[s][0], 'X', 'Y')).toContain('Y');
  });

  it('describes cars, liveries and the player on foot', () => {
    expect(describeSuspect(null)).toBe(ON_FOOT);
    expect(describeSuspect('sports', '#e8b923')).toBe('YELLOW SPORTS CAR');
    expect(describeSuspect('compact', 0x2f6fc0)).toBe('BLUE HATCHBACK');
    expect(describeSuspect('police', '#ffffff')).toBe('STOLEN PANDA CAR');
    expect(describeSuspect('firetruck', '#c3191c')).toBe('STOLEN FIRE ENGINE');
    expect(describeSuspect('garbage_truck')).toBe('STOLEN BIN LORRY');
    expect(withArticle('ORANGE VAN')).toBe('AN ORANGE VAN');
    expect(withArticle('RED SALOON')).toBe('A RED SALOON');
  });

  it('stars going down a step say nothing; losing them, a respray and a bust each have a line', () => {
    const cases = [
      ['evaded', 'evaded'],
      ['respray', 'respray'],
      ['busted', 'busted'],
    ] as const;
    for (const [reason, topic] of cases) {
      const feed = new ScannerFeed(first);
      feed.wanted(3, 2, 'crime', 'RED SALOON', 'NEON MILE', 0, 0, 0);
      feed.step(0, STILL);
      feed.wanted(2, 3, 'lost', 'RED SALOON', 'NEON MILE', 0, 0, 10);
      expect(run(feed, 10, 12)).toHaveLength(0);
      feed.wanted(0, 2, reason, 'RED SALOON', 'NEON MILE', 0, 0, 20);
      expect(run(feed, 20, 21).map((l) => l.topic)).toEqual([topic]);
    }
    // Dying clears the stars without a word (the WASTED screen has it).
    const dead = new ScannerFeed(first);
    dead.wanted(2, 0, 'crime', 'RED SALOON', 'NEON MILE', 0, 0, 0);
    dead.step(0, STILL);
    dead.wanted(0, 2, 'died', 'RED SALOON', 'NEON MILE', 0, 0, 10);
    expect(run(dead, 10, 20)).toHaveLength(0);
  });

  it('a new district and a new car while wanted are called, each on its own cooldown', () => {
    const feed = new ScannerFeed(first);
    // Not wanted: nobody cares where you go.
    feed.heading('RED SALOON', 'COBBLE ROW', 0, 0, 0);
    feed.switched('BLUE VAN', 'COBBLE ROW', 0, 0, 0);
    expect(run(feed, 0, 10)).toHaveLength(0);
    feed.wanted(2, 0, 'crime', 'RED SALOON', 'NEON MILE', 0, 0, 10);
    feed.step(10, STILL);
    feed.heading('RED SALOON', 'COBBLE ROW', 0, 0, 20);
    const a = run(feed, 20, 21);
    expect(a.map((l) => l.text)).toEqual(['RED SALOON HEADING INTO COBBLE ROW.']);
    feed.heading('RED SALOON', 'NEON MILE', 0, 0, 30);
    expect(run(feed, 30, 40)).toHaveLength(0);
    feed.switched('ORANGE VAN', 'NEON MILE', 0, 0, 40);
    expect(run(feed, 40, 41).map((l) => l.text)).toEqual(["SUSPECT'S SWITCHED MOTORS. NOW AN ORANGE VAN."]);
  });

  it('thins the chatter: below an incident nothing gets through once wanted', () => {
    const feed = new ScannerFeed(first);
    feed.wanted(1, 0, 'crime', 'RED SALOON', 'NEON MILE', 0, 0, 0);
    feed.step(0, STILL);
    feed.street('busker', 0, 0, 'NEON MILE', 10, 10);
    expect(run(feed, 10, 20)).toHaveLength(0);
    feed.street('chase', 200, 0, 'NEON MILE', 10, 20);
    expect(run(feed, 20, 21)).toHaveLength(1);
  });

  it('a street line waiting when the stars go up is dropped if it no longer makes the cut', () => {
    const feed = new ScannerFeed(first);
    feed.street('alarm', 0, 0, 'NEON MILE', 10, 0);
    feed.step(0, STILL);
    feed.street('chase', 300, 0, 'NEON MILE', 10, 1);
    feed.stars = 4;
    expect(run(feed, 1, 10)).toHaveLength(0);
  });

  it('at five stars only a spilled cash van and your own lines get through, at most one every 14 s', () => {
    const feed = new ScannerFeed(first);
    feed.wanted(5, 4, 'crime', 'RED SALOON', 'NEON MILE', 0, 0, 0);
    const lines: (ScannerLine & { at: number })[] = [];
    // Two minutes of everything kicking off, every second, all over town.
    const kinds: StreetWhat[] = ['chase', 'race', 'fight', 'fire', 'cashSpill', 'accident', 'mugging'];
    for (let s = 0; s < 120; s++) {
      for (const what of kinds) feed.street(what, s * 50, 0, 'NEON MILE', 10, s);
      lines.push(...(run(feed, s, s + 1 - 1 / 60) as (ScannerLine & { at: number })[]));
    }
    const street = lines.filter((l) => l.priority < 4);
    expect(street.every((l) => l.topic === 'cashSpill')).toBe(true);
    // The cash van's own cooldown (60 s) and the 14 s gap: twice in two minutes.
    expect(street.length).toBe(2);
    for (let i = 1; i < lines.length; i++) expect(lines[i].at - lines[i - 1].at).toBeGreaterThanOrEqual(GAP[5] - 1e-6);
  });

  it('your own lines only wait for the one on screen, even at five stars', () => {
    const feed = new ScannerFeed(first);
    feed.wanted(4, 3, 'crime', 'RED SALOON', 'NEON MILE', 0, 0, 0);
    feed.step(0, STILL);
    feed.wanted(5, 4, 'crime', 'RED SALOON', 'NEON MILE', 0, 0, 1);
    const lines = run(feed, 1, 10) as (ScannerLine & { at: number })[];
    expect(lines).toHaveLength(1);
    expect(lines[0].at).toBeCloseTo(YOU_GAP, 1);
    expect(lines[0].text).toContain('CHOPPER');
  });

  it('a quick run of stars says only the latest', () => {
    const feed = new ScannerFeed(first);
    feed.wanted(1, 0, 'crime', 'RED SALOON', 'NEON MILE', 0, 0, 0);
    feed.step(0, STILL);
    feed.wanted(2, 1, 'crime', 'RED SALOON', 'NEON MILE', 0, 0, 1);
    feed.wanted(3, 2, 'crime', 'RED SALOON', 'NEON MILE', 0, 0, 2);
    const lines = run(feed, 2, 12);
    expect(lines.map((l) => l.text)).toEqual(['RED SALOON IN NEON MILE. RAMMING AUTHORISED.']);
  });
});

describe('scanner: pings', () => {
  it('two at most: a third takes the oldest no heavier than it', () => {
    const feed = new ScannerFeed(first);
    feed.street('race', 0, 0, 'NEON MILE', 10, 0);
    run(feed, 0, 1);
    feed.street('fire', 200, 0, 'NEON MILE', 10, 10);
    run(feed, 10, 11);
    feed.street('mugging', 400, 0, 'NEON MILE', 10, 20);
    run(feed, 20, 21);
    const live = feed.pings.filter((p) => p.active);
    expect(feed.pings).toHaveLength(MAX_PINGS);
    expect(live).toHaveLength(2);
    expect(live.map((p) => p.scene).sort()).toEqual(['fire', 'mugging']);
  });

  it('a ping lasts while its scene runs, and goes when it stops', () => {
    let running = true;
    const world: PingWorld = { alive: () => running, where: () => false };
    const feed = new ScannerFeed(first);
    feed.street('chase', 0, 0, 'NEON MILE', 10, 0);
    run(feed, 0, 60, world);
    expect(feed.pinging).toBe(true);
    running = false;
    run(feed, 60, 61, world);
    expect(feed.pinging).toBe(false);
  });

  it('a scene that has not started counting yet gets a grace', () => {
    const feed = new ScannerFeed(first);
    const none: PingWorld = { alive: () => false, where: () => false };
    feed.street('conga', 0, 0, 'NEON MILE', 10, 0);
    run(feed, 0, GRACE - 0.5, none);
    expect(feed.pinging).toBe(true);
    run(feed, GRACE - 0.5, GRACE + 0.5, none);
    expect(feed.pinging).toBe(false);
  });

  it("a fire's ping ignores the scene's count and goes when it's out (or burnt out)", () => {
    const none: PingWorld = { alive: () => false, where: () => false };
    const feed = new ScannerFeed(first);
    feed.street('fire', 0, 0, 'NEON MILE', 10, 0);
    run(feed, 0, 30, none);
    expect(feed.pinging).toBe(true);
    feed.street('fireOut', 3, 0, 'NEON MILE', 10, 30);
    expect(feed.pinging).toBe(false);
    feed.street('fire', 600, 0, 'NEON MILE', 10, 60);
    run(feed, 60, 60 + TOPICS.fire.life! + 1, none);
    expect(feed.pinging).toBe(false);
  });

  it('closing events end their scene’s pings nearby only', () => {
    const feed = new ScannerFeed(first);
    feed.street('chase', 0, 0, 'NEON MILE', 10, 0);
    run(feed, 0, 1);
    feed.street('arrest', 1000, 0, 'NEON MILE', 10, 5);
    expect(feed.pinging).toBe(true);
    feed.street('arrest', 60, 0, 'NEON MILE', 10, 6);
    expect(feed.pinging).toBe(false);
  });

  it('follows a moving incident, but not a jump to another one', () => {
    const at = { x: 20, z: 0 };
    const world: PingWorld = {
      alive: () => true,
      where: (_s, out) => {
        out.x = at.x;
        out.z = at.z;
        return true;
      },
    };
    const feed = new ScannerFeed(first);
    feed.street('chase', 0, 0, 'NEON MILE', 10, 0);
    run(feed, 0, 1, world);
    const p = feed.pings.find((q) => q.active)!;
    expect([p.x, p.z]).toEqual([20, 0]);
    at.x = 500;
    run(feed, 1, 2, world);
    expect([p.x, p.z]).toEqual([20, 0]);
  });

  it('reset drops the pings, the waiting line and the cooldowns', () => {
    const feed = new ScannerFeed(first);
    feed.street('race', 0, 0, 'NEON MILE', 10, 0);
    run(feed, 0, 1);
    feed.street('chase', 300, 0, 'NEON MILE', 10, 2);
    feed.reset();
    expect(feed.pinging).toBe(false);
    expect(run(feed, 2, 20)).toHaveLength(0);
    feed.street('race', 0, 0, 'NEON MILE', 10, 20);
    expect(run(feed, 20, 21)).toHaveLength(1);
  });

  it('stepping allocates no line objects: the same record comes back', () => {
    const feed = new ScannerFeed(first);
    feed.street('race', 0, 0, 'NEON MILE', 10, 0);
    const a = feed.step(0, STILL);
    feed.street('fire', 300, 0, 'NEON MILE', 10, 10);
    const b = feed.step(10, STILL);
    expect(a).toBe(b);
    expect(a).toBe(feed.line);
  });
});

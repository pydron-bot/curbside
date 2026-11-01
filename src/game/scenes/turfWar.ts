/**
 * Gang turf flare-ups (rules in systems/turfWar.ts). Now and then, where
 * the VIPERS' turf meets a rival crew's, two to four of each walk in from
 * either end of a pavement, square up and go at it: fists, sometimes a gun
 * on each side (CityLife.setOn: they fight each other, not the player).
 * Hurt badly, some run for it. It's over when one side is all knocked out
 * or gone; the winners walk off. The knocked out are handed to the street
 * (`street`), so the ambulances (scenes/medics.ts) come for them.
 *
 * The player can step in: hit someone on one side and that side turns on
 * you, while the other side stands with you for the rest of the skirmish
 * (they keep fighting the side you hit). Knocking a VIPER down costs
 * respect as ever (game/modes/gangMode.ts hears the same pedDown). Loud:
 * held off by the title, an activity, wanted stars and the tutorial.
 */
import { LOUD } from '../../systems/cityScenes';
import { provoke, scare } from '../../systems/crowd';
import {
  CREW_SIZE,
  FLEE_HP,
  GUN_CHANCE,
  createSkirmish,
  friendly,
  over,
  playerStrikes,
  runsFor,
  turfBorders,
  type Crew,
  type Side,
  type Skirmish,
  type TurfBorder,
} from '../../systems/turfWar';
import type { CrowdPed } from '../population';
import type { Scene, SceneCtx } from '../cityLife';
import { len2 } from '../../core/len';

/** Starts on a border this far from the player, m; each side walks in from this far along it, m. */
const START_RING = [35, 110] as const;
const WALK_IN = 9;
/** They square up this long once close (or once they've been walking in this long), s. */
const FACE_OFF = 2.5;
const GATHER_MAX = 12;
/** A side that's the player's foe keeps after them while they're this close, m. */
const PLAYER_NEAR = 30;
/** How close a player's punch / shot / knock-down must land to count against a member, m. */
const PUNCH_HIT = 1.7;
const SHOT_HIT = 1.1;
const DOWN_HIT = 0.9;

interface Member {
  ped: CrowdPed;
  side: Side;
  armed: boolean;
  /** Ran for it, knocked out (handed to the street) or gone. */
  out: boolean;
  /** Whether they've been judged for running (once, when badly hurt). */
  judged: boolean;
}

interface Flare {
  border: TurfBorder;
  crews: [Crew, Crew];
  members: Member[];
  rules: Skirmish;
  phase: 'gather' | 'fight';
  age: number;
  faceOff: number;
}

export class TurfWar implements Scene {
  readonly borders: TurfBorder[];
  flare: Flare | null = null;
  private tick = 0;
  private readonly standing: [number, number] = [0, 0];

  constructor(private readonly life: SceneCtx) {
    this.borders = turfBorders();
    life.clock.define('turf', { every: [140, 260], cap: 1, first: 75, range: START_RING[1], hold: LOUD });
    const bus = life.d.bus;
    bus.on('punch', (e) => {
      if (e.byPlayer && e.hit) this.struck(e.x, e.z, PUNCH_HIT);
    });
    bus.on('bulletHit', (e) => {
      if (e.byPlayer && e.target === 'ped') this.struck(e.x, e.z, SHOT_HIT);
    });
    bus.on('pedDown', (e) => {
      if (e.byPlayer && !e.isPlayer) this.struck(e.x, e.z, DOWN_HIT);
    });
  }

  get running(): number {
    return this.flare ? 1 : 0;
  }

  /** Start one now (the debug hook): the next step looks for a border, holds permitting. */
  soon(): void {
    this.life.clock.defer('turf', this.life.now, 0);
  }

  step(dt: number): void {
    const f = this.flare;
    if (!f) {
      if (this.life.due('turf', 0)) this.start();
      return;
    }
    f.age += dt;
    if ((this.tick -= dt) > 0) return;
    this.tick = 0.25;
    if (f.phase === 'gather') this.gather(f, 0.25);
    else this.fight(f);
  }

  reset(): void {
    // The director takes the people off itself (they're on its list).
    this.flare = null;
  }

  // --- Internals ------------------------------------------------------------------

  /** A border in range, out of view at both ends: each crew walks in from its end. */
  private start(): void {
    const life = this.life;
    const r = life.d.rand;
    const at = life.d.focus();
    let border: TurfBorder | null = null;
    // A few random picks among the borders in the ring.
    for (let tries = 0; tries < 12 && !border; tries++) {
      const b = this.borders[Math.floor(r() * this.borders.length)];
      const d = len2(b.x - at.x, b.z - at.z);
      if (d < START_RING[0] || !life.near('turf', b.x, b.z)) continue;
      if (life.inView(b.x - b.alongX * WALK_IN, b.z - b.alongZ * WALK_IN, 4) || life.inView(b.x + b.alongX * WALK_IN, b.z + b.alongZ * WALK_IN, 4)) continue;
      border = b;
    }
    if (!border) {
      life.clock.defer('turf', life.now, 4);
      return;
    }
    life.clock.start('turf', life.now);
    const crews: [Crew, Crew] = [border.home, border.away];
    const guns = r() < GUN_CHANCE;
    const f: Flare = { border, crews, members: [], rules: createSkirmish(), phase: 'gather', age: 0, faceOff: 0 };
    for (const side of [0, 1] as const) {
      const crew = crews[side];
      const n = CREW_SIZE[0] + Math.floor(r() * (CREW_SIZE[1] - CREW_SIZE[0] + 1));
      const dir = side === 0 ? -1 : 1;
      for (let i = 0; i < n; i++) {
        // In a loose bunch at their end, walking in.
        const back = WALK_IN + i * 1.2 + r();
        const x = border.x + border.alongX * dir * back + border.alongZ * (r() - 0.5) * 1.2;
        const z = border.z + border.alongZ * dir * back - border.alongX * (r() - 0.5) * 1.2;
        const c = life.addPed(x, z, Math.atan2(-dir * border.alongX, -dir * border.alongZ), { shirt: crew.shirt, pants: crew.pants }, crew.bodies[i % crew.bodies.length]);
        const armed = guns && i === 0;
        c.agent.gang = crew.id;
        c.agent.temper = armed ? 'armed' : 'fighter';
        if (armed) c.gun = 'pistol';
        // To a step short of the middle, squaring up.
        const stop = 1.6 + (i % 2) * 0.9;
        life.walkTo(c, border.x + border.alongX * dir * stop + border.alongZ * (i - n / 2) * 0.9, border.z + border.alongZ * dir * stop - border.alongX * (i - n / 2) * 0.9);
        life.lookAt(c, border.x, border.z);
        f.members.push({ ped: c, side, armed, out: false, judged: false });
      }
    }
    this.flare = f;
    life.emit('turfWar', border.x, border.z);
  }

  /** Walking in; once close (or after a while), a moment's face-off, then they go at it. */
  private gather(f: Flare, dt: number): void {
    let close = true;
    for (const m of f.members) {
      const a = m.ped.agent;
      if (a.mode !== 'arrest') continue;
      if (len2(a.s.x - a.goalX, a.s.z - a.goalZ) > 1.2) close = false;
    }
    if (close || f.age > GATHER_MAX) f.faceOff += dt;
    if (f.faceOff < FACE_OFF && !f.rules.foe[0] && !f.rules.foe[1]) return;
    f.phase = 'fight';
    for (const m of f.members) this.engage(f, m);
  }

  /** The fight: everyone on someone, the badly hurt maybe running, the knocked out handed over, until it's settled. */
  private fight(f: Flare): void {
    const life = this.life;
    const playerNear = this.playerNear(f);
    const standing = this.standing;
    standing[0] = standing[1] = 0;
    for (const m of f.members) {
      if (m.out) continue;
      const c = m.ped;
      const a = c.agent;
      if (!life.present(c) || !a.scene) {
        m.out = true;
        continue;
      }
      if (a.mode === 'down') {
        if (a.ko) this.handOver(m);
        else standing[m.side]++;
        continue;
      }
      if (!m.judged && a.hp < FLEE_HP) {
        m.judged = true;
        if (runsFor(a.hp, life.d.rand())) {
          this.run(f, m);
          continue;
        }
      }
      standing[m.side]++;
      this.engage(f, m);
    }
    if (over(f.rules, standing[0], standing[1], playerNear, f.age)) this.end(f);
  }

  /** Keep `m` in it: on the player if their side's turned, else on the nearest of the other side still standing. */
  private engage(f: Flare, m: Member): void {
    const life = this.life;
    const c = m.ped;
    const a = c.agent;
    if (a.mode === 'down' || m.out) return;
    if (f.rules.foe[m.side]) {
      // After the player (the crowd's own hostility: the player is everyone's default target), while they're about.
      if (life.opponentOf(c)) life.unfight(c);
      if (a.mode !== 'fight' && a.mode !== 'shoot' && this.playerNear(f)) {
        const p = life.d.player.position;
        if (a.mode === 'arrest') a.mode = 'walk';
        provoke(a, p.x, p.z);
      }
      return;
    }
    const o = life.opponentOf(c);
    if (o && (a.mode === 'fight' || a.mode === 'shoot') && o.agent.mode !== 'down' && life.present(o) && !this.isOut(f, o)) return;
    const next = this.nearestFoe(f, m);
    if (!next) {
      // Nobody on their feet to fight just now: stand ready where they are (not wander off).
      if (o) life.unfight(c);
      if (a.mode !== 'arrest') {
        a.mode = 'arrest';
        life.walkTo(c, a.s.x, a.s.z);
      }
      life.lookAt(c, f.border.x, f.border.z);
      return;
    }
    life.setOn(c, next.ped, m.armed, 20);
  }

  /** Is the player in play, alive and close to the skirmish? */
  private playerNear(f: Flare): boolean {
    const d = this.life.d;
    const p = d.player;
    return d.playing() && p.alive && len2(p.position.x - f.border.x, p.position.z - f.border.z) < PLAYER_NEAR;
  }

  private nearestFoe(f: Flare, m: Member): Member | null {
    const s = m.ped.agent.s;
    let best: Member | null = null;
    let bestD = Infinity;
    for (const o of f.members) {
      if (o.side === m.side || o.out || o.ped.agent.mode === 'down') continue;
      const d = len2(o.ped.agent.s.x - s.x, o.ped.agent.s.z - s.z);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  private isOut(f: Flare, c: CrowdPed): boolean {
    for (const m of f.members) if (m.ped === c) return m.out;
    return true;
  }

  /** Badly hurt: off and away from whoever they were fighting; an ordinary passer-by once they stop running. */
  private run(f: Flare, m: Member): void {
    const life = this.life;
    const c = m.ped;
    const o = life.opponentOf(c);
    m.out = true;
    life.giveBack(c);
    const a = c.agent;
    a.mode = 'walk';
    const from = o?.agent.s ?? f.border;
    scare(a, from.x, from.z, 6);
  }

  /** Knocked out: theirs no more; on the street (the ambulance comes for them). */
  private handOver(m: Member): void {
    m.out = true;
    m.ped.agent.street = true;
    this.life.giveBack(m.ped);
  }

  /** Settled (or called off): everyone still about walks off as an ordinary passer-by. */
  private end(f: Flare): void {
    const life = this.life;
    for (const m of f.members) {
      if (m.out) continue;
      m.out = true;
      const c = m.ped;
      if (!life.present(c) || !c.agent.scene) continue;
      if (c.agent.mode === 'down' && c.agent.ko) c.agent.street = true;
      life.giveBack(c);
      if (c.agent.mode === 'arrest') c.agent.mode = 'walk';
    }
    this.flare = null;
  }

  /** The player landed a punch, a shot or a knock-down at (x, z): the side of whoever it was turns on them. */
  private struck(x: number, z: number, reach: number): void {
    const f = this.flare;
    if (!f) return;
    let hit: Member | null = null;
    let bestD = reach;
    for (const m of f.members) {
      if (m.out) continue;
      const s = m.ped.agent.s;
      const d = len2(s.x - x, s.z - z);
      if (d < bestD) {
        bestD = d;
        hit = m;
      }
    }
    if (!hit || !playerStrikes(f.rules, hit.side)) return;
    // Straight into it if they were still squaring up.
    f.phase = 'fight';
    for (const m of f.members) this.engage(f, m);
    // The other side stands with the player (unless they've hit both).
    if (friendly(f.rules, (1 - hit.side) as Side)) this.life.emit('turfWar', x, z);
  }
}

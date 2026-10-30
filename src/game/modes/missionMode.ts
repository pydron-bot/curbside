/**
 * Payphone missions on the screen. Four payphones stand on pavements round
 * the city; the one with a job waiting rings (a pulsing light, the bell when
 * you're near, 'M' on the radar with an arrow). Step up to it (or stop
 * beside it) to answer: the call plays as a card, then the job runs on the
 * mission engine (systems/missions.ts) with its objective on the activity
 * card, its targets on the radar and marked in the street. Pass it for the
 * pay and the next call; fail it and the phone rings again.
 *
 * People a job needs are only put on the street when you're near their spot
 * (the crowd recycles anyone far from the player), and again if they get
 * recycled; cars are pinned so traffic upkeep leaves them alone.
 */
import { driverDoorPosition, speed, type VehicleArchetype } from '../../entities/vehicle';
import type { GlowSprites } from '../../render/glowSprites';
import { MARK, beacon, gate, groundRing, nearView, type ProgressProps } from '../../render/progressLook';
import { provoke, resumeWalking, spawnPed } from '../../systems/crowd';
import { MissionRun, type MissionAction, type MissionDef, type MissionSignal, type MissionStep, type MissionView } from '../../systems/missions';
import { buildMissions } from '../../systems/missionsData';
import type { DialogueCard } from '../../ui/progressScreens';
import type { BlipOptions } from '../../ui/radar';
import { fmt } from '../../ui/scoreHud';
import { BLOCK_SIZE, type Rect } from '../../world/city';
import type { CrowdPed, Vehicle } from '../population';
import { KeyedText, type Mode, type ModeCtx } from './context';
import { SAFEHOUSE, placePayphones, type Spot } from './places';

/** Answering: on foot this close, or stopped in a car this close, m. */
const ANSWER_FOOT = 2.4;
const ANSWER_CAR = 6.5;
/** The bell carries this far, m, every RING_EVERY s. */
const RING_RANGE = 55;
const RING_EVERY = 2.4;
const PROMPT_RANGE = 16;
/** People a job needs appear when you're this close to their spot, m. */
const MATERIALISE = 60;
/** Radar ids for a collect step's points. */
const COLLECT_IDS = Array.from({ length: 16 }, (_, i) => `m-c${i}`);
/** Hostile targets turn on you this close, m. */
const HOSTILE_RANGE = 18;

interface MissionCar {
  tag: string;
  /** Its radar blip id. */
  blipId: string;
  v: Vehicle;
  /** What the engine reads (refreshed on each query). */
  view: { x: number; z: number; wrecked: boolean };
}

interface MissionPed {
  tag: string;
  blipId: string;
  x: number;
  z: number;
  shirt: string;
  armed: boolean;
  hostile: boolean;
  ped: CrowdPed | null;
  /** Knocked down at some point (sticky). */
  down: boolean;
  /** In the player's car. */
  aboard: boolean;
  view: { x: number; z: number; down: boolean };
  wave: number;
}

export class MissionMode implements Mode {
  readonly missions: MissionDef[];
  private readonly phones: Spot[];
  private run: MissionRun | null = null;
  private readonly cars = new Map<string, MissionCar>();
  private readonly peds = new Map<string, MissionPed>();
  /** The same, as arrays: per-step loops without iterator garbage. */
  private readonly carList: MissionCar[] = [];
  private readonly pedList: MissionPed[] = [];
  private readonly goal = new KeyedText();
  /** A one-tag list for marking an 'enter' step's car (reused). */
  private readonly oneTag: string[] = [''];
  /** Radar blips this mission put up (removed when it ends or moves on). */
  private readonly blips = new Set<string>();
  private readonly blipOpts: BlipOptions = { x: 0, z: 0, kind: 'objective', size: 6, pulse: true, edgeArrow: true, icon: '' };
  private ringIn = 0;
  private armed = true;
  private near: Spot | null = null;
  private ringBlip = '';
  private savedClock: number | null = null;
  /** Waiting for the intro card to be dismissed. */
  private calling = false;
  private readonly view: MissionView;

  constructor(
    private readonly ctx: ModeCtx,
    docks: { x: number; z: number },
    private readonly card: DialogueCard,
  ) {
    this.missions = buildMissions(docks, SAFEHOUSE);
    this.phones = placePayphones();
    const self = this;
    this.view = {
      x: 0,
      z: 0,
      inCar: false,
      carTag: null,
      carArchetype: null,
      carHealth: 1,
      speed: 0,
      stars: 0,
      vehicle(tag) {
        const c = self.cars.get(tag);
        if (!c) return null;
        c.view.x = c.v.sim.x;
        c.view.z = c.v.sim.z;
        c.view.wrecked = c.v.damage.wrecked;
        return c.view;
      },
      ped(tag) {
        const m = self.peds.get(tag);
        if (!m || (!m.ped && !m.down)) return null;
        if (m.ped) {
          m.view.x = m.ped.agent.s.x;
          m.view.z = m.ped.agent.s.z;
        }
        m.view.down = m.down;
        return m.view;
      },
    };
    const bus = ctx.deps.bus;
    bus.on('playerDied', () => this.run && this.signal(this.run.fail('WASTED')));
    bus.on('busted', () => this.run && this.signal(this.run.fail('BUSTED')));
  }

  /** The next job (null when the story is done). */
  get next(): MissionDef | null {
    const done = this.ctx.progress.data.missions;
    return this.missions.find((m) => !done.includes(m.id)) ?? null;
  }

  get passed(): number {
    return this.missions.filter((m) => this.ctx.progress.data.missions.includes(m.id)).length;
  }

  private ringingPhone(): Spot | null {
    const ctx = this.ctx;
    if (!ctx.freeRoam || this.run || this.calling || ctx.busy) return null;
    const m = this.next;
    return m ? (this.phones.find((p) => p.id === m.phone) ?? null) : null;
  }

  step(dt: number): void {
    const ctx = this.ctx;
    const phone = this.ringingPhone();
    this.syncRingBlip(phone);
    const run = this.run;
    if (run) {
      this.updateView();
      this.tendPeds(dt);
      const s = run.update(dt, this.view);
      if (s) this.signal(s);
      this.updateBlips();
      return;
    }
    this.near = null;
    if (!phone || !ctx.live) return;
    const at = ctx.deps.player.position;
    const d = Math.hypot(at.x - phone.x, at.z - phone.z);
    if (d < PROMPT_RANGE) this.near = phone;
    if (d < RING_RANGE && (this.ringIn -= dt) <= 0) {
      this.ringIn = RING_EVERY;
      ctx.deps.audio.ui('ring');
    }
    if (d > ANSWER_CAR + 4) this.armed = true;
    const car = ctx.deps.player.driving;
    const close = car ? d < ANSWER_CAR && speed(car.sim) < 3 : d < ANSWER_FOOT;
    if (close && this.armed) {
      this.armed = false;
      this.answer(this.next!);
    }
  }

  /** The intro call, then the job. */
  private answer(m: MissionDef): void {
    const ctx = this.ctx;
    this.calling = true;
    ctx.busy = 'mission';
    ctx.deps.audio.ui('confirm');
    ctx.openModal(this.card);
    this.card.show('INCOMING CALL', m.title, m.intro, `PAYS $${fmt(m.reward)}`, "LET'S GO", ctx.focusRing, () => {
      ctx.closeModal(this.card);
      this.calling = false;
      this.begin(m);
    });
  }

  private begin(m: MissionDef): void {
    const ctx = this.ctx;
    this.run = new MissionRun(m);
    this.goal.reset();
    ctx.busy = 'mission';
    if (m.hour !== undefined) {
      const time = ctx.deps.look.time;
      this.savedClock = time.speed;
      time.set(m.hour);
      time.speed = 0;
    }
    this.signal(this.run.begin());
  }

  /** React to the engine: run actions, update the card and markers, settle the end. */
  private signal(s: MissionSignal): void {
    const ctx = this.ctx;
    const run = this.run;
    if (!run) return;
    switch (s.kind) {
      case 'step':
        if (s.prev) this.act(s.prev.done);
        this.act(s.step.start);
        this.clearBlips();
        if (s.index > 0) ctx.deps.audio.ui('confirm');
        ctx.ui.banner(s.step.text, 'info', '', 2);
        return;
      case 'progress':
        ctx.deps.audio.ui('click');
        return;
      case 'passed': {
        this.act(s.prev.done);
        const m = run.def;
        this.finish();
        ctx.progress.complete('missions', m.id);
        const paid = ctx.pay(m.reward, 'mission', 'MISSION');
        ctx.deps.audio.ui('success');
        ctx.ui.banner('MISSION PASSED', 'gold', `+$${fmt(paid)}`, 2.6);
        ctx.progress.flush();
        const last = this.next === null;
        ctx.openModal(this.card);
        this.card.show(last ? 'STORY COMPLETE' : 'MISSION PASSED', m.title, m.outro, `+$${fmt(paid)}`, 'CONTINUE', ctx.focusRing, () => ctx.closeModal(this.card));
        return;
      }
      case 'failed':
        this.finish();
        if (s.reason !== 'QUIT') {
          ctx.ui.banner('MISSION FAILED', 'fail', s.reason, 3);
          ctx.deps.audio.ui('fail');
        }
        return;
    }
  }

  /** The mission is over either way: tidy up its people, cars, markers and the clock. */
  private finish(): void {
    const ctx = this.ctx;
    this.run = null;
    this.calling = false;
    if (ctx.busy === 'mission') ctx.busy = null;
    this.clearBlips();
    ctx.deps.radar.clearWaypoint();
    for (const c of this.carList) ctx.unpin(c.v);
    this.cars.clear();
    this.carList.length = 0;
    for (const m of this.pedList) {
      if (m.ped && ctx.deps.population.crowd.includes(m.ped) && m.ped.agent.mode === 'arrest') resumeWalking(m.ped.agent);
    }
    this.peds.clear();
    this.pedList.length = 0;
    if (this.savedClock !== null) {
      ctx.deps.look.time.speed = this.savedClock;
      this.savedClock = null;
    }
    this.armed = false;
  }

  private act(actions: readonly MissionAction[] | undefined): void {
    if (!actions) return;
    const ctx = this.ctx;
    const { player, heat } = ctx.deps;
    for (const a of actions) {
      switch (a.do) {
        case 'spawnCar': {
          const v = ctx.spawnCar(a.archetype, a.paint, a.x, a.z, a.heading);
          const car: MissionCar = { tag: a.tag, blipId: `m-${a.tag}`, v, view: { x: a.x, z: a.z, wrecked: false } };
          this.cars.set(a.tag, car);
          this.carList.push(car);
          break;
        }
        case 'spawnPed':
          const ped: MissionPed = {
            tag: a.tag,
            blipId: `m-${a.tag}`,
            x: a.x,
            z: a.z,
            shirt: a.shirt ?? '#e5e5e5',
            armed: a.armed === true,
            hostile: a.hostile === true,
            ped: null,
            down: false,
            aboard: false,
            view: { x: a.x, z: a.z, down: false },
            wave: 0,
          };
          this.peds.set(a.tag, ped);
          this.pedList.push(ped);
          break;
        case 'wanted':
          heat.wanted.force(a.stars);
          break;
        case 'give':
          player.arsenal.pickUp(a.weapon);
          player.arsenal.current = a.weapon;
          ctx.notice(`+ ${a.weapon.toUpperCase()}`, 'weapon');
          break;
        case 'board': {
          const m = this.peds.get(a.tag);
          if (m) {
            if (m.ped) ctx.deps.population.removePed(m.ped);
            m.ped = null;
            m.aboard = true;
          }
          break;
        }
        case 'alight': {
          const car = player.driving ?? player.lastDriven;
          const m = this.peds.get(a.tag);
          if (m) m.aboard = false;
          if (!car) break;
          const door = driverDoorPosition(car.sim);
          const agent = spawnPed(0, 0, 0, 0, ctx.deps.rand);
          agent.temper = 'calm';
          Object.assign(agent.s, { x: door.x, z: door.z, vx: 0, vz: 0, heading: car.sim.heading });
          resumeWalking(agent);
          ctx.deps.population.addPed(agent, { shirt: m?.shirt ?? '#e5e5e5' });
          break;
        }
      }
    }
  }

  private updateView(): void {
    const { player, heat } = this.ctx.deps;
    const v = this.view;
    const at = player.position;
    const car = player.driving;
    v.x = at.x;
    v.z = at.z;
    v.inCar = car !== null && !car.damage.wrecked;
    v.carTag = null;
    if (car) for (const c of this.carList) if (c.v === car) v.carTag = c.tag;
    v.carArchetype = car ? (car.archetype as VehicleArchetype) : null;
    v.carHealth = car ? car.damage.health / car.damage.maxHealth : 0;
    v.speed = Math.hypot(at.vx, at.vz);
    v.stars = heat.wanted.level;
  }

  /** Put the job's people on the street when you're near, keep them waiting, turn hostiles on you. */
  private tendPeds(dt: number): void {
    const ctx = this.ctx;
    const pop = ctx.deps.population;
    const at = ctx.deps.player.position;
    for (const m of this.pedList) {
      if (m.aboard || m.down) continue;
      if (m.ped && !pop.crowd.includes(m.ped)) {
        // Recycled out of sight: they'll be back where they were.
        m.x = m.ped.agent.s.x;
        m.z = m.ped.agent.s.z;
        m.ped = null;
      }
      if (!m.ped) {
        if (Math.hypot(at.x - m.x, at.z - m.z) > MATERIALISE) continue;
        const agent = spawnPed(0, 0, 0, 0, ctx.deps.rand);
        Object.assign(agent.s, { x: m.x, z: m.z, vx: 0, vz: 0 });
        agent.temper = m.armed ? 'armed' : m.hostile ? 'fighter' : 'calm';
        agent.mode = 'arrest';
        agent.goalX = m.x;
        agent.goalZ = m.z;
        m.ped = pop.addPed(agent, { shirt: m.shirt, pants: '#1d1d24' });
      }
      const a = m.ped.agent;
      if (a.mode === 'down') {
        m.down = true;
        continue;
      }
      const d = Math.hypot(at.x - a.s.x, at.z - a.s.z);
      if (m.hostile) {
        if (a.mode === 'arrest' && d < HOSTILE_RANGE && ctx.live) provoke(a, at.x, at.z);
        continue;
      }
      // Someone waiting for a lift: stays put (after any scare) and waves when you're close.
      if (a.mode === 'walk') {
        a.mode = 'arrest';
        a.goalX = a.s.x;
        a.goalZ = a.s.z;
      }
      if (a.mode === 'arrest' && d < 45 && (m.wave -= dt) <= 0) {
        m.wave = 0.8;
        m.ped.model.punch();
        a.s.heading = Math.atan2(at.x - a.s.x, at.z - a.s.z);
      }
    }
  }

  /** Radar: the step's targets (and a route to a place). */
  private updateBlips(): void {
    const run = this.run;
    const s = run?.step;
    if (!run || !s) return;
    const radar = this.ctx.deps.radar;
    switch (s.kind) {
      case 'goto':
      case 'deliver':
        this.point('m-goal', s.x, s.z, 'objective', '');
        radar.setWaypoint(s.x, s.z);
        if (s.kind === 'deliver' && s.tag && this.ctx.deps.player.driving !== this.cars.get(s.tag)?.v) this.carBlip(s.tag, 'objective');
        break;
      case 'enter':
        if (s.tag) this.carBlip(s.tag, 'objective');
        break;
      case 'pickup':
      case 'knockOut': {
        const m = this.peds.get(s.tag);
        if (!m) break;
        const x = m.ped ? m.ped.agent.s.x : m.x;
        const z = m.ped ? m.ped.agent.s.z : m.z;
        this.point(m.blipId, x, z, s.kind === 'knockOut' ? 'enemy' : 'objective', '');
        if (!m.ped) radar.setWaypoint(x, z);
        else radar.clearWaypoint();
        break;
      }
      case 'destroy':
        for (const tag of s.tags) {
          const c = this.cars.get(tag);
          if (c && !c.v.damage.wrecked) this.carBlip(tag, 'enemy');
          else if (c) this.drop(c.blipId);
        }
        break;
      case 'collect':
        for (let i = 0; i < s.points.length; i++) {
          if (run.collected[i]) this.drop(COLLECT_IDS[i]);
          else this.point(COLLECT_IDS[i], s.points[i][0], s.points[i][1], 'objective', '');
        }
        break;
      case 'race': {
        const n = s.nodes[run.next];
        if (n) {
          this.point('m-goal', n[0] * BLOCK_SIZE, n[1] * BLOCK_SIZE, 'race', String(run.next + 1));
          radar.setWaypoint(n[0] * BLOCK_SIZE, n[1] * BLOCK_SIZE);
        }
        break;
      }
      default:
        break;
    }
  }

  private carBlip(tag: string, kind: 'objective' | 'enemy'): void {
    const c = this.cars.get(tag);
    if (c) this.point(c.blipId, c.v.sim.x, c.v.sim.z, kind, '');
  }

  private point(id: string, x: number, z: number, kind: 'objective' | 'enemy' | 'race', icon: string): void {
    const b = this.blipOpts;
    b.x = x;
    b.z = z;
    b.kind = kind;
    b.icon = icon;
    b.colour = undefined;
    this.ctx.blip(id, b);
    this.blips.add(id);
  }

  private drop(id: string): void {
    if (this.blips.delete(id)) this.ctx.unblip(id);
  }

  private clearBlips(): void {
    for (const id of this.blips) this.ctx.unblip(id);
    this.blips.clear();
    this.ctx.deps.radar.clearWaypoint();
  }

  private syncRingBlip(phone: Spot | null): void {
    const id = phone?.id ?? '';
    if (id === this.ringBlip) return;
    if (this.ringBlip) this.ctx.unblip(this.ringBlip);
    this.ringBlip = id;
    if (phone) this.ctx.blip(phone.id, { x: phone.x, z: phone.z, kind: 'friend', icon: 'M', size: 6, pulse: true, edgeArrow: true });
  }

  hud(): boolean {
    const run = this.run;
    const s = run?.step;
    if (!run || !s) return false;
    const ui = this.ctx.ui;
    ui.activity(run.def.title);
    if (s.kind === 'survive') ui.timer(Math.max(0, s.seconds - run.stepTime), false, 0);
    else ui.timer(run.timeLeft, run.timeLeft !== null && run.timeLeft <= 10, 0);
    // The step's text, with a count for the steps that have one; rebuilt when either changes.
    let n = 0;
    if (s.kind === 'collect') for (const got of run.collected) n += got ? 1 : 0;
    else if (s.kind === 'destroy') n = run.destroyed;
    else if (s.kind === 'race') n = run.next;
    if (this.goal.stale(run.index * 1000 + n)) this.goal.text = this.goalText(s, n);
    ui.goal(this.goal.text);
    return true;
  }

  private goalText(s: MissionStep, n: number): string {
    if (s.kind === 'collect') return `${s.text} · ${n}/${s.points.length}`;
    if (s.kind === 'destroy') return `${s.text} · ${n}/${s.tags.length}`;
    if (s.kind === 'race') return `${s.text} · ${n}/${s.nodes.length}`;
    return s.text;
  }

  prompt(): string | null {
    if (!this.near || this.run || this.calling) return null;
    return this.ctx.deps.player.driving ? 'PAYPHONE RINGING · STOP BESIDE IT TO ANSWER' : 'PAYPHONE RINGING · STEP UP TO ANSWER';
  }

  glow(g: GlowSprites, props: ProgressProps, view: Rect, t: number): void {
    const ringing = this.ringingPhone();
    if (this.ctx.freeRoam) {
      for (const p of this.phones) {
        if (!nearView(p.x, p.z, view)) continue;
        const on = p === ringing;
        // The booth: a dark kiosk with a lit top.
        props.box(p.x, 1.05, p.z, 0.75, 2.1, 0.55, 0, 0.08, 0.32, 0.3);
        if (on) {
          // Ringing: rings rippling out, in time with the bell.
          const phase = (t * 1.6) % 1;
          groundRing(g, p.x, p.z, 2 + phase * 4, MARK.phone, 1 - phase, 0);
          beacon(g, p.x, p.z, 1, 7, MARK.phone, 0.55 + 0.25 * Math.sin(t * 12));
        } else groundRing(g, p.x, p.z, 2, MARK.phone, 0.25, 0);
      }
    }
    const run = this.run;
    const s = run?.step;
    if (!run || !s) return;
    const c = MARK.objective;
    const pulse = 0.75 + 0.25 * Math.sin(t * 5);
    switch (s.kind) {
      case 'goto':
      case 'deliver':
        if (nearView(s.x, s.z, view, 10)) {
          groundRing(g, s.x, s.z, (s.r ?? 6) * 2, c, pulse, t * 0.5);
          beacon(g, s.x, s.z, 1.6, 14, c, 0.55);
        }
        break;
      case 'collect':
        for (let i = 0; i < s.points.length; i++) {
          if (run.collected[i]) continue;
          const [x, z] = s.points[i];
          if (!nearView(x, z, view)) continue;
          groundRing(g, x, z, 3, c, pulse, t);
          beacon(g, x, z, 0.9, 6, c, 0.5);
          props.box(x, 0.55 + Math.sin(t * 3 + i) * 0.1, z, 0.7, 0.5, 0.5, t * 1.5 + i, 1, 0.55, 0.12);
        }
        break;
      case 'race': {
        const n = s.nodes[run.next];
        if (n && nearView(n[0] * BLOCK_SIZE, n[1] * BLOCK_SIZE, view, 14)) {
          const prev = run.next > 0 ? s.nodes[run.next - 1] : null;
          const heading = prev ? Math.atan2(n[0] - prev[0], n[1] - prev[1]) : 0;
          gate(g, n[0] * BLOCK_SIZE, n[1] * BLOCK_SIZE, heading, 16, MARK.race, pulse, t);
        }
        break;
      }
      case 'enter':
      case 'destroy': {
        let tags: readonly string[] = s.kind === 'destroy' ? s.tags : [];
        if (s.kind === 'enter' && s.tag) {
          this.oneTag[0] = s.tag;
          tags = this.oneTag;
        }
        for (const tag of tags) {
          const car = this.cars.get(tag)?.v;
          if (!car || car.damage.wrecked || !nearView(car.sim.x, car.sim.z, view)) continue;
          groundRing(g, car.sim.x, car.sim.z, 7, s.kind === 'destroy' ? MARK.target : c, pulse, t);
        }
        break;
      }
      case 'pickup':
      case 'knockOut': {
        const m = this.peds.get(s.tag);
        const ped = m?.ped;
        if (!ped || !nearView(ped.agent.s.x, ped.agent.s.z, view)) break;
        const col = s.kind === 'knockOut' ? MARK.target : MARK.taxi;
        groundRing(g, ped.agent.s.x, ped.agent.s.z, 2.4, col, pulse, t);
        beacon(g, ped.agent.s.x, ped.agent.s.z, 0.8, 5, col, 0.5);
        break;
      }
      default:
        break;
    }
  }

  /** Quit, restart, a mode taking over: the job is off, quietly. */
  reset(): void {
    if (this.run) this.signal(this.run.fail('QUIT'));
    if (this.calling) {
      this.calling = false;
      if (this.ctx.busy === 'mission') this.ctx.busy = null;
    }
    this.armed = true;
    this.syncRingBlip(null);
  }
}

/**
 * Payphone missions on the screen. Four payphones stand on pavements round
 * the city; one with a job waiting rings (a pulsing light, the bell when
 * you're near, 'M' on the radar with an arrow, a moon for the Night Shift).
 * Each arc rings for its own next job: the main story by day and in the
 * evening from the city's phones, the Night Shift after dark from the
 * docks-yard phone, so both can ring at once but never the same phone.
 * Step up to one (or stop beside it) to answer: the call plays as a card,
 * then the job runs on the mission engine (systems/missions.ts) with its
 * objective on the activity card, its targets on the radar and marked in
 * the street. Pass it for the pay and the arc's next call; fail it and the
 * phone rings again. Once an arc is done its phone rings with its jobs
 * again, in order, as REPEAT JOBs (for part of the pay, no completion).
 * Score awards feed a mayhem step; a job's scenes go through storyScenes
 * (sceneStarter.ts) and stop being featured when it ends, however it ends.
 *
 * People a job needs are only put on the street when you're near their spot
 * (the crowd recycles anyone far from the player), and again if they get
 * recycled; cars are pinned so traffic upkeep leaves them alone.
 */
import { driverDoorPosition, speed, type VehicleArchetype } from '../../entities/vehicle';
import type { GlowSprites } from '../../render/glowSprites';
import { MARK, beacon, gate, groundRing, nearView, type ProgressProps } from '../../render/progressLook';
import { provoke, resumeWalking, spawnPed } from '../../systems/crowd';
import {
  arcOf,
  arcRings,
  endsChapter,
  inArea,
  MissionRun,
  MissionScenes,
  nextInArc,
  replayReward,
  type MissionAction,
  type MissionArc,
  type MissionDef,
  type MissionSignal,
  type MissionStep,
  type MissionView,
  type SceneHost,
} from '../../systems/missions';
import { buildMissions } from '../../systems/missionsData';
import type { DialogueCard } from '../../ui/progressScreens';
import type { BlipOptions } from '../../ui/radar';
import { fmt } from '../../ui/scoreHud';
import { driverFor } from '../../systems/traffic';
import { BLOCK_SIZE, type Rect } from '../../world/city';
import { STORY_BODIES, type BodyKind } from '../bodies';
import type { CrowdPed, Vehicle } from '../population';
import { KeyedText, type Mode, type ModeCtx } from './context';
import { CAR_NAMES } from './exports';
import { SAFEHOUSE, placePayphones, type Spot } from './places';
import { len2 } from '../../core/len';
import type { LabelSink } from '../debugLabels';

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
/** "STEAL A SEDAN" with no particular car: the nearest few that would do are ringed and on the radar. */
const MATCH_IDS = ['m-match0', 'm-match1', 'm-match2'];
const MATCH_RANGE = 140;
/** Hostile targets turn on you this close, m. */
const HOSTILE_RANGE = 18;
/** The ringing phone's radar icon, by arc (the Night Shift's is a moon). */
const RING_ICON: Readonly<Record<MissionArc, string>> = { main: 'M', night: '☾' };
/** The call card's kicker, by arc. */
const CALL_HEAD: Readonly<Record<MissionArc, string>> = { main: 'INCOMING CALL', night: '☾ NIGHT SHIFT' };

/** One arc's phone: its next job (worked out again when one is passed) and its radar blip. */
interface ArcPhone {
  arc: MissionArc;
  /** Its jobs, in order. */
  jobs: MissionDef[];
  /** The next job (undefined: stale), and whether it's a repeat. */
  next: MissionDef | null | undefined;
  replay: boolean;
  /** The radar blip up for it ('' for none). */
  blip: string;
}

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
  /** Shirt colour (story characters keep their own: undefined). */
  shirt: string | undefined;
  /** Who they're drawn as (a crowd body if unset). */
  body: BodyKind | undefined;
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
  /** The cars an archetype-only enter / deliver step would take, nearest first (refreshed every step). */
  private readonly matches: Vehicle[] = [];
  private readonly matchD2: number[] = [];
  /** Radar blips this mission put up (removed when it ends or moves on). */
  private readonly blips = new Set<string>();
  private readonly blipOpts: BlipOptions = { x: 0, z: 0, kind: 'objective', size: 6, pulse: true, edgeArrow: true, icon: '' };
  /** The waypoint last sent to the radar (it's only told about changes). */
  private wpX = NaN;
  private wpZ = NaN;
  /** Payphones by id. */
  private readonly phoneById: Map<string, Spot>;
  /** The main story's phone, then the Night Shift's. */
  private readonly arcs: ArcPhone[];
  /** The job running (or being called about) is a repeat. */
  private replaying = false;
  private ringIn = 0;
  private armed = true;
  private near: Spot | null = null;
  /** The scenes the job running asked for, and the city's starter for them (main.ts: useScenes). */
  private readonly scenes = new MissionScenes();
  private sceneHost: SceneHost | null = null;
  /** The clock before a job pinned it (MIDNIGHT EXPRESS): its speed, and the hour a failed job puts back. */
  private savedClock: { speed: number; hour: number } | null = null;
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
    this.phoneById = new Map(this.phones.map((p) => [p.id, p]));
    this.arcs = (['main', 'night'] as const).map((arc) => ({ arc, jobs: this.missions.filter((m) => arcOf(m) === arc), next: undefined, replay: false, blip: '' }));
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
    // Wrong car for "STEAL A SEDAN": say so (from above a sedan and a taxi look alike).
    bus.on('enterVehicle', (e) => {
      const want = this.wantedArchetype();
      if (want && e.archetype !== want) ctx.notice(`NOT A ${CAR_NAMES[want]}`, 'lost');
    });
    // Chaos for a mayhem step (its area is checked against where the player is).
    bus.on('award', (e) => {
      if (this.run && ctx.live) this.run.award(e.award.points, this.view);
    });
    bus.on('playerDied', () => this.run && this.signal(this.run.fail('WASTED')));
    bus.on('busted', () => this.run && this.signal(this.run.fail('BUSTED')));
  }

  /** `arc`'s next job: its story's, or a repeat once it's done. Cached: it's asked every step and frame. */
  nextOf(arc: MissionArc): MissionDef | null {
    return this.nextIn(this.arcOf(arc));
  }

  private nextIn(a: ArcPhone): MissionDef | null {
    if (a.next === undefined) {
      const save = this.ctx.progress.data;
      const n = nextInArc(a.jobs, a.arc, save.missions, save.stats.jobsReplayed);
      a.next = n?.job ?? null;
      a.replay = n?.replay ?? false;
    }
    return a.next;
  }

  private arcOf(arc: MissionArc): ArcPhone {
    return arc === 'main' ? this.arcs[0] : this.arcs[1];
  }

  /** `arc`'s jobs, in order. */
  jobsIn(arc: MissionArc): readonly MissionDef[] {
    return this.arcOf(arc).jobs;
  }

  /** The save's missions changed under it (the TEST menu): work the next jobs out again. */
  refresh(): void {
    for (const a of this.arcs) a.next = undefined;
  }

  /** How many of `arc`'s jobs the save has passed. */
  passedIn(arc: MissionArc): number {
    const done = this.ctx.progress.data.missions;
    return this.arcOf(arc).jobs.filter((m) => done.includes(m.id)).length;
  }

  /** The city's scene starter for the jobs' 'scene' actions (main.ts, once the TEST tools have one). */
  useScenes(host: SceneHost): void {
    this.sceneHost = host;
  }

  /** A payphone ringing with a job, the main story's first (for the first-run pointer). */
  get ringing(): Spot | null {
    return this.ringingPhone(this.arcs[0]) ?? this.ringingPhone(this.arcs[1]);
  }

  /** The phone `a` rings, if it's ringing now (free roam, nothing on, its hours). */
  private ringingPhone(a: ArcPhone): Spot | null {
    const ctx = this.ctx;
    if (!ctx.freeRoam || this.run || this.calling || ctx.busy) return null;
    if (!arcRings(a.arc, ctx.deps.look.time.hour)) return null;
    const m = this.nextIn(a);
    return m ? (this.phoneById.get(m.phone) ?? null) : null;
  }

  step(dt: number): void {
    const ctx = this.ctx;
    // The nearest ringing phone is the one to answer.
    const at = ctx.deps.player.position;
    let phone: Spot | null = null;
    let arc: ArcPhone | null = null;
    let d = Infinity;
    for (const a of this.arcs) {
      const p = this.ringingPhone(a);
      this.syncRingBlip(a, p);
      if (!p) continue;
      const pd = len2(at.x - p.x, at.z - p.z);
      if (pd < d) {
        d = pd;
        phone = p;
        arc = a;
      }
    }
    const run = this.run;
    if (run) {
      this.updateView();
      this.tendPeds(dt);
      const started = this.scenes.step(dt, at.x, at.z, this.sceneHost);
      if (started) ctx.deps.audio.ui('click');
      const s = run.update(dt, this.view);
      if (s) this.signal(s);
      this.updateBlips();
      return;
    }
    this.near = null;
    if (!phone || !arc || !ctx.live) return;
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
      this.answer(this.nextIn(arc)!, arc.replay);
    }
  }

  /**
   * Start a job straight away, without a call (a `direct` job: the cold
   * open). False if something else is on.
   */
  beginNow(m: MissionDef): boolean {
    const ctx = this.ctx;
    if (this.run || this.calling || ctx.busy || !this.missions.includes(m)) return false;
    this.replaying = false;
    this.begin(m);
    return true;
  }

  /** The intro call, then the job. */
  private answer(m: MissionDef, replay: boolean): void {
    const ctx = this.ctx;
    this.calling = true;
    this.replaying = replay;
    ctx.busy = 'mission';
    ctx.deps.audio.ui('confirm');
    // Nothing left over (a frenzy's PASSED) showing round the card.
    ctx.ui.clearBanner();
    ctx.openModal(this.card);
    const head = this.replaying ? 'REPEAT JOB' : CALL_HEAD[arcOf(m)];
    this.card.show(head, m.title, m.intro, `PAYS $${fmt(this.reward(m))}`, "LET'S GO", ctx.focusRing, () => {
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
      this.savedClock = { speed: time.speed, hour: time.hour };
      time.set(m.hour);
      time.speed = 0;
    }
    ctx.deps.audio.missionCue('start', this.missions.indexOf(m));
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
        const arc = this.arcOf(arcOf(m));
        const replay = this.replaying;
        this.finish(true);
        // A repeat counts toward the rotation, not completion.
        if (replay) ctx.progress.data.stats.jobsReplayed++;
        else ctx.progress.complete('missions', m.id);
        ctx.progress.markDirty();
        this.refresh();
        const paid = ctx.pay(this.reward(m, replay), 'mission', replay ? 'REPEAT JOB' : 'MISSION');
        // Whoever's on foot at the finish (you, Vex, Tuna) cheers.
        const at = ctx.deps.player.position;
        ctx.deps.bus.emit({ type: 'celebrate', x: at.x, z: at.z });
        // The debrief card says MISSION PASSED and the pay (no banner under it).
        ctx.deps.audio.missionCue('passed', this.missions.indexOf(m));
        ctx.progress.flush();
        // Just passed the arc's last job: what it rings with next is a repeat.
        const last = !replay && this.nextIn(arc) !== null && arc.replay;
        // A step's objective line can still be up (a quick last step): not behind the debrief.
        ctx.ui.clearBanner();
        ctx.openModal(this.card);
        const done = arc.arc === 'night' ? 'NIGHT SHIFT COMPLETE' : 'STORY COMPLETE';
        const head = replay ? 'JOB DONE' : last ? done : endsChapter(arc.jobs, m) ? `CHAPTER ${m.chapter ?? 1} COMPLETE` : 'MISSION PASSED';
        this.card.show(head, m.title, m.outro, `+$${fmt(paid)}`, 'CONTINUE', ctx.focusRing, () => ctx.closeModal(this.card));
        return;
      }
      case 'failed':
        this.finish();
        if (s.reason !== 'QUIT') {
          ctx.ui.banner('MISSION FAILED', 'fail', s.reason, 3);
          // Dead or nicked: the WASTED / BUSTED sting already says so (two hooks at once would clash).
          if (s.reason !== 'WASTED' && s.reason !== 'BUSTED') ctx.deps.audio.missionCue('failed', this.missions.indexOf(run.def));
        }
        return;
    }
  }

  /**
   * The mission is over either way: tidy up its people, cars, markers and the
   * clock (a pass keeps the night it ran in; a fail or quit puts the hour back,
   * so one failed attempt doesn't jump the city hours into the night).
   */
  private finish(passed = false): void {
    const ctx = this.ctx;
    this.run = null;
    // Its scenes play on, but nothing is featured for it any more.
    this.scenes.end(this.sceneHost);
    this.calling = false;
    this.replaying = false;
    if (ctx.busy === 'mission') ctx.busy = null;
    this.clearBlips();
    this.matches.length = 0;
    for (const c of this.carList) ctx.unpin(c.v);
    this.cars.clear();
    this.carList.length = 0;
    for (const m of this.pedList) {
      // A passed job's story characters stay put to cheer (the crowd recycles them once you're gone).
      if (passed && m.body && STORY_BODIES.includes(m.body)) continue;
      if (m.ped && ctx.deps.population.crowd.includes(m.ped) && m.ped.agent.mode === 'arrest') resumeWalking(m.ped.agent);
    }
    this.peds.clear();
    this.pedList.length = 0;
    if (this.savedClock !== null) {
      const time = ctx.deps.look.time;
      if (!passed) time.set(this.savedClock.hour);
      time.speed = this.savedClock.speed;
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
          // A driven target pulls out into traffic (it stays pinned, so upkeep never recycles it).
          if (a.drive) v.ai = driverFor(v.sim, ctx.deps.rand);
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
            shirt: a.shirt ?? (a.body && STORY_BODIES.includes(a.body) ? undefined : '#e5e5e5'),
            body: a.body,
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
          const story = m?.body !== undefined && STORY_BODIES.includes(m.body);
          if (story) {
            // A story character stands by the car (to cheer the finish) rather than wandering off.
            agent.mode = 'arrest';
            agent.goalX = door.x;
            agent.goalZ = door.z;
          } else resumeWalking(agent);
          ctx.deps.population.addPed(agent, story ? undefined : { shirt: m?.shirt ?? '#e5e5e5' }, m?.body);
          break;
        }
        case 'scene':
          this.scenes.request(a);
          break;
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
    v.speed = len2(at.vx, at.vz);
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
        if (len2(at.x - m.x, at.z - m.z) > MATERIALISE) continue;
        const agent = spawnPed(0, 0, 0, 0, ctx.deps.rand);
        Object.assign(agent.s, { x: m.x, z: m.z, vx: 0, vz: 0 });
        agent.temper = m.armed ? 'armed' : m.hostile ? 'fighter' : 'calm';
        agent.mode = 'arrest';
        agent.goalX = m.x;
        agent.goalZ = m.z;
        m.ped = pop.addPed(agent, m.shirt === undefined ? undefined : { shirt: m.shirt, pants: '#1d1d24' }, m.body);
      }
      const a = m.ped.agent;
      if (a.mode === 'down') {
        m.down = true;
        continue;
      }
      const d = len2(at.x - a.s.x, at.z - a.s.z);
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
        m.ped.model.hail(1.1);
        a.s.heading = Math.atan2(at.x - a.s.x, at.z - a.s.z);
      }
    }
  }

  /** What a job pays: the story reward, or a repeat's share. */
  private reward(m: MissionDef, replay = this.replaying): number {
    return replay ? replayReward(m) : m.reward;
  }

  /** Radar: the step's targets (and a route to a place). */
  private updateBlips(): void {
    const run = this.run;
    const s = run?.step;
    if (!run || !s) return;
    this.matchBlips();
    switch (s.kind) {
      case 'goto':
      case 'deliver':
        this.point('m-goal', s.x, s.z, 'objective', '');
        this.waypoint(s.x, s.z);
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
        if (!m.ped) this.waypoint(x, z);
        else this.noWaypoint();
        break;
      }
      case 'destroy':
        for (const tag of s.tags) {
          const c = this.cars.get(tag);
          if (c && !c.v.damage.wrecked) this.carBlip(tag, 'enemy');
          else if (c) this.drop(c.blipId);
        }
        break;
      case 'knockOutAll': {
        // Each still standing; the route to the first not in the street yet.
        let routed = false;
        for (const tag of s.tags) {
          const m = this.peds.get(tag);
          if (!m) continue;
          if (m.down) {
            this.drop(m.blipId);
            continue;
          }
          const x = m.ped ? m.ped.agent.s.x : m.x;
          const z = m.ped ? m.ped.agent.s.z : m.z;
          this.point(m.blipId, x, z, 'enemy', '');
          if (!m.ped && !routed) {
            this.waypoint(x, z);
            routed = true;
          }
        }
        if (!routed) this.noWaypoint();
        break;
      }
      case 'mayhem': {
        // Outside its area: the radar points there.
        const a = s.near;
        if (!a) break;
        const at = this.ctx.deps.player.position;
        if (inArea(a, at.x, at.z, this.view)) {
          this.drop('m-goal');
          this.noWaypoint();
        } else {
          this.point('m-goal', a.x, a.z, 'objective', '');
          this.waypoint(a.x, a.z);
        }
        break;
      }
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
          this.waypoint(n[0] * BLOCK_SIZE, n[1] * BLOCK_SIZE);
        }
        break;
      }
      default:
        break;
    }
  }

  /** The archetype the current step wants you in, when any car of it will do and you're not in one. */
  private wantedArchetype(): VehicleArchetype | null {
    const s = this.run?.step;
    if (!s || (s.kind !== 'enter' && s.kind !== 'deliver') || s.tag || !s.archetype) return null;
    const car = this.ctx.deps.player.driving;
    return car && car.archetype === s.archetype ? null : s.archetype;
  }

  /** Radar blips on the nearest cars that would do (see matches). */
  private matchBlips(): void {
    const m = this.matches;
    m.length = 0;
    this.matchD2.length = 0;
    const want = this.wantedArchetype();
    if (want) {
      const at = this.ctx.deps.player.position;
      for (const v of this.ctx.deps.vehicles) {
        if (v.archetype !== want || v.damage.wrecked || v.exported || v.police) continue;
        const dx = v.sim.x - at.x;
        const dz = v.sim.z - at.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > MATCH_RANGE * MATCH_RANGE) continue;
        // Insert in order, keeping the nearest few (no allocation: this runs every step).
        const near = this.matchD2;
        let i = m.length;
        while (i > 0 && near[i - 1] > d2) i--;
        if (i >= MATCH_IDS.length) continue;
        for (let j = Math.min(m.length, MATCH_IDS.length - 1); j > i; j--) {
          m[j] = m[j - 1];
          near[j] = near[j - 1];
        }
        m[i] = v;
        near[i] = d2;
      }
    }
    for (let i = 0; i < MATCH_IDS.length; i++) {
      const v = m[i];
      if (v) this.point(MATCH_IDS[i], v.sim.x, v.sim.z, 'objective', '');
      else this.drop(MATCH_IDS[i]);
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
    this.wpX = this.wpZ = NaN;
    this.ctx.deps.radar.clearWaypoint();
  }

  /** Route the radar to (x, z), telling it only when that changes (it allocates). */
  private waypoint(x: number, z: number): void {
    if (x === this.wpX && z === this.wpZ) return;
    this.wpX = x;
    this.wpZ = z;
    this.ctx.deps.radar.setWaypoint(x, z);
  }

  private noWaypoint(): void {
    if (Number.isNaN(this.wpX)) return;
    this.wpX = this.wpZ = NaN;
    this.ctx.deps.radar.clearWaypoint();
  }

  private syncRingBlip(a: ArcPhone, phone: Spot | null): void {
    const id = phone?.id ?? '';
    if (id === a.blip) return;
    if (a.blip) this.ctx.unblip(a.blip);
    a.blip = id;
    if (phone) this.ctx.blip(phone.id, { x: phone.x, z: phone.z, kind: 'friend', icon: RING_ICON[a.arc], size: 6, pulse: true, edgeArrow: true });
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
    else if (s.kind === 'destroy' || s.kind === 'knockOutAll') n = run.destroyed;
    else if (s.kind === 'race') n = run.next;
    else if (s.kind === 'mayhem') n = Math.min(s.points, Math.floor(run.mayhem));
    if (this.goal.stale(run.index * 1e7 + n)) this.goal.text = this.goalText(s, n);
    ui.goal(this.goal.text);
    return true;
  }

  private goalText(s: MissionStep, n: number): string {
    if (s.kind === 'collect') return `${s.text} · ${n}/${s.points.length}`;
    if (s.kind === 'destroy') return `${s.text} · ${n}/${s.tags.length}`;
    if (s.kind === 'race') return `${s.text} · ${n}/${s.nodes.length}`;
    if (s.kind === 'knockOutAll') return `${s.text} · ${n}/${s.tags.length}`;
    if (s.kind === 'mayhem') return `${s.text} · ${fmt(n)} / ${fmt(s.points)}`;
    return s.text;
  }

  prompt(): string | null {
    if (!this.near || this.run || this.calling) return null;
    return this.ctx.deps.player.driving ? 'PAYPHONE RINGING · STOP BESIDE IT TO ANSWER' : 'PAYPHONE RINGING · STEP UP TO ANSWER';
  }

  glow(g: GlowSprites, props: ProgressProps, view: Rect, t: number): void {
    const main = this.ringingPhone(this.arcs[0]);
    const night = this.ringingPhone(this.arcs[1]);
    if (this.ctx.freeRoam) {
      for (const p of this.phones) {
        if (!nearView(p.x, p.z, view)) continue;
        const on = p === main || p === night;
        // The booth: the payphone model stands beside the spot (world props); until it's in, a dark kiosk.
        if (!props.modelled) props.box(p.x, 1.05, p.z, 0.75, 2.1, 0.55, 0, 0.08, 0.32, 0.3);
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
    // Any car of the archetype will do: the nearest few are ringed.
    for (const v of this.matches) if (nearView(v.sim.x, v.sim.z, view)) groundRing(g, v.sim.x, v.sim.z, 7, c, pulse, t);
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
          const bob = Math.sin(t * 3 + i) * 0.1;
          if (props.modelled) props.model('package', x, 0.3 + bob, z, t * 1.5 + i, 1.8, 1, 1, 1, 0.3);
          else props.box(x, 0.55 + bob, z, 0.7, 0.5, 0.5, t * 1.5 + i, 1, 0.55, 0.12);
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
      case 'knockOutAll':
        for (const tag of s.tags) {
          const m = this.peds.get(tag);
          const ped = m?.ped;
          if (!ped || m.down || !nearView(ped.agent.s.x, ped.agent.s.z, view)) continue;
          groundRing(g, ped.agent.s.x, ped.agent.s.z, 2.4, MARK.target, pulse, t);
          beacon(g, ped.agent.s.x, ped.agent.s.z, 0.8, 5, MARK.target, 0.5);
        }
        break;
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
    for (const a of this.arcs) this.syncRingBlip(a, null);
  }

  /** Debug labels: the job's people (story characters by name) and cars by their tags. */
  describe(out: LabelSink): void {
    for (const m of this.pedList) {
      if (!m.ped) continue;
      const who = m.body && STORY_BODIES.includes(m.body) ? m.body.toUpperCase() : `MISSION: ${m.tag}`;
      out.ped(m.ped, m.hostile ? `${who} (hostile)` : who, 'mission');
    }
    for (const c of this.carList) out.car(c.v, `MISSION CAR: ${c.tag}`, 'mission');
  }
}

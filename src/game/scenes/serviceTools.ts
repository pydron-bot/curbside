/**
 * Borrowed Blues: steal a service vehicle and its tool works, on the one
 * action slot (the fire button's place; J / click, the pad's X, the touch
 * car FIRE button). main.ts hands the press, the hold and the aim over
 * each frame (control()) and caps the throttle through limit(); the rules
 * are systems/serviceTools.ts.
 *
 *  - Hose (fire truck): while held, the roof monitor's jet (aimed, or at a
 *    fire ahead, or straight on) knocks people in its cone flat, throws
 *    riders off, shoves cars, douses a car that's caught and puts out the
 *    fires it reaches (FireBoard, as the crews' hoses do; faster). Its
 *    water and steam are Effects' pooled particles (render/emergencyLook.ts
 *    toolsLook).
 *  - Chime (ice cream van): a press plays the jingle for a while; parked,
 *    the van draws a queue at its hatch (Gathering) that waits there, a
 *    lure for mayhem, until the van drives off or the chime's long over.
 *  - Winch (tow truck): a press, stopped, hooks the nearest towable car
 *    within reach of the hook; it's winched up and trails like the city's
 *    tows (towPose), the truck held to TOW_TOP_SPEED. Stop with it in the
 *    docks yard to deliver it (serviceMode pays by condition); a press
 *    elsewhere drops it.
 *
 * The guard: the borrowed vehicle (driven, or left standing as the
 * player's last) and the car on its hook are never taken by the city's own
 * service runs (CityLife.keeps). Everything goes out on the bus as `tool`
 * events (and pedDown for the hosed). No allocation per step bar events.
 */
import { forwardSpeed, isBike, speed, type VehicleControls } from '../../entities/vehicle';
import { winch, type Pose } from '../../systems/emergency';
import {
  CHIME_DRAW,
  CHIME_QUEUE,
  Chime,
  HOOK_RANGE,
  HOOK_SECONDS,
  HOOK_SPEED,
  HOSE_CAR_SHOVE,
  HOSE_DOWN,
  HOSE_KNOCK_EVERY,
  HOSE_POWER,
  HOSE_RANGE,
  TOW_TOP_SPEED,
  WINCH_CRAWL,
  YARD_HOLD,
  YARD_RADIUS,
  capThrottle,
  clipJet,
  douse,
  guarded,
  hookDistance,
  hookPoint,
  hookable,
  hoseHeading,
  hoseHit,
  hosePush,
  nozzleOf,
  toolFor,
  towedPose,
  type HookLook,
  type ToolKind,
} from '../../systems/serviceTools';
import { knockDown, type PedAgent } from '../../systems/crowd';
import type { ToolWhat } from '../../core/events';
import { len2 } from '../../core/len';
import type { Vehicle } from '../population';
import type { Scene, SceneCtx } from '../cityLife';
import { placeDocks } from '../modes/places';
import type { LabelSink } from '../debugLabels';
import { FireCrews } from './fireCrews';
import { Gathering } from './gathering';
import { roomFor } from './people';
import { Tows } from './tows';

/** The pump's hiss repeats this often while the hose is on, s. */
const HISS_EVERY = 1.1;
/** Burning wrecks are this big to the jet, m (a wall's fire sits out from the face: a little more). */
const FIRE_SIZE = 1.3;
const WALL_FIRE_SIZE = 1.8;
const NO_FIRES: readonly { x: number; z: number; alive: boolean }[] = [];

export class ServiceTools implements Scene {
  readonly kind = 'tools';
  /** The player's borrowed service vehicle: the one they're in, or left standing as their last. */
  truck: Vehicle | null = null;
  tool: ToolKind | null = null;
  // --- Hose (for the look) ---
  hosing = false;
  readonly nozzle = { x: 0, z: 0 };
  /** Where the jet points and how far it gets (a wall stops it), m. */
  jetX = 0;
  jetZ = 0;
  jetLength = 0;
  /** A fire in the jet this step (steam where it lands). */
  jetOnFire = false;
  // --- Chime ---
  readonly chime = new Chime();
  readonly queue: Gathering;
  // --- Winch ---
  /** The car on the hook. */
  hooked: Vehicle | null = null;
  /** The last car delivered to the yard (serviceMode checks it against Vex's contract). */
  delivered: Vehicle | null = null;
  /** The docks yard: where the side job's cars go. */
  readonly yard: { x: number; z: number };
  /** Winched up, 0..1. */
  winchUp = 0;
  private rear = false;
  private readonly from: Pose = { x: 0, z: 0, heading: 0 };
  private readonly pose: Pose = { x: 0, z: 0, heading: 0 };
  private readonly hook = { x: 0, z: 0 };
  private readonly end = { rear: false };
  private readonly look: HookLook = { towable: false, wrecked: false, burning: false, parked: false, busy: false, reach: 0, delivered: false };
  private yardHeld = 0;
  /** Cars delivered once (no second payday for the same car). */
  private readonly done = new WeakSet<Vehicle>();
  // --- Input (main.ts, per frame) ---
  private pressed = false;
  private held = false;
  private aim: number | null = null;
  private hissIn = 0;
  private scan = 0;
  private readonly knocked = new WeakMap<PedAgent, number>();
  private readonly thrown = new WeakMap<Vehicle, number>();

  /** The director's tools (for the look and the debug hooks). */
  static of(life: SceneCtx): ServiceTools | null {
    for (const s of life.scenes) if (s instanceof ServiceTools) return s;
    return null;
  }

  constructor(private readonly life: SceneCtx) {
    // Nobody's ever served (the player's driving): the queue waits at the hatch until it's let go.
    this.queue = new Gathering(life, { kind: 'queue', capacity: CHIME_QUEUE, draw: CHIME_DRAW, joinChance: 0.6, serveEvery: 1e9, side: 2.2 });
    const docks = placeDocks(life.d.city);
    this.yard = { x: docks.x, z: docks.z };
  }

  get running(): number {
    return this.truck ? 1 : 0;
  }

  /** This frame's action slot (main.ts): a fresh press, the button held, the aim (world heading) or null. */
  control(pressed: boolean, held: boolean, aim: number | null): void {
    if (pressed) this.pressed = true;
    this.held = held;
    this.aim = aim;
  }

  /** Is `v` the player's borrowed vehicle or the car on its hook (no city service run may take it)? */
  guards(v: Vehicle): boolean {
    return guarded(v, this.truck, this.hooked);
  }

  /** The player's controls this step (not the shared idle ones): towing, held to the tow speed; winching, to a crawl. */
  limit(c: VehicleControls): void {
    const t = this.truck;
    if (!t || !this.hooked || this.life.d.player.driving !== t) return;
    c.throttle = capThrottle(c.throttle, forwardSpeed(t.sim), this.winchUp < 1 ? WINCH_CRAWL : TOW_TOP_SPEED);
    c.boost = false;
  }

  step(dt: number): void {
    const life = this.life;
    const p = life.d.player;
    const v = p.driving;
    if (v && v !== this.truck) {
      // In another vehicle: its tool, if it has one; the last one's left behind.
      if (this.truck) this.drop();
      const tool = toolFor(v.archetype);
      if (tool) {
        this.truck = v;
        this.tool = tool;
      }
    } else if (!v && this.truck && (p.lastDriven !== this.truck || !this.truck.mesh.root.visible || this.truck.damage.wrecked)) this.drop();
    const t = this.truck;
    const pressed = this.pressed;
    this.pressed = false;
    if (!t) return;
    const driving = v === t && p.alive && !t.damage.wrecked;
    if (this.tool === 'hose') this.hose(t, dt, driving && this.held);
    else if (this.tool === 'chime') this.stepChime(t, dt, driving && pressed);
    else this.stepWinch(t, dt, driving && pressed, driving);
  }

  reset(): void {
    this.drop();
    this.delivered = null;
    this.pressed = this.held = false;
    this.aim = null;
  }

  describe(out: LabelSink): void {
    if (this.truck && this.tool) out.car(this.truck, this.tool === 'hose' ? (this.hosing ? 'YOUR HOSE (on)' : 'YOUR HOSE') : this.tool === 'chime' ? (this.chime.on ? 'YOUR CHIME (on)' : 'YOUR CHIME') : 'YOUR WINCH', 'mission');
    if (this.hooked) out.car(this.hooked, this.winchUp < 1 ? 'WINCHING' : 'ON YOUR HOOK', 'mission');
    for (const c of this.queue.members) out.ped(c, 'QUEUE (chime)', 'people');
  }

  /** Let go of everything: the hose off, the queue sent off, the car left where it is. */
  private drop(): void {
    const t = this.truck;
    if (this.hosing) this.hoseOff(t);
    if (this.chime.anchored) this.queue.close();
    this.chime.reset();
    if (this.hooked) this.unhook(false);
    this.truck = null;
    this.tool = null;
  }

  private emit(what: ToolWhat, x: number, z: number, condition?: number, wrecked?: boolean): void {
    if (!this.tool) return;
    this.life.d.bus.emit({ type: 'tool', tool: this.tool, what, x, z, condition, wrecked });
  }

  // --- Hose ---------------------------------------------------------------------

  private hoseOff(t: Vehicle | null): void {
    this.hosing = false;
    this.jetOnFire = false;
    if (t) this.emit('hoseOff', t.sim.x, t.sim.z);
  }

  private hose(t: Vehicle, dt: number, on: boolean): void {
    if (!on) {
      if (this.hosing) this.hoseOff(t);
      return;
    }
    const life = this.life;
    const s = t.sim;
    const n = nozzleOf(s, s.body?.reach ?? 3.4, this.nozzle);
    const board = FireCrews.of(life)?.board ?? null;
    const heading = hoseHeading(s.heading, this.aim, n.x, n.z, board ? board.fires : NO_FIRES);
    const dx = Math.sin(heading);
    const dz = Math.cos(heading);
    const len = clipJet(life.d.city.buildings, n.x, n.z, dx, dz, HOSE_RANGE);
    this.jetX = dx;
    this.jetZ = dz;
    this.jetLength = len;
    if (!this.hosing) {
      this.hosing = true;
      this.hissIn = HISS_EVERY;
      this.emit('hoseOn', n.x, n.z);
    } else if ((this.hissIn -= dt) <= 0) {
      this.hissIn = HISS_EVERY;
      this.emit('spray', n.x, n.z);
    }
    const now = life.now;
    // People in the jet: knocked flat and back along it (each once in a while).
    for (const c of life.d.population.crowd) {
      const a = c.agent;
      if (a.mode === 'down') continue;
      const along = hoseHit(n.x, n.z, dx, dz, a.s.x, a.s.z, 0.4, len);
      if (along < 0 || now - (this.knocked.get(a) ?? -1e9) < HOSE_KNOCK_EVERY) continue;
      this.knocked.set(a, now);
      knockDown(a, a.s.x - dx, a.s.z - dz, hosePush(along, len), HOSE_DOWN);
      life.d.bus.emit({ type: 'pedDown', x: a.s.x, z: a.s.z, cause: 'water', byPlayer: true, cop: a.role === 'cop', gang: a.gang, suspect: a.suspect });
    }
    // Fires it reaches go out (faster than a crew's hoses).
    this.jetOnFire = false;
    if (board) {
      for (const f of board.fires) {
        if (!f.alive || hoseHit(n.x, n.z, dx, dz, f.x, f.z, f.building ? WALL_FIRE_SIZE : FIRE_SIZE, len + 1) < 0) continue;
        this.jetOnFire = true;
        if (board.hose(f, dt, HOSE_POWER)) {
          life.emit('fireOut', f.x, f.z);
          this.emit('fireOut', f.x, f.z);
        }
      }
    }
    // Cars: one that's caught is doused, riders are thrown, the rest shoved along the jet.
    for (const v of life.d.vehicles) {
      if (v === t || !v.mesh.root.visible || v.sim.y > 0.5) continue;
      const vs = v.sim;
      const along = hoseHit(n.x, n.z, dx, dz, vs.x, vs.z, vs.body?.halfWidth ?? 1, len);
      if (along < 0) continue;
      if (douse(v.damage)) this.jetOnFire = true;
      if (isBike(v.archetype)) {
        if (v.tipped || vs.vx * vs.vx + vs.vz * vs.vz < 4 || now - (this.thrown.get(v) ?? -1e9) < HOSE_KNOCK_EVERY) continue;
        this.thrown.set(v, now);
        life.d.throwRider?.(v);
        continue;
      }
      vs.vx += dx * HOSE_CAR_SHOVE * dt;
      vs.vz += dz * HOSE_CAR_SHOVE * dt;
    }
  }

  // --- Chime --------------------------------------------------------------------

  private stepChime(t: Vehicle, dt: number, pressed: boolean): void {
    const life = this.life;
    const s = t.sim;
    // A second press stops the jingle; a queue lingers a while (Chime.step lets it go).
    if (pressed) this.chime.press();
    switch (this.chime.step(dt, s.x, s.z, speed(s))) {
      case 'ring':
        this.emit('chime', s.x, s.z);
        break;
      case 'park':
        this.queue.at(s.x, s.z, s.heading);
        this.emit('queue', s.x, s.z);
        break;
      case 'release':
        this.queue.close();
        this.emit('release', s.x, s.z);
        break;
    }
    if (!this.chime.anchored) return;
    if ((this.scan -= dt) <= 0) {
      this.scan = 1;
      if (this.chime.on && life.lively('tools') && roomFor(life, 2)) this.queue.recruit();
    }
    this.queue.step(dt);
  }

  // --- Winch --------------------------------------------------------------------

  private stepWinch(t: Vehicle, dt: number, pressed: boolean, driving: boolean): void {
    const ts = t.sim;
    const car = this.hooked;
    if (!car) {
      if (pressed) this.tryHook(t);
      return;
    }
    const p = this.life.d.player;
    if (!car.mesh.root.visible || car === p.driving || car.ai !== null) {
      // Gone (recycled), or someone got in it.
      this.unhook(false);
      return;
    }
    const cs = car.sim;
    this.winchUp = Math.min(1, this.winchUp + dt / HOOK_SECONDS);
    towedPose(ts, ts.body?.reach ?? 3.5, cs.body?.reach ?? 2.4, cs, this.rear, this.from, winch(this.winchUp), this.pose);
    cs.x = this.pose.x;
    cs.z = this.pose.z;
    cs.heading = this.pose.heading;
    // Carried, not driven: no speed of its own (else its tyres skid and smoke as it's dragged round).
    cs.vx = cs.vz = cs.yawRate = 0;
    const inYard = this.winchUp >= 1 && len2(cs.x - this.yard.x, cs.z - this.yard.z) < YARD_RADIUS;
    this.yardHeld = driving && inYard && speed(ts) < 1.5 ? this.yardHeld + dt : 0;
    if (this.yardHeld >= YARD_HOLD || (pressed && inYard)) this.deliver();
    else if (pressed) this.unhook(true);
  }

  private tryHook(t: Vehicle): void {
    const life = this.life;
    const ts = t.sim;
    const h = hookPoint(ts, ts.body?.reach ?? 3.5, this.hook);
    if (speed(ts) > HOOK_SPEED) {
      this.emit('noHook', h.x, h.z);
      return;
    }
    const p = life.d.player;
    const fires = FireCrews.of(life)?.board ?? null;
    const tows = Tows.of(life);
    const look = this.look;
    let best: Vehicle | null = null;
    let bestD = HOOK_RANGE;
    let rear = false;
    for (const v of life.d.vehicles) {
      if (v === t || v === p.driving || !v.mesh.root.visible) continue;
      const vs = v.sim;
      if (Math.abs(vs.x - h.x) > 8 || Math.abs(vs.z - h.z) > 8) continue;
      look.towable = v.towable === true;
      look.wrecked = v.damage.wrecked;
      look.burning = v.damage.burning || (fires?.burningNear(vs.x, vs.z, 4) ?? false);
      look.parked = v.parked === true;
      // An activity's car (a job's) isn't the yard's, bar one left for a tow (Vex's contract).
      look.busy =
        v.ai !== null ||
        Boolean(v.pursuit) ||
        Boolean(v.scene) ||
        v.police === true ||
        v.exported === true ||
        isBike(v.archetype) ||
        (tows?.towing(v) ?? null) !== null ||
        (life.d.keep(v) && v.towable !== true);
      look.reach = vs.body?.reach ?? 2.4;
      look.delivered = this.done.has(v);
      if (!hookable(look)) continue;
      const d = hookDistance(h.x, h.z, vs, look.reach, this.end);
      if (d >= bestD) continue;
      bestD = d;
      best = v;
      rear = this.end.rear;
    }
    if (!best) {
      this.emit('noHook', h.x, h.z);
      return;
    }
    this.hooked = best;
    this.rear = rear;
    this.winchUp = 0;
    this.yardHeld = 0;
    const s = best.sim;
    this.from.x = s.x;
    this.from.z = s.z;
    this.from.heading = s.heading;
    best.parked = false;
    // The player's now: a scene that brought it in mustn't retire it from under the hook.
    const i = life.owned.indexOf(best);
    if (i >= 0) life.owned.splice(i, 1);
    best.ambient = false;
    this.emit('hook', s.x, s.z);
  }

  /** Off the hook where it stands (`say`: the player let it go). */
  private unhook(say: boolean): void {
    const car = this.hooked;
    this.hooked = null;
    this.winchUp = 0;
    this.yardHeld = 0;
    if (car && say) this.emit('unhook', car.sim.x, car.sim.z);
  }

  /** In the yard: left there (retired once nobody's looking), and paid for (serviceMode hears 'deliver'). */
  private deliver(): void {
    const life = this.life;
    const car = this.hooked;
    if (!car) return;
    this.unhook(false);
    this.done.add(car);
    this.delivered = car;
    car.towable = false;
    car.ambient = true;
    if (!life.owned.includes(car)) life.owned.push(car);
    const d = car.damage;
    this.emit('deliver', car.sim.x, car.sim.z, d.health / d.maxHealth, d.wrecked);
  }
}

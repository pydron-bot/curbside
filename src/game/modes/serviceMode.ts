/**
 * Borrowed Blues on the screen (V2-09): in a stolen fire truck, ice cream
 * van or tow truck you're on duty and the activity card says what its tool
 * does and which button works it. The tools themselves are the city's
 * (game/scenes/serviceTools.ts); this pays for them, from their `tool`
 * events:
 *  - a fire your hose puts out (before the crew left on the pavement does,
 *    or a crew that never came): FIRE_OUT_PAY, and a duty streak bonus
 *    every DUTY_STREAK_EVERY-th in a row;
 *  - the tow side job: a car hooked and stopped in the docks yard pays by
 *    its condition (towPay), every TOW_STREAK_EVERY-th in a row a bonus;
 *    while one's on the hook the radar routes to the yard.
 * Getting out loses the streak, as a cab's does. After dark, on duty in a
 * tow truck with nothing on the hook, Vex rings now and then with a tow
 * contract: a crashed car left in the road somewhere near, on the radar;
 * get it to the yard in time for CONTRACT_PAY on top.
 */
import { speed } from '../../entities/vehicle';
import type { GlowSprites } from '../../render/glowSprites';
import { MARK, beacon, groundRing, nearView, type ProgressProps } from '../../render/progressLook';
import { arcRings, type DialogueLine } from '../../systems/missions';
import {
  CONTRACT_PAY,
  CONTRACT_RANGE,
  CONTRACT_TIME,
  DUTY_STREAK_BONUS,
  DUTY_STREAK_EVERY,
  FIRE_OUT_PAY,
  TOW_STREAK_BONUS,
  TOW_STREAK_EVERY,
  YARD_RADIUS,
  streakPay,
  toolFor,
  towPay,
  vexRings,
  CONTRACT_EVERY,
  type ToolKind,
} from '../../systems/serviceTools';
import type { DialogueCard } from '../../ui/progressScreens';
import { fmt } from '../../ui/scoreHud';
import type { EventOf } from '../../core/events';
import type { InputDevice } from '../../core/input';
import type { Rect } from '../../world/city';
import { pickParkingSpot, type RoadSpot } from '../../world/streetSpots';
import { len2 } from '../../core/len';
import type { ServiceTools } from '../scenes/serviceTools';
import type { Vehicle } from '../population';
import { KeyedText, type Mode, type ModeCtx } from './context';
import type { LabelSink } from '../debugLabels';

const VEX = 'VEX';
/** Vex's calls, in turn: at most three lines, the instruction last. */
const VEX_CALLS: readonly (readonly DialogueLine[])[] = [
  [
    { who: VEX, text: "That's one of my trucks you're in. Keep it. I've a job, and the job's a wreck." },
    { who: VEX, text: 'Someone left a car in the road. The council pays me to move it. I pay you.' },
    { who: VEX, text: "Hook it and get it to the yard before the council's man does. It's on your radar." },
  ],
  [
    { who: VEX, text: 'Night shift, kid. Another one for the yard. Council money, so nobody asks.' },
    { who: VEX, text: "It's had a bump. Don't give it another. Or do: scrap pays too, just less." },
    { who: VEX, text: "It's on your radar. Hook it, haul it, don't stop for chips." },
  ],
];
const CONTRACT_HEAD = '☾ TOW CONTRACT';
const CONTRACT_PAINTS = ['#6f747c', '#5b4a3e', '#2f4a5e', '#7d6a3a'];
const CONTRACT_MODELS = ['sedan', 'compact', 'sedan', 'pickup'] as const;
/** Vex's call waits for the truck to be going this slowly, m/s (a card shouldn't land mid-corner). */
const CALL_SPEED = 4;

/** What the card says to do, by tool and device (under ~38 characters). */
const HINTS: Readonly<Record<ToolKind, Readonly<Record<InputDevice, string>>>> = {
  hose: { keyboard: 'HOLD J OR CLICK TO HOSE', gamepad: 'HOLD X TO HOSE', touch: 'HOLD HOSE · DRAG IT TO AIM' },
  chime: { keyboard: 'J: CHIME · PARK FOR A QUEUE', gamepad: 'X: CHIME · PARK FOR A QUEUE', touch: 'CHIME, THEN PARK FOR A QUEUE' },
  winch: { keyboard: 'BACK UP TO A WRECK · J TO WINCH', gamepad: 'BACK UP TO A WRECK · X TO WINCH', touch: 'BACK UP TO A WRECK · WINCH' },
};
const TITLES: Readonly<Record<ToolKind, string>> = { hose: 'FIRE TRUCK', chime: 'ICE CREAM VAN', winch: 'TOW TRUCK' };

interface Contract {
  car: Vehicle;
  left: number;
}

export class ServiceMode implements Mode {
  /** The tool of the vehicle you're on duty in (null: not). */
  private duty: ToolKind | null = null;
  private dutyFor = 0;
  private fireStreak = 0;
  private towStreak = 0;
  private sinceCall = CONTRACT_EVERY;
  private calls = 0;
  private contract: Contract | null = null;
  private calling = false;
  /** The radar's waypoint is ours (the yard). */
  private routed = false;
  private readonly label = new KeyedText();
  private readonly goal = new KeyedText();
  private readonly spot: RoadSpot = { ix: 0, iz: 0, dir: 0, along: 0, x: 0, z: 0, heading: 0 };

  constructor(
    private readonly ctx: ModeCtx,
    private readonly tools: ServiceTools | null,
    private readonly card: DialogueCard,
  ) {
    ctx.deps.bus.on('tool', (e) => this.onTool(e));
  }

  step(dt: number): void {
    const ctx = this.ctx;
    const tools = this.tools;
    if (!tools) return;
    const car = ctx.deps.player.driving;
    const tool = car && ctx.live && ctx.freeRoam && ctx.busy === null && !car.damage.wrecked ? toolFor(car.archetype) : null;
    if (tool !== this.duty) {
      // Out of the vehicle (or into another): the streak goes with it.
      if (this.duty === 'hose') this.fireStreak = 0;
      if (this.duty === 'winch') this.towStreak = 0;
      this.duty = tool;
      this.dutyFor = 0;
      this.label.reset();
      this.goal.reset();
      if (tool) ctx.notice(`${TITLES[tool]} · ${HINTS[tool][ctx.deps.input.lastDevice]}`, 'progress');
    }
    if (tool) this.dutyFor += dt;
    this.sinceCall += dt;
    this.route(tool === 'winch' && tools.hooked !== null);
    const c = this.contract;
    if (c) {
      c.left -= dt;
      const gone = !c.car.mesh.root.visible || c.car === ctx.deps.player.driving;
      if (gone || c.left <= 0) this.endContract(ctx.live ? (gone ? 'THE WRECK IS GONE' : 'TOO SLOW') : null);
      else if (tools.hooked !== c.car) ctx.blip('vexWreck', { x: c.car.sim.x, z: c.car.sim.z, kind: 'objective', icon: '☾', size: 6, pulse: true, edgeArrow: true });
      else ctx.unblip('vexWreck');
    }
    const dark = arcRings('night', ctx.deps.look.time.hour);
    if (
      !this.calling &&
      car &&
      speed(car.sim) < CALL_SPEED &&
      vexRings(dark, tool === 'winch', tools.hooked !== null, this.contract !== null, this.sinceCall, this.dutyFor)
    )
      this.call();
  }

  /** The radar to the docks yard while a car's on the hook (only while nothing else has the route). */
  private route(on: boolean): void {
    const ctx = this.ctx;
    const tools = this.tools!;
    if (on && !this.routed && ctx.busy === null) {
      this.routed = true;
      ctx.deps.radar.setWaypoint(tools.yard.x, tools.yard.z);
      ctx.blip('towYard', { x: tools.yard.x, z: tools.yard.z, kind: 'objective', icon: 'Y', size: 6, pulse: true, edgeArrow: true });
    } else if (this.routed && (!on || ctx.busy !== null)) {
      this.routed = false;
      // Something else took the route (a job): leave its waypoint be.
      if (ctx.busy === null) ctx.deps.radar.clearWaypoint();
      ctx.unblip('towYard');
    }
  }

  private onTool(e: EventOf<'tool'>): void {
    const ctx = this.ctx;
    if (!ctx.live) return;
    switch (e.what) {
      case 'fireOut': {
        this.fireStreak++;
        ctx.pay(FIRE_OUT_PAY, 'duty', 'FIRE OUT');
        const bonus = streakPay(this.fireStreak, DUTY_STREAK_EVERY, DUTY_STREAK_BONUS);
        if (bonus) this.streak(this.fireStreak, bonus, 'FIRES OUT');
        this.label.reset();
        return;
      }
      case 'deliver': {
        this.towStreak++;
        const { pay, label } = towPay(e.condition ?? 0, e.wrecked === true);
        ctx.pay(pay, 'tow', `TOWED · ${label}`);
        const c = this.contract;
        if (c && this.tools?.delivered === c.car) {
          ctx.pay(CONTRACT_PAY, 'tow', "VEX'S CONTRACT");
          this.endContract(null);
        }
        const bonus = streakPay(this.towStreak, TOW_STREAK_EVERY, TOW_STREAK_BONUS);
        if (bonus) this.streak(this.towStreak, bonus, 'TOWED');
        else ctx.deps.audio.ui('confirm');
        this.label.reset();
        return;
      }
      case 'hook':
        if (this.contract && this.tools?.hooked === this.contract.car) ctx.notice("VEX'S WRECK HOOKED · TO THE YARD", 'progress');
        return;
      case 'noHook':
        ctx.notice('NOTHING TO HOOK: STOP WITH A WRECK BEHIND', 'progress');
        return;
      case 'queue':
        ctx.notice('THE CHIME DRAWS A QUEUE', 'progress');
        return;
      default:
        return;
    }
  }

  private streak(n: number, bonus: number, what: string): void {
    const ctx = this.ctx;
    ctx.pay(bonus, 'duty', `STREAK ×${n}`);
    ctx.ui.banner(`${n} ${what} IN A ROW!`, 'gold', `+$${fmt(bonus)} STREAK BONUS`);
    ctx.deps.audio.ui('success');
  }

  /** Vex on the phone: the card, then her wreck goes down somewhere near. */
  private call(): void {
    const ctx = this.ctx;
    this.sinceCall = 0;
    this.calling = true;
    ctx.deps.audio.ui('ring');
    ctx.ui.clearBanner();
    ctx.openModal(this.card);
    const lines = VEX_CALLS[this.calls++ % VEX_CALLS.length];
    this.card.show(CONTRACT_HEAD, "VEX'S WRECK", lines, `PAYS $${fmt(CONTRACT_PAY)} + THE YARD'S`, 'ON IT', ctx.focusRing, () => {
      ctx.closeModal(this.card);
      this.calling = false;
      this.placeContract();
    });
  }

  /** A crashed car at a kerb CONTRACT_RANGE away (pinned: nothing else takes it), towable. */
  private placeContract(): void {
    const ctx = this.ctx;
    const { rand, player } = ctx.deps;
    const at = player.position;
    let s: RoadSpot | null = null;
    for (let i = 0; i < 40 && !s; i++) {
      s = pickParkingSpot(at.x, at.z, CONTRACT_RANGE[0], CONTRACT_RANGE[1], rand, [], this.spot);
      // Not on top of a car already parked there.
      if (s && ctx.deps.vehicles.some((o) => Math.abs(o.sim.x - s!.x) < 6 && Math.abs(o.sim.z - s!.z) < 6)) s = null;
    }
    if (!s) return;
    const k = Math.floor(rand() * CONTRACT_MODELS.length);
    // A little askew at the kerb: it was left, not parked.
    const v = ctx.spawnCar(CONTRACT_MODELS[k], CONTRACT_PAINTS[k], s.x, s.z, s.heading + (rand() - 0.5) * 0.6);
    v.damage.health = v.damage.maxHealth * (0.3 + rand() * 0.2);
    v.towable = true;
    this.contract = { car: v, left: CONTRACT_TIME };
    ctx.notice("VEX'S WRECK IS ON THE RADAR", 'progress');
  }

  /** Over (`why`: failed, said on a banner; null: paid, or quietly). */
  private endContract(why: string | null): void {
    const ctx = this.ctx;
    const c = this.contract;
    if (!c) return;
    this.contract = null;
    ctx.unpin(c.car);
    ctx.unblip('vexWreck');
    if (why) {
      ctx.ui.banner('CONTRACT LOST', 'fail', why);
      ctx.deps.audio.ui('fail');
    }
  }

  hud(): boolean {
    const tools = this.tools;
    const tool = this.duty;
    const c = this.contract;
    if (!tools || (!tool && !c)) return false;
    const ui = this.ctx.ui;
    const streak = tool === 'hose' ? this.fireStreak : tool === 'winch' ? this.towStreak : 0;
    const key = (tool ? ['hose', 'chime', 'winch'].indexOf(tool) + 1 : 0) * 1000 + Math.min(streak, 99) * 2 + (c ? 1 : 0);
    if (this.label.stale(key)) this.label.text = c ? 'TOW CONTRACT' : `${TITLES[tool!]}${streak > 0 ? ` · STREAK ${streak}` : ''}`;
    ui.activity(this.label.text);
    ui.timer(c ? c.left : null, c !== null && c.left <= 15, 0);
    const at = this.ctx.deps.player.position;
    const hooked = tools.hooked;
    if (tool === 'winch' && hooked) {
      const d = hooked.damage;
      const pay = towPay(d.health / d.maxHealth, d.wrecked).pay + (c && hooked === c.car ? CONTRACT_PAY : 0);
      const left = Math.max(0, Math.round((len2(tools.yard.x - at.x, tools.yard.z - at.z) - YARD_RADIUS * 0.5) / 10) * 10);
      if (this.goal.stale(tools.winchUp < 1 ? -1 : left * 10000 + pay)) this.goal.text = tools.winchUp < 1 ? 'WINCHING…' : left > 0 ? `TO THE DOCKS YARD ${left} M · $${fmt(pay)}` : `STOP IN THE YARD · $${fmt(pay)}`;
    } else if (c) {
      const left = Math.round(len2(c.car.sim.x - at.x, c.car.sim.z - at.z) / 10) * 10;
      if (this.goal.stale(-1e6 - left)) this.goal.text = tool === 'winch' ? `HOOK VEX'S WRECK · ${left} M` : `GET A TOW TRUCK · WRECK ${left} M`;
    } else if (tool === 'chime' && tools.chime.on) {
      const n = tools.queue.members.length;
      if (this.goal.stale(-1000 - (tools.chime.anchored ? n : 99))) this.goal.text = tools.chime.anchored ? `CHIME ON · QUEUE ${n}` : 'CHIME ON · PARK FOR A QUEUE';
    } else {
      const device = this.ctx.deps.input.lastDevice;
      if (this.goal.stale(-2000 - ['keyboard', 'gamepad', 'touch'].indexOf(device))) this.goal.text = HINTS[tool!][device];
    }
    ui.goal(this.goal.text);
    return true;
  }

  prompt(): string | null {
    return null;
  }

  glow(g: GlowSprites, _props: ProgressProps, view: Rect, t: number): void {
    const tools = this.tools;
    if (!tools) return;
    const y = tools.yard;
    if (this.duty === 'winch' && tools.hooked && nearView(y.x, y.z, view, YARD_RADIUS)) {
      groundRing(g, y.x, y.z, YARD_RADIUS * 1.2, MARK.docks, 0.6 + 0.3 * Math.sin(t * 4), t * 0.5);
      beacon(g, y.x, y.z, 1.6, 14, MARK.docks, 0.6);
    }
    const c = this.contract;
    if (c && tools.hooked !== c.car) {
      const s = c.car.sim;
      if (nearView(s.x, s.z, view)) {
        groundRing(g, s.x, s.z, 5.5 + 0.4 * Math.sin(t * 6), MARK.objective, 1, t);
        beacon(g, s.x, s.z, 1, 7, MARK.objective, 0.6);
      }
    }
  }

  reset(): void {
    this.endContract(null);
    this.route(false);
    this.duty = null;
    this.fireStreak = this.towStreak = 0;
    this.dutyFor = 0;
    this.calling = false;
  }

  /** Debug labels: Vex's wreck. */
  describe(out: LabelSink): void {
    if (this.contract) out.car(this.contract.car, "VEX'S WRECK", 'mission');
  }
}

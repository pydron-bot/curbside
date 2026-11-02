/**
 * Food carts and fruit stands (world/streetStops.ts, `deps.vendors`). The
 * carts near the player are staffed: a vendor stands at the cart's end
 * (put there out of view), and passers-by queue at the serving side and
 * are served one at a time, then walk on. How busy depends on the hour
 * (systems/streetPeople.ts cartBusyness): a lunch rush and an evening
 * one, quiet in the small hours. A kerb cart serves onto the walking
 * line, so its queue steps off toward the shopfronts after the first
 * (cartSpot) and walkers step round whoever stands there (Pavement). Now
 * and then someone pushes in (Fights.queueJump).
 */
import { IN_PLAY } from '../../systems/cityScenes';
import { cartBusyness, cartSpot, type Stand } from '../../systems/streetPeople';
import type { VendorSpot } from '../../world/streetStops';
import type { CrowdPed } from '../population';
import type { Scene, SceneCtx } from '../cityLife';
import { labelMembers, type LabelSink } from '../debugLabels';
import type { Fights } from './fights';
import { Gathering } from './gathering';
import { roomFor, streetBody } from './people';

/** Carts this close to the player are staffed, m; let go beyond CART_DROP and out of view. */
const CART_RANGE = 90;
const CART_DROP = 130;
/** Most staffed at once (the nearest come first as they're found). */
const MAX_CARTS = 5;
/** Most queueing at a kerb cart / one in a park or plaza. */
const KERB_QUEUE = 4;
const LOT_QUEUE = 5;
/** One served every this many seconds. */
const SERVE_EVERY = 4.5;
/** Chance per second someone pushes in at a queue of three or more. */
const JUMP_CHANCE = 0.01;
const VENDOR_OUTFIT = { shirt: '#f2efe6', pants: '#3b3b44' };

interface Cart {
  spot: VendorSpot;
  vendor: CrowdPed | null;
  queue: Gathering;
}

export class Vendors implements Scene {
  readonly kind = 'vendors';
  readonly stands: Cart[] = [];
  private readonly open = new Set<VendorSpot>();
  private readonly spare: Gathering[] = [];
  private scan = 0;

  constructor(
    private readonly life: SceneCtx,
    private readonly fights: Fights,
  ) {
    // Not a clock of its own (a cart's always there): the hold only.
    life.clock.define('cart', { every: [1, 1], cap: MAX_CARTS, first: 0, range: CART_RANGE, hold: IN_PLAY });
  }

  get running(): number {
    return this.stands.length;
  }

  step(dt: number): void {
    const life = this.life;
    const scan = (this.scan -= dt) <= 0;
    if (scan) {
      this.scan = 1;
      this.tend();
    }
    const busy = cartBusyness(life.d.hour?.() ?? 13);
    for (const st of this.stands) {
      const q = st.queue;
      if (scan && life.live && roomFor(life, 2)) {
        q.spec.joinChance = 0.08 + 0.4 * busy;
        q.recruit();
        this.keepVendor(st);
      }
      q.step(dt);
      if (q.members.length >= 3 && life.d.rand() < JUMP_CHANCE * dt) this.jump(st);
    }
  }

  reset(): void {
    for (const st of this.stands) this.close(st);
    this.stands.length = 0;
    this.open.clear();
  }

  describe(out: LabelSink): void {
    for (const st of this.stands) {
      if (st.vendor) out.ped(st.vendor, 'VENDOR', 'people');
      labelMembers(out, st.queue.members, 'QUEUE', true);
    }
  }

  /** Debug (__ub): the cart nearest the player staffed now with three queueing. */
  force(): boolean {
    const life = this.life;
    let best: VendorSpot | null = null;
    for (const v of life.d.vendors) if (!best || life.distance(v.x, v.z) < life.distance(best.x, best.z)) best = v;
    if (!best) return false;
    let st = this.stands.find((s) => s.spot === best);
    st ??= this.staff(best);
    st.vendor ??= this.addVendor(best);
    for (let i = 0; i < 3; i++) {
      const c = life.addPed(best.serveX + best.queueX * (4 + i), best.serveZ + best.queueZ * (4 + i), 0, undefined, streetBody(life));
      c.agent.street = true;
      st.queue.add(c);
    }
    return true;
  }

  /** Staff the carts coming into range, let the far ones go. */
  private tend(): void {
    const life = this.life;
    for (let i = this.stands.length - 1; i >= 0; i--) {
      const st = this.stands[i];
      const s = st.spot;
      if (life.distance(s.x, s.z) > CART_DROP && !life.inView(s.x, s.z, 4)) {
        this.close(st);
        this.stands.splice(i, 1);
        this.open.delete(s);
      }
    }
    if (!life.due('cart', this.stands.length)) return;
    const busy = cartBusyness(life.d.hour?.() ?? 13);
    for (const s of life.d.vendors) {
      if (this.stands.length >= MAX_CARTS) return;
      if (this.open.has(s) || life.distance(s.x, s.z) > CART_RANGE) continue;
      if (!roomFor(life, 3)) return;
      const st = this.staff(s);
      // Coming into range out of view: the vendor's there, and at a busy hour a customer or two already.
      if (!life.inView(s.x, s.z, 4)) {
        st.vendor = this.addVendor(s);
        const n = Math.floor(busy * 2.4 * life.d.rand());
        for (let i = 0; i < n; i++) {
          const p = cartSpot(s, i, s.setting === 'kerb', { x: 0, z: 0, heading: 0 });
          const c = life.addPed(p.x, p.z, p.heading, undefined, streetBody(life));
          c.agent.street = true;
          st.queue.add(c);
        }
      }
    }
  }

  private staff(s: VendorSpot): Cart {
    const angled = s.setting === 'kerb';
    const queue =
      this.spare.pop() ??
      new Gathering(this.life, { kind: 'queue', capacity: LOT_QUEUE, draw: 24, joinChance: 0.3, serveEvery: SERVE_EVERY });
    // Built for the longer queue (its ServeQueue's cap); a kerb cart's is shorter.
    queue.spec.capacity = angled ? KERB_QUEUE : LOT_QUEUE;
    queue.spec.place = (i: number, out: Stand) => cartSpot(s, i, angled, out);
    queue.at(s.serveX, s.serveZ, s.heading);
    const st: Cart = { spot: s, vendor: null, queue };
    this.stands.push(st);
    this.open.add(s);
    return st;
  }

  private addVendor(s: VendorSpot): CrowdPed {
    const c = this.life.addPed(s.vendorX, s.vendorZ, Math.atan2(s.serveX - s.vendorX, s.serveZ - s.vendorZ), VENDOR_OUTFIT, streetBody(this.life));
    this.life.lookAt(c, s.serveX, s.serveZ);
    return c;
  }

  /** The vendor stays at the cart (back to it if shoved), facing the customers; one knocked down or scared off is gone for good. */
  private keepVendor(st: Cart): void {
    const life = this.life;
    const c = st.vendor;
    if (!c) {
      // Staffed in view (no vendor yet): one turns up once it's out of sight.
      if (!life.inView(st.spot.vendorX, st.spot.vendorZ, 4)) st.vendor = this.addVendor(st.spot);
      return;
    }
    if (!life.present(c) || !c.agent.scene || c.agent.mode === 'down' || c.agent.mode === 'flee') return;
    life.walkTo(c, st.spot.vendorX, st.spot.vendorZ);
    life.lookAt(c, st.spot.serveX, st.spot.serveZ);
  }

  /** The last in line pushes in at the front. */
  private jump(st: Cart): void {
    const life = this.life;
    const q = st.queue;
    const front = q.members[0];
    const jumper = q.members[q.members.length - 1];
    if (jumper.agent.temper === 'calm' && life.d.rand() < 0.5) return;
    q.release(front);
    q.release(jumper);
    if (!this.fights.queueJump(jumper, front)) {
      life.giveBack(front);
      life.giveBack(jumper);
    }
  }

  private close(st: Cart): void {
    st.queue.close();
    st.queue.spec.place = undefined;
    this.spare.push(st.queue);
    const c = st.vendor;
    if (c && this.life.present(c) && c.agent.scene) this.life.removePed(c);
    st.vendor = null;
  }
}

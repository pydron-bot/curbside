/**
 * Gatecrashing on the radar (V2-12): while the player's in a street race
 * (RACE CRASHER), its next junction pulses in the racers' pink, pinned to
 * the rim when it's off the radar; the car they won waits as a gold `★`
 * until they take it. update() once a frame from main.ts; the options
 * objects are reused (Radar.setBlip copies them), so nothing allocates.
 */
import type { BlipOptions } from '../ui/radar';
import type { StreetRaces } from './scenes/streetRaces';
import { BLOCK_SIZE } from '../world/city';

export interface BlipSink {
  setBlip(id: string, opts: BlipOptions): void;
  removeBlip(id: string): void;
}

const NEXT = 'raceNext';
const PRIZE = 'racePrize';

export class CrasherBlips {
  private readonly next: BlipOptions = { x: 0, z: 0, kind: 'race', pulse: true, edgeArrow: true, size: 5 };
  private readonly prize: BlipOptions = { x: 0, z: 0, kind: 'objective', icon: '★', pulse: true, edgeArrow: true, size: 6 };
  private nextOn = false;
  private prizeOn = false;

  constructor(
    private readonly radar: BlipSink,
    private readonly races: StreetRaces,
  ) {}

  update(): void {
    const r = this.races.crashing;
    const c = r?.crasher;
    if (r && c && c.next < r.route.length) {
      const n = r.route[c.next];
      this.next.x = n.ix * BLOCK_SIZE;
      this.next.z = n.iz * BLOCK_SIZE;
      this.radar.setBlip(NEXT, this.next);
      this.nextOn = true;
    } else if (this.nextOn) {
      this.radar.removeBlip(NEXT);
      this.nextOn = false;
    }
    const pz = this.races.prize;
    if (pz && pz.handed) {
      this.prize.x = pz.v.sim.x;
      this.prize.z = pz.v.sim.z;
      this.radar.setBlip(PRIZE, this.prize);
      this.prizeOn = true;
    } else if (this.prizeOn) {
      this.radar.removeBlip(PRIZE);
      this.prizeOn = false;
    }
  }
}

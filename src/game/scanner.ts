/**
 * The police scanner on the bus (V2-11): street events and the player's heat
 * go to the ScannerFeed (systems/scanner.ts has the rules and the lines);
 * once a frame the line that's due goes out as a `scanner` event (the
 * subtitle, ui/scannerHud.ts; the squelch, GameAudio) and its ping, two at
 * most, is kept on the radar until the incident's over (CityLife's scenes by
 * label: `running` and `subject()`).
 *
 * On with Settings → Police scanner, and while setEnabled(true) (the default:
 * observe mode or anything else that hides the HUD turns it off from outside).
 * Off, nothing is said and the pings come off the radar.
 */
import type { ColorRepresentation } from 'three';
import type { EventBus } from '../core/events';
import { onSettingsChange, settings } from '../core/settings';
import type { VehicleArchetype } from '../entities/vehicle';
import { describeSuspect, ON_FOOT, ScannerFeed, type PingWorld, type ScannerTopic } from '../systems/scanner';
import type { BlipOptions } from '../ui/radar';
import { DISTRICT_NAMES, districtAt, type District } from '../world/districts';

/** CityLife as the pings see it: its scenes and their labels (parallel). */
export interface ScannerCity {
  readonly scenes: ReadonlyArray<{ readonly running: number; subject?(out: { x: number; z: number; vx: number; vz: number }): boolean }>;
  readonly sceneLabels: readonly string[];
}

export interface ScannerDeps {
  bus: EventBus;
  /** Sim time, s. */
  now: () => number;
  /** In play (not behind the title): nothing is said otherwise. */
  live: () => boolean;
  /** Where the player is. */
  position: () => { x: number; z: number };
  /** The player's vehicle, null on foot. */
  driving: () => { archetype: VehicleArchetype; paint: ColorRepresentation } | null;
  /** The wanted level now. */
  stars: () => number;
  city: ScannerCity;
  radar: { setBlip(id: string, opts: BlipOptions): void; removeBlip(id: string): void };
  /** Take the subtitle down now (switched off, the title). */
  clear?: () => void;
  /** Someone in the story has the subtitle (ScannerHud.speaking): the next line waits. */
  busy?: () => boolean;
  log?: (kind: string, detail: string) => void;
}

/** The pings' look on the radar: an orange "!" that ripples, pinned to the rim when off it. */
const PING_COLOUR = '#ff8a3c';
/** How often the player's district is checked while wanted, s. */
const DISTRICT_CHECK = 0.5;

export class Scanner {
  readonly feed = new ScannerFeed();
  private external = true;
  private wasLive = false;
  private districtTimer = 0;
  private district: District | null = null;
  /** Each ping slot's blip options (reused) and whether it's on the radar. */
  private readonly blips: BlipOptions[] = [];
  private readonly shown: boolean[] = [];
  private readonly sceneIndex = new Map<string, number>();
  private readonly subject = { x: 0, z: 0, vx: 0, vz: 0 };
  private readonly world: PingWorld;

  constructor(private readonly d: ScannerDeps) {
    for (let i = 0; i < this.feed.pings.length; i++) {
      this.blips.push({ x: 0, z: 0, kind: 'marker', colour: PING_COLOUR, icon: '!', pulse: true, edgeArrow: true, size: 6 });
      this.shown.push(false);
    }
    this.world = {
      alive: (scene) => {
        const s = this.scene(scene);
        return s !== null && s.running > 0;
      },
      where: (scene, out) => {
        const s = this.scene(scene);
        if (!s || !s.subject || s.running <= 0 || !s.subject(this.subject)) return false;
        out.x = this.subject.x;
        out.z = this.subject.z;
        return true;
      },
    };
    d.bus.on('street', (e) => {
      if (!this.d.live()) return;
      const at = this.d.position();
      const dist = Math.hypot(e.x - at.x, e.z - at.z);
      this.feed.street(e.what, e.x, e.z, place(e.x, e.z), dist, this.d.now());
    });
    d.bus.on('wanted', (e) => {
      const at = this.d.position();
      if (!this.d.live()) {
        this.feed.stars = e.level;
        return;
      }
      // Heading-into lines count from where the chase started.
      if (e.prev === 0 && e.level > 0) this.district = districtAt(at.x, at.z);
      this.feed.wanted(e.level, e.prev, e.reason, this.suspect(), place(at.x, at.z), at.x, at.z, this.d.now());
    });
    d.bus.on('enterVehicle', () => {
      if (!this.d.live() || this.feed.stars <= 0) return;
      const at = this.d.position();
      this.feed.switched(this.suspect(), place(at.x, at.z), at.x, at.z, this.d.now());
    });
    onSettingsChange(() => this.apply());
    this.apply();
  }

  /** On by default; off from outside (observe mode) whatever the setting. */
  setEnabled(on: boolean): void {
    this.external = on;
    this.apply();
  }

  /** Saying anything (the setting and setEnabled both on)? */
  get enabled(): boolean {
    return this.feed.enabled;
  }

  /** Once a frame (not while paused): the line that's due, the pings. */
  step(dt: number): void {
    const live = this.d.live();
    if (live !== this.wasLive) {
      this.wasLive = live;
      // The title or a fresh run: nothing carries over.
      this.reset();
    }
    if (!live || !this.feed.enabled) return;
    const now = this.d.now();
    this.feed.stars = this.d.stars();
    if (this.feed.stars > 0 && (this.districtTimer -= dt) <= 0) {
      this.districtTimer = DISTRICT_CHECK;
      const at = this.d.position();
      const here = districtAt(at.x, at.z);
      if (this.district !== null && here !== this.district) this.feed.heading(this.suspect(), DISTRICT_NAMES[here], at.x, at.z, now);
      this.district = here;
    }
    // A story line on the subtitle: the dispatcher waits.
    const line = this.feed.step(now, this.world, this.d.busy?.() ?? false);
    if (line) {
      this.d.bus.emit({ type: 'scanner', kind: line.topic, text: line.text, priority: line.priority, x: line.x, z: line.z, hold: line.hold });
      this.d.log?.('scanner', line.text);
    }
    this.syncBlips();
  }

  /** Say `topic` now, at the player's (debug, smoke test; `__ub.scanner.say('fire')`). */
  say(topic: ScannerTopic = 'fire'): void {
    const at = this.d.position();
    // A little way off, so its ping isn't under the player's arrow.
    const x = at.x + 30;
    const z = at.z - 20;
    this.feed.force(topic, place(x, z), x, z, this.d.now(), this.suspect());
  }

  /** Drop the waiting line and the pings; the subtitle comes down. */
  reset(): void {
    this.feed.reset();
    this.feed.stars = this.d.stars();
    this.district = null;
    this.syncBlips();
    this.d.clear?.();
  }

  private apply(): void {
    const on = settings.scanner && this.external;
    if (on === this.feed.enabled) return;
    this.feed.enabled = on;
    if (!on) this.reset();
  }

  private suspect(): string {
    const v = this.d.driving();
    return v ? describeSuspect(v.archetype, v.paint) : ON_FOOT;
  }

  private scene(label: string): ScannerCity['scenes'][number] | null {
    let i = this.sceneIndex.get(label);
    if (i === undefined) {
      i = this.d.city.sceneLabels.indexOf(label);
      this.sceneIndex.set(label, i);
    }
    return i >= 0 ? this.d.city.scenes[i] : null;
  }

  /** The radar follows the feed's pings: set where one is (on or moved), removed where one went. */
  private syncBlips(): void {
    const pings = this.feed.pings;
    for (let i = 0; i < pings.length; i++) {
      const p = pings[i];
      const b = this.blips[i];
      if (p.active) {
        if (!this.shown[i] || b.x !== p.x || b.z !== p.z) {
          b.x = p.x;
          b.z = p.z;
          this.d.radar.setBlip(p.id, b);
          this.shown[i] = true;
        }
      } else if (this.shown[i]) {
        this.d.radar.removeBlip(p.id);
        this.shown[i] = false;
      }
    }
  }
}

function place(x: number, z: number): string {
  return DISTRICT_NAMES[districtAt(x, z)];
}

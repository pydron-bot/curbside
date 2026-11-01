/**
 * The TEST menu's actions (Settings → Test tools; the sheet is
 * ui/testMenu.ts): cheats on the player, cars spawned beside them, the
 * clock, the rain and slow motion, teleports, forcing the city's scenes,
 * labels, and the save tools. Each applies at once and returns a short
 * notice (the sheet shows it, the HUD feed too).
 *
 * Everything but the labels overlay and exporting the save is a cheat: it
 * taints the life (Player.markCheated), which then earns no CRED, best or
 * medal, like god mode. Slow motion left on taints each new life too.
 * Where things go is pure and tested (testSpots.ts), as are the save edits
 * (saveTools.ts). Glue: main.ts creates one and passes the world in.
 */
import type { EventBus } from '../core/events';
import { onSettingsChange, settings, updateSettings } from '../core/settings';
import { VEHICLE_SPECS, createVehicleState, type VehicleArchetype } from '../entities/vehicle';
import type { WeaponKind } from '../systems/weapons';
import { WEAPONS, WEAPON_ORDER } from '../systems/weapons';
import { applyDamage, stepDamage } from '../systems/damage';
import type { StaticGrid } from '../world/collision';
import type { City } from '../world/city';
import { DISTRICT_NAMES, districtAt } from '../world/districts';
import type { CityLife } from './cityLife';
import type { Heat } from './heat';
import { CAR_NAMES } from './modes/exports';
import { FRENZIES } from './modes/frenzies';
import { PACKAGE_COUNT } from './modes/packages';
import { SAFEHOUSE, placePayphones } from './modes/places';
import { MAX_ARMOUR, type Player } from './player';
import { trafficPaint, type Population, type Vehicle } from './population';
import type { ProgressDirector } from './progressDirector';
import { addCredLevel, exportSave, importSave, jumpToMission, maxPerks, replaceSave, resetCred, resetSave, setTutorial, unlockAllMissions } from './saveTools';
import { levelFor } from './cred';
import { CarAlarms } from './scenes/alarms';
import { FireCrews } from './scenes/fireCrews';
import { Tows } from './scenes/tows';
import { districtCentre, snapOnFoot, snapToLane, spawnBeside, type Free, type Spot } from './testSpots';
import { len2 } from '../core/len';

/** Every vehicle, in the order the picker lists them. */
export const ARCHETYPES = Object.keys(VEHICLE_SPECS) as VehicleArchetype[];

export const TIME_PRESETS: ReadonlyArray<readonly [string, number]> = [
  ['DAWN', 6.4],
  ['NOON', 12.5],
  ['GOLDEN HOUR', 18.2],
  ['DUSK', 19.6],
  ['MIDNIGHT', 0],
];
export const SLOW_MO = [0.25, 0.5, 1] as const;
export type RainMode = 'on' | 'off' | 'auto';

export type SceneId =
  | 'ambulance'
  | 'fire'
  | 'tow'
  | 'alarm'
  | 'chaseCar'
  | 'chaseBike'
  | 'chaseFoot'
  | 'race'
  | 'accident'
  | 'doublePark'
  | 'bus'
  | 'iceCream'
  | 'vendors'
  | 'busker'
  | 'fight'
  | 'mugging'
  | 'turf'
  | 'dogs'
  | 'rain';

export const SCENES: ReadonlyArray<readonly [SceneId, string]> = [
  ['ambulance', 'AMBULANCE CALL'],
  ['fire', 'FIRE + TRUCK'],
  ['tow', 'TOW TRUCK'],
  ['alarm', 'CAR ALARM'],
  ['chaseCar', 'CHASE · CAR'],
  ['chaseBike', 'CHASE · SCOOTER'],
  ['chaseFoot', 'CHASE · ON FOOT'],
  ['race', 'STREET RACE'],
  ['accident', 'ACCIDENT'],
  ['doublePark', 'DOUBLE-PARKED TRUCK'],
  ['bus', 'BUS STOP'],
  ['iceCream', 'ICE CREAM VAN'],
  ['vendors', 'FOOD-CART RUSH'],
  ['busker', 'BUSKER'],
  ['fight', 'FIGHT'],
  ['mugging', 'MUGGING'],
  ['turf', 'TURF WAR'],
  ['dogs', 'STRAY DOG'],
  ['rain', 'RAIN CROWD'],
];

/** People scenes with a force() of their own, by the scene's `kind`. */
const PEOPLE_KIND: Partial<Record<SceneId, string>> = {
  bus: 'buses',
  iceCream: 'iceCream',
  vendors: 'vendors',
  busker: 'buskers',
  fight: 'fights',
  mugging: 'muggings',
};

export interface Landmark {
  id: string;
  label: string;
  x: number;
  z: number;
}

/** A forced shower lasts this long (until set back to auto), s. */
const HOLD = Infinity;
/** The fire's car goes up this far off: clear of the 9 m blast, and on a phone often still on screen, m. */
const FIRE_RING = [11, 24] as const;
/** The car for the tow truck is left this far off, m. */
const TOW_RING = [8, 18] as const;
/** The clock's normal pace (TimeOfDay's default: a day in 12 minutes), game hours per second. */
const CLOCK_SPEED = 24 / (12 * 60);

export interface TestToolsDeps {
  bus: EventBus;
  player: Player;
  vehicles: Vehicle[];
  population: Population;
  heat: Heat;
  cityLife: CityLife;
  progress: ProgressDirector;
  city: City;
  /** The game clock (look.time). */
  time: { hour: number; speed: number; set(hour: number): void };
  /** The rain (fx.weather). */
  weather: { rain: number; readonly isRaining: boolean; set(raining: boolean, seconds?: number): void };
  /** Walls, props and ramps: where nothing can be put. */
  grids: readonly StaticGrid[];
  rand: () => number;
  /** A car blows up (main's explode: charred, then the blast). */
  explode(v: Vehicle): void;
  /** A car back to full health and its proper look (main's resetVehicle). */
  repair(v: Vehicle): void;
  /** The player was moved: snap the camera, fill the streets round the new spot. */
  moved(): void;
  /** Start the page again (after the save is replaced). */
  reload(): void;
}

export class TestTools {
  /** Slow motion: multiplies the sim's time (1 = normal). */
  timeScale = 1;
  rain: RainMode = 'auto';
  /** Spawning a car puts the player in it. */
  getIn = true;
  readonly landmarks: Landmark[];
  private readonly phones = new Map(placePayphones().map((p) => [p.id, p]));
  private ignore: Vehicle | null = null;
  private readonly spot: Spot = { x: 0, z: 0, heading: 0 };
  /** What the sheet shows changed (time, rain, toggles). */
  onChange: () => void = () => {};

  constructor(private readonly d: TestToolsDeps) {
    const neon = districtCentre(d.city, 'arts');
    this.landmarks = [
      { id: 'safehouse', label: 'SAFEHOUSE', x: SAFEHOUSE.x, z: SAFEHOUSE.z },
      { id: 'hospital', label: 'HOSPITAL', x: d.cityLife.hospital.x, z: d.cityLife.hospital.z },
      { id: 'neon', label: DISTRICT_NAMES.arts, x: neon.x, z: neon.z },
      { id: 'docks', label: 'DOCKS', x: d.progress.exports.docks.x, z: d.progress.exports.docks.z },
    ];
    // Slow motion carries on into the next life: so does the taint.
    d.bus.on('respawn', () => {
      if (this.timeScale !== 1) d.player.markCheated();
    });
    // Test tools off: nothing of theirs stays on.
    onSettingsChange((s) => {
      if (s.testTools) return;
      if (s.godMode) updateSettings({ godMode: false });
      this.timeScale = 1;
    });
  }

  get frozen(): boolean {
    return this.d.time.speed === 0;
  }

  // --- Player ---

  god(): string {
    const on = !settings.godMode;
    updateSettings({ godMode: on });
    this.cheat();
    return on ? "GOD MODE ON · CAN'T DIE OR GET BUSTED" : 'GOD MODE OFF';
  }

  heal(): string {
    const p = this.d.player;
    if (!this.canAct()) return 'NOT WHILE WASTED OR BUSTED';
    this.cheat();
    p.health = p.maxHealth;
    p.armour = MAX_ARMOUR;
    return 'HEALED · FULL ARMOUR';
  }

  weapons(): string {
    if (!this.canAct()) return 'NOT WHILE WASTED OR BUSTED';
    this.cheat();
    const a = this.d.player.arsenal;
    for (const k of WEAPON_ORDER) a.ammo.set(k, WEAPONS[k].maxAmmo);
    a.current ??= 'pistol' satisfies WeaponKind;
    return 'EVERY WEAPON · FULL AMMO';
  }

  wanted(stars: number): string {
    if (!this.canAct()) return 'NOT WHILE WASTED OR BUSTED';
    this.cheat();
    if (stars <= 0) return this.clearWanted();
    this.d.heat.wanted.force(stars);
    return `WANTED ${'★'.repeat(stars)}`;
  }

  clearWanted(): string {
    this.cheat();
    this.d.heat.wanted.clear('reset');
    this.d.heat.police.standDown();
    return 'WANTED CLEARED';
  }

  // --- Vehicles ---

  spawn(archetype: VehicleArchetype): string {
    const p = this.d.player;
    if (!this.canAct()) return 'NOT WHILE WASTED OR BUSTED';
    const at = p.position;
    const heading = p.driving ? p.driving.sim.heading : p.ped.heading;
    const spot = this.besideOrNull(at.x, at.z, heading, 4.5, 16, p.driving);
    if (!spot) return 'NO ROOM FOR A CAR HERE';
    this.cheat();
    const v = this.place(archetype, spot);
    const name = CAR_NAMES[archetype];
    if (!this.getIn) return `${name} BESIDE YOU`;
    this.d.progress.board(v);
    return `IN A ${name}`;
  }

  repairCar(): string {
    const v = this.d.player.driving;
    if (!v) return 'GET IN A CAR FIRST';
    this.cheat();
    this.d.repair(v);
    v.tipped = false;
    return `${CAR_NAMES[v.archetype]} REPAIRED`;
  }

  /** Back on its wheels on the nearest clear lane, still. */
  unstick(): string {
    const p = this.d.player;
    let v = p.driving;
    const last = p.lastDriven;
    if (!v && last && len2(last.sim.x - p.ped.x, last.sim.z - p.ped.z) < 15 && !last.damage.wrecked) v = last;
    if (!v) return 'NO CAR TO FLIP';
    this.ignore = v;
    const spot = snapToLane(v.sim.x, v.sim.z, this.free, this.spot);
    this.ignore = null;
    if (!spot) return 'NOWHERE CLEAR TO PUT IT';
    this.cheat();
    v.tipped = false;
    Object.assign(v.sim, createVehicleState(spot.x, spot.z, spot.heading));
    Object.assign(v.prev, v.sim);
    return 'BACK ON ITS WHEELS';
  }

  // --- World ---

  setHour(hour: number, label: string): string {
    this.cheat();
    this.d.time.set(hour);
    this.onChange();
    return `TIME · ${label}`;
  }

  freeze(): string {
    this.cheat();
    const t = this.d.time;
    t.speed = t.speed === 0 ? CLOCK_SPEED : 0;
    this.onChange();
    return t.speed === 0 ? 'TIME FROZEN' : 'TIME RUNNING';
  }

  setRain(mode: RainMode): string {
    this.cheat();
    const w = this.d.weather;
    this.rain = mode;
    if (mode === 'auto') w.set(w.isRaining);
    else {
      // At once, not over the usual ramp: there's something to look at now.
      w.set(mode === 'on', HOLD);
      w.rain = mode === 'on' ? 1 : 0;
    }
    this.onChange();
    return mode === 'auto' ? 'RAIN · AUTO' : mode === 'on' ? 'RAIN ON' : 'RAIN OFF';
  }

  slowMo(scale: number): string {
    if (scale !== 1) this.cheat();
    this.timeScale = scale;
    this.onChange();
    return scale === 1 ? 'NORMAL SPEED' : `SLOW MOTION ${scale}×`;
  }

  labels(): string {
    updateSettings({ debugLabels: !settings.debugLabels });
    this.onChange();
    return settings.debugLabels ? 'LABELS ON' : 'LABELS OFF';
  }

  // --- Teleport ---

  /** To the street nearest (x, z): on foot, or with the car on its nearest lane. */
  teleport(x: number, z: number): string {
    const p = this.d.player;
    if (!this.canAct()) return 'NOT WHILE WASTED OR BUSTED';
    const car = p.driving;
    this.ignore = car;
    const spot = car ? snapToLane(x, z, this.free, this.spot) : snapOnFoot(x, z, this.free, this.spot);
    this.ignore = null;
    if (!spot) return 'NOWHERE CLEAR THERE';
    this.cheat();
    if (car) {
      Object.assign(car.sim, createVehicleState(spot.x, spot.z, spot.heading));
      Object.assign(car.prev, car.sim);
    } else {
      Object.assign(p.ped, { x: spot.x, z: spot.z, vx: 0, vz: 0 });
      Object.assign(p.prev, p.ped);
    }
    this.d.moved();
    return `TELEPORTED · ${DISTRICT_NAMES[districtAt(spot.x, spot.z)]}`;
  }

  landmark(id: string): string {
    const l = this.landmarks.find((m) => m.id === id);
    return l ? this.teleport(l.x, l.z).replace(/·.*$/, `· ${l.label}`) : 'NO SUCH PLACE';
  }

  // --- Scenes ---

  scene(id: SceneId): string {
    const life = this.d.cityLife;
    this.cheat();
    switch (id) {
      case 'ambulance':
        return life.medics.force() ? 'SOMEONE DOWN · AMBULANCE CALLED' : 'NOBODY NEAR TO HELP';
      case 'fire':
        return this.fire();
      case 'tow':
        return this.tow();
      case 'alarm':
        return this.alarm();
      case 'chaseCar':
      case 'chaseBike':
      case 'chaseFoot':
        return life.chases.begin(id === 'chaseCar' ? 'car' : id === 'chaseBike' ? 'bike' : 'foot') ? 'POLICE CHASE' : 'NO CHASE (ONE ON, OR NO ROOM)';
      case 'race':
        return life.races.begin() ? 'STREET RACE' : 'NO RACE (NO ROOM)';
      case 'accident':
        return life.accidents.begin() ? 'ACCIDENT' : 'NO ACCIDENT · NO TWO CARS CLOSE: TRY AGAIN';
      case 'doublePark':
        return life.doubleParking.begin(true) ? 'DOUBLE-PARKED TRUCK' : 'TRUCK ON ITS WAY · STOPS AT THE NEXT SPOT';
      case 'turf':
        life.turfWar.soon();
        return this.holds() ? `TURF WAR · HELD (${this.holds()})` : 'TURF WAR STARTING';
      case 'dogs':
        return life.dogs.force() ? 'A STRAY DOG' : 'NO DOG (TOO MANY, OR NO PAVEMENT)';
      case 'rain':
        this.setRain('on');
        return 'RAIN · PEOPLE SHELTER';
      default: {
        const kind = PEOPLE_KIND[id]!;
        const s = life.scenes.find((x) => (x as { kind?: string }).kind === kind) as { force?(): boolean } | undefined;
        const label = SCENES.find(([k]) => k === id)![1];
        return s?.force?.() ? label : `NO ${label} NEAR`;
      }
    }
  }

  // --- Save ---

  credLevel(): string {
    const pr = this.d.progress.progress;
    this.cheat();
    const added = addCredLevel(pr.data.cred);
    this.saved();
    return `CRED +${added} · LEVEL ${levelFor(pr.data.cred.total).level}`;
  }

  maxPerks(): string {
    this.cheat();
    maxPerks(this.d.progress.progress.data.cred);
    this.saved();
    return 'EVERY PERK MAXED';
  }

  resetCred(): string {
    this.cheat();
    resetCred(this.d.progress.progress.data.cred);
    this.saved();
    return 'CRED RESET';
  }

  cash(): string {
    this.cheat();
    this.d.progress.progress.earn(10000, 'test');
    this.saved();
    return '+$10,000';
  }

  /** The story jobs, in order, with their chapter (the picker). */
  get jobs(): ReadonlyArray<{ id: string; title: string; chapter: number; passed: boolean; next: boolean }> {
    const m = this.d.progress.missions;
    const done = this.d.progress.progress.data.missions;
    const next = m.next?.id;
    return m.missions.map((j) => ({ id: j.id, title: j.title, chapter: j.chapter ?? 1, passed: done.includes(j.id), next: j.id === next }));
  }

  unlockMissions(): string {
    this.cheat();
    const m = this.d.progress.missions;
    const n = unlockAllMissions(this.d.progress.progress.data, m.missions.map((j) => j.id));
    m.refresh();
    this.saved();
    return n ? `${n} JOBS PASSED · REPEATS RING` : 'ALL JOBS WERE PASSED';
  }

  /** Make a job the next story job, and go to its payphone. */
  jumpTo(id: string): string {
    const pd = this.d.progress;
    if (pd.busy) return 'FINISH THE ACTIVITY FIRST';
    const m = pd.missions;
    const job = m.missions.find((j) => j.id === id);
    if (!job || !jumpToMission(pd.progress.data, m.missions.map((j) => j.id), id)) return 'NO SUCH JOB';
    this.cheat();
    m.refresh();
    this.saved();
    const phone = this.phones.get(job.phone);
    // A few steps from the phone, so it rings as you walk up.
    if (phone && !this.d.player.driving) this.teleport(phone.x + 5, phone.z);
    return `NEXT JOB · ${job.title}`;
  }

  tutorial(done: boolean): string {
    this.cheat();
    setTutorial(this.d.progress.progress.data, done);
    this.saved();
    return done ? 'TUTORIAL DONE' : 'TUTORIAL RESET';
  }

  /** The save as text (written first, so it's what storage holds). */
  exportText(): string {
    this.d.progress.progress.flush();
    return exportSave(this.d.progress.progress.data);
  }

  /** Replace the save with pasted text and start again; the error if it isn't a save. */
  importText(text: string): string | null {
    const pd = this.d.progress;
    const r = importSave(text, {
      packages: PACKAGE_COUNT,
      frenzies: FRENZIES.map((f) => f.id),
      missions: pd.missions.missions.map((j) => j.id),
    });
    if (!r.ok) return r.error;
    replaceSave(pd.progress.data, r.save);
    this.saved();
    this.d.reload();
    return null;
  }

  resetSave(): void {
    resetSave(this.d.progress.progress.data);
    this.saved();
    this.d.reload();
  }

  // --- Internals ---

  private canAct(): boolean {
    const p = this.d.player;
    return p.alive && !p.arrested;
  }

  private cheat(): void {
    this.d.player.markCheated();
  }

  private saved(): void {
    const pr = this.d.progress.progress;
    pr.markDirty();
    pr.flush();
  }

  /** What holds the loud scenes off right now, if anything. */
  private holds(): string {
    const life = this.d.cityLife;
    if (life.d.activity()) return 'ACTIVITY';
    if (life.d.stars() > 0) return 'WANTED';
    if (life.d.tutorial()) return 'TUTORIAL';
    return '';
  }

  /** A car blown up a safe way off; a fire truck comes for it. */
  private fire(): string {
    const p = this.d.player;
    const at = p.position;
    const spot = this.besideOrNull(at.x, at.z, p.ped.heading, FIRE_RING[0], FIRE_RING[1], p.driving);
    if (!spot) return 'NO ROOM FOR A FIRE HERE';
    const v = this.place('sedan', spot);
    applyDamage(v.damage, v.damage.maxHealth);
    if (stepDamage(v.damage, 1)) this.d.explode(v);
    const crews = FireCrews.of(this.d.cityLife);
    return crews?.force() ? 'CAR FIRE · FIRE TRUCK CALLED' : 'CAR FIRE (NO TRUCK FREE)';
  }

  /** An abandoned car left in the road nearby, and a tow truck for it. */
  private tow(): string {
    const p = this.d.player;
    const at = p.position;
    const spot = this.besideOrNull(at.x, at.z, p.ped.heading, TOW_RING[0], TOW_RING[1], p.driving);
    if (!spot) return 'NO ROOM FOR A CAR HERE';
    const v = this.place('compact', spot);
    v.towable = true;
    const tows = this.d.cityLife.scenes.find((s): s is Tows => s instanceof Tows);
    return tows?.force(v) ? 'TOW TRUCK CALLED' : 'NO TOW TRUCK FREE';
  }

  /** The nearest parked car's alarm (one parked beside you if there's none). */
  private alarm(): string {
    const alarms = CarAlarms.of(this.d.cityLife);
    if (!alarms) return 'NO ALARMS';
    if (alarms.force()) return 'CAR ALARM';
    const p = this.d.player;
    const at = p.position;
    const spot = this.besideOrNull(at.x, at.z, p.ped.heading, 6, 16, p.driving);
    if (!spot) return 'NO PARKED CAR NEAR';
    const v = this.place('sedan', spot);
    v.parked = true;
    return alarms.force(v) ? 'CAR ALARM' : 'NO ALARM';
  }

  private besideOrNull(x: number, z: number, heading: number, min: number, max: number, ignore: Vehicle | null): Spot | null {
    this.ignore = ignore;
    const spot = spawnBeside(x, z, heading, this.free, min, max, this.spot);
    this.ignore = null;
    return spot;
  }

  /** A car of `archetype` at `spot`, empty and still (an abandoned car: recycled once far and unseen). */
  private place(archetype: VehicleArchetype, spot: Spot): Vehicle {
    const v = this.d.population.takeVehicle(archetype, trafficPaint(archetype, this.d.rand));
    v.police = false;
    v.ai = null;
    Object.assign(v.sim, createVehicleState(spot.x, spot.z, spot.heading));
    Object.assign(v.prev, v.sim);
    return v;
  }

  /** Clear of walls, props, ramps, cars and the player (testSpots' Free). */
  private readonly free: Free = (x, z, r) => {
    for (const g of this.d.grids) {
      const near = g.near(x, z, r);
      for (let i = 0; i < near.length; i++) {
        const o = near[i];
        if (x > o.minX - r && x < o.maxX + r && z > o.minZ - r && z < o.maxZ + r) return false;
      }
    }
    for (const v of this.d.vehicles) {
      if (v === this.ignore || !v.mesh.root.visible) continue;
      const reach = v.sim.body?.reach ?? 2.4;
      if (len2(v.sim.x - x, v.sim.z - z) < r + reach) return false;
    }
    const p = this.d.player;
    return p.driving !== null || len2(p.ped.x - x, p.ped.z - z) > r + 0.5;
  };
}

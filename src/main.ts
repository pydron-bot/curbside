import { Scene, type ColorRepresentation } from 'three';
import { registerSW } from 'virtual:pwa-register';
import { events } from './core/events';
import { Input } from './core/input';
import { FixedStep } from './core/loop';
import { UpdateGate } from './core/updateGate';
import { PLAYER_ON_FOOT, stepPedestrian } from './entities/pedestrian';
import {
  VEHICLE_HEALTH,
  VEHICLE_SPECS,
  createVehicleState,
  driverDoorPosition,
  forwardSpeed,
  lateralSpeed,
  lerpAngle,
  speed,
  stepVehicle,
  type VehicleArchetype,
  type VehicleControls,
} from './entities/vehicle';
import { Player } from './game/player';
import { CROWD_DESPAWN, Population, type CrowdPed, type ParkingSpot, type Vehicle } from './game/population';
import { Effects } from './render/effects';
import { FxDirector } from './render/fxDirector';
import { CameraRig } from './render/cameraRig';
import { DynamicResolution } from './render/dynamicResolution';
import { Look, type PlayerView } from './render/look';
import { createRenderer, precompile } from './render/post';
import { getQuality } from './render/quality';
import { VehicleModels } from './render/vehicleModels';
import { charVehicle, restoreVehicleLook } from './render/vehicleLooks';
import { PUNCH_REACH, knockDown, provoke, resumeWalking, scare, spawnPed, stepCrowdPed, type Target } from './systems/crowd';
import { VEHICLE_SHARE, WEAPONS, WEAPON_ORDER, autoAim, rayCircle, rayRect, type WeaponKind } from './systems/weapons';
import { HEALTH_PICKUP, PICKUP_RESPAWN, generatePickups, pickupAt, respawnPickups } from './world/pickups';
import {
  applyDamage,
  blamesPlayer,
  blastDamage,
  createDamage,
  damageStage,
  impactDamage,
  markPlayerHit,
  stepDamage,
} from './systems/damage';
import {
  CAR_CIRCLE_RADIUS,
  carCircles,
  collidePedStatic,
  collidePedVehicle,
  collideVehicleStatic,
  collideVehicles,
} from './systems/physics';
import { Score, type Award } from './systems/score';
import { driveAi, type Obstacle } from './systems/traffic';
import type { PauseReason } from './ui/pauseOverlay';
import { loadBest } from './ui/scoreHud';
import { mountTouchControls } from './ui/touchControls';
import { AIM_SNAP, AIM_TURN_RATE, aimHeading, approachAngle } from './core/aim';
import { getDevice } from './render/quality';
import { AttractCamera } from './ui/attract';
import { FrontDoor } from './ui/frontDoor';
import { blockBrowserGestures } from './ui/gestures';
import { Haptics } from './ui/haptics';
import { Hud, createHudFrame, gaugeTopSpeed, type CarHud } from './ui/hud';
import { updateMouseAim } from './ui/mouseAim';
import { Radar } from './ui/radar';
import { ThreatIndicators } from './ui/threats';
import { enterGameMode } from './ui/titleScreen';
import { generateCity, type Rect } from './world/city';
import { StaticGrid } from './world/collision';
import { mulberry32 } from './world/random';
import { GameAudio, createAudioFrame, createCarSound, describeCar } from './audio/gameAudio';
import { mountRadioToast } from './ui/radioToast';

const app = document.getElementById('app')!;

/** How close (m, centre to centre) you must be to get into a car. */
const ENTER_RANGE = 4;
/** Cars moving faster than this can't be boarded. */
const ENTER_MAX_SPEED = 6;
const CAMERA_FOOT = [20, 24] as const;
const CAMERA_CAR = [26, 64] as const;
/** The title screen's slow cruise over traffic. */
const CAMERA_ATTRACT = [34, 46] as const;
const BLAST_RADIUS = 9;
const PUNCH_RANGE = 1.5;
const PUNCH_COOLDOWN = 0.4;
/** Passing this close (centre to centre) at speed without touching is a near miss. */
const NEAR_MISS_DIST = 3.4;
const NEAR_MISS_SPEED = 10;
/** Explosions further than this from the player don't score. */
const BOOM_SCORE_RANGE = 60;
const SPAWN_POINT = { x: 9.5, z: 9.5 };
const NPC_PUNCH_DAMAGE = 9;
const NPC_SHOT_DAMAGE = 8;
const NPC_SHOT_RANGE = 26;
/** Random aim error of NPC shooters, radians. */
const NPC_SPREAD = 0.14;
/** Crashes slower than this (m/s closing speed) aren't worth an event. */
const CRASH_EVENT_MIN = 2.5;

// --- Renderer ---
const renderer = createRenderer();
app.append(renderer.domElement);
const resolution = new DynamicResolution(renderer);

// --- Scene ---
const scene = new Scene();
const city = generateCity(1337);
const collision = new StaticGrid(city.obstacles);
const rand = mulberry32(Date.now() >>> 0);
const pickups = generatePickups(1337);
const rig = new CameraRig(1);
// Lights, time of day, ground, city, and the batched people/car/glow renderers.
const look = new Look(renderer, scene, city, rig, pickups, app);
const effects = new Effects(scene);

// --- Vehicles ---
const vehicles: Vehicle[] = [];

function createVehicle(archetype: VehicleArchetype, paint: ColorRepresentation): Vehicle {
  const sim = createVehicleState(0, 0, 0);
  const mesh = look.cars.create(archetype, paint);
  scene.add(mesh.root);
  return {
    archetype,
    paint,
    sim,
    prev: { ...sim },
    mesh,
    ai: null,
    damage: createDamage(VEHICLE_HEALTH[archetype]),
    wreckAge: 0,
    charred: false,
  };
}

/** Parked at the kerbs around the spawn intersection; put back on every respawn. */
const PARKED: ParkingSpot[] = [
  { archetype: 'sedan', x: 5.5, z: -14, heading: Math.PI, paint: '#c8342b' },
  { archetype: 'compact', x: -5.5, z: 16, heading: 0, paint: '#2f6fc0' },
  { archetype: 'van', x: 20, z: 5.5, heading: Math.PI / 2, paint: '#d9d6cc' },
  { archetype: 'sports', x: -22, z: -5.5, heading: -Math.PI / 2, paint: '#e8b923' },
  { archetype: 'police', x: 5.5, z: 34, heading: Math.PI, paint: '#f2f2f2' },
];

/** Ready a recycled car for traffic: full health, and its proper look if it was a wreck or restyled. */
function resetVehicle(v: Vehicle, restyled: boolean) {
  v.damage = createDamage(VEHICLE_HEALTH[v.archetype]);
  v.wreckAge = 0;
  if (v.charred || restyled) restoreVehicleLook(v, look.cars);
}

const population = new Population(
  vehicles,
  {
    createVehicle,
    resetVehicle,
    createPedModel: (outfit) => {
      const model = look.characters.create(outfit);
      scene.add(model.root);
      return model;
    },
  },
  rand,
);

// Placeholder boxes show until the Blender-built models arrive.
VehicleModels.load('/assets/vehicles.glb').then(
  (models) => {
    look.cars.setModels(models);
    resolution.holdOff(2); // new geometry uploads
    // Behind the title: compile the new car materials before anyone plays.
    requestAnimationFrame(() => warmShaders());
  },
  (err) => console.error('Failed to load vehicles.glb', err),
);

// --- Player ---
const player = new Player(events, SPAWN_POINT.x, SPAWN_POINT.z);
const playerModel = look.characters.create();
scene.add(playerModel.root);

let viewW = 0;
let viewH = 0;
/**
 * Match the drawing buffer to #app's laid-out size. Checked every frame rather
 * than on 'resize': iOS home-screen apps fire resize before the rotated
 * dimensions are available, which left the canvas stuck at portrait size.
 * Returns true when the size changed (the buffer is cleared and must be redrawn).
 */
function fitToScreen(): boolean {
  const w = app.clientWidth;
  const h = app.clientHeight;
  if (w === viewW && h === viewH) return false;
  if (w === 0 || h === 0) return false;
  viewW = w;
  viewH = h;
  renderer.setSize(w, h, false); // CSS sizes the canvas; only set the buffer
  rig.resize(w / h);
  return true;
}
fitToScreen();
rig.setHeights(...CAMERA_FOOT);
rig.snapTo(player.ped.x, player.ped.z);

const viewRect: Rect = { minX: 0, minZ: 0, maxX: 0, maxZ: 0 };
/** Attract mode: the sim runs behind the title with the camera cruising over traffic. */
const attract = new AttractCamera(rand);
attract.start(SPAWN_POINT.x, SPAWN_POINT.z);
const keepVehicles: Array<Vehicle | null> = [null, null];
/**
 * Recycle and top up traffic and crowd; `seed` fills the streets from scratch
 * and puts the spawn point's parked cars back.
 */
function maintainPopulation(seed = false) {
  // Behind the title the streets follow the attract camera instead.
  const at = attract.active ? attract : player.position;
  keepVehicles[0] = player.driving;
  keepVehicles[1] = player.lastDriven;
  population.maintain({
    x: at.x,
    z: at.z,
    vx: at.vx,
    vz: at.vz,
    view: rig.visibleGround(viewRect),
    keep: keepVehicles,
    trafficScale: getQuality().trafficScale,
    crowdScale: getQuality().crowdScale,
    seed,
    parked: seed ? PARKED : undefined,
  });
}
maintainPopulation(true);

// --- Score ---
const score = new Score(loadBest());
/** Every score award goes out as an event; the HUD (and audio, etc.) listen. */
const award = (a: Award | null) => {
  if (a) events.emit({ type: 'award', award: a });
};
/** Sim time each vehicle last earned a near miss, so one pass scores once. */
const nearMissAt = new Map<Vehicle, number>();
let simTime = 0;

// --- Audio (unlocks on the first tap / click / key) ---
const audio = new GameAudio({ best: score.best });
const audioFrame = createAudioFrame(vehicles);
const audioCar = createCarSound();
mountRadioToast(document.body, audio);

// --- Input ---
const input = new Input();
input.attachMouse(renderer.domElement);
const haptics = new Haptics(input, events);
const touch = mountTouchControls(document.body, input.touch, haptics);
input.addResetHook(() => touch.reset());
blockBrowserGestures([renderer.domElement, touch.layer]);
/** World heading the player is aiming this frame (stick, mouse or pad), or null. */
let aimHeadingNow: number | null = null;
const NO_CONTROLS: VehicleControls = { throttle: 0, steer: 0, handbrake: false };
const NO_MOVE = { x: 0, y: 0, sprint: false };

// --- Presentation: react to what the simulation reports ---
// Effects, camera feel, hit-stop, body motion and weather (all bus-driven).
const fx = new FxDirector({
  bus: events,
  effects,
  rig,
  look,
  renderer,
  scene,
  vehicles,
  crowd: population.crowd,
  player,
  playerModel,
  score,
  city,
  overlayParent: app,
  audio,
});
events.on('enterVehicle', () => {
  playerModel.root.visible = false;
  rig.setHeights(...CAMERA_CAR);
  input.resetActions();
});
events.on('exitVehicle', () => {
  playerModel.root.visible = true;
  rig.setHeights(...CAMERA_FOOT);
  input.resetActions();
});
// Nobody keeps fighting a dead man.
events.on('playerDied', () => calmHostiles());

/** Everyone fighting or shooting the player goes back to walking (death, a fresh run, the title). */
function calmHostiles() {
  for (const c of population.crowd) {
    c.agent.provoked = false;
    if (c.agent.mode === 'fight' || c.agent.mode === 'shoot') resumeWalking(c.agent);
  }
}

/** Announce weapon changes from any cause (switch, pickup, running dry, death). */
let shownWeapon: WeaponKind | null = null;
function syncWeapon() {
  const w = player.arsenal.current;
  if (w === shownWeapon) return;
  shownWeapon = w;
  events.emit({ type: 'weaponSwitch', weapon: w });
}

function nearestEnterable(): Vehicle | null {
  if (!player.canEnter) return null;
  let best: Vehicle | null = null;
  let bestDist = ENTER_RANGE;
  for (const v of vehicles) {
    const d = Math.hypot(v.sim.x - player.ped.x, v.sim.z - player.ped.z);
    if (d < bestDist && speed(v.sim) < ENTER_MAX_SPEED && !v.damage.wrecked) {
      best = v;
      bestDist = d;
    }
  }
  return best;
}

/** The NPC driver gets out on the driver's side and runs from (fromX, fromZ). */
function ejectDriver(v: Vehicle, fromX: number, fromZ: number) {
  v.ai = null;
  // Far from the player nobody would see them, and Population would just recycle them.
  const at = player.position;
  if (Math.hypot(v.sim.x - at.x, v.sim.z - at.z) > CROWD_DESPAWN) return;
  const door = driverDoorPosition(v.sim);
  const agent = spawnPed(0, 0, 0, 0, rand);
  Object.assign(agent.s, { x: door.x, z: door.z, vx: 0, vz: 0, heading: v.sim.heading });
  scare(agent, fromX, fromZ, 5);
  population.addPed(agent);
}

/** Get in; if someone's driving, throw them out first (carjack). */
function boardVehicle(v: Vehicle) {
  if (!player.canEnter) return;
  if (v.ai) {
    ejectDriver(v, player.ped.x, player.ped.z);
    events.emit({ type: 'carjack', x: v.sim.x, z: v.sim.z });
    award(score.award('carjack'));
  }
  player.enter(v);
}

/** Step out of the car; a slide in progress is banked. */
function leaveVehicle() {
  if (!player.driving) return;
  award(score.endDrift(true));
  player.exit();
}

function respawnPlayer() {
  score.resetRun();
  // A new run (or the title) starts with nobody after you.
  calmHostiles();
  player.respawn(SPAWN_POINT.x, SPAWN_POINT.z);
  rig.snapTo(player.ped.x, player.ped.z);
  maintainPopulation(true);
  // The run is over anyway: a good moment to pick up a waiting app update.
  updates.atSafePoint();
}

// --- Simulation ---
const obstacles: Obstacle[] = [];
/** Obstacle records reused every step (one per car and ped). */
const obstaclePool: Obstacle[] = [];
function addObstacle(x: number, z: number, halfWidth: number) {
  const o = obstaclePool[obstacles.length] ?? (obstaclePool[obstacles.length] = { x: 0, z: 0, halfWidth: 0 });
  o.x = x;
  o.z = z;
  o.halfWidth = halfWidth;
  obstacles.push(o);
}
const vehicleStates: Array<Vehicle['sim']> = [];
const contact = { x: 0, z: 0 };

function simulate(dt: number) {
  const driving = player.driving;
  const playerControls = driving ? input.readVehicle(driving.sim, dt) : NO_CONTROLS;

  // What AI drivers need to avoid this step.
  obstacles.length = 0;
  for (const v of vehicles) addObstacle(v.sim.x, v.sim.z, 1);
  if (!driving && !attract.active) addObstacle(player.ped.x, player.ped.z, 0.4);
  for (const c of population.crowd) addObstacle(c.agent.s.x, c.agent.s.z, 0.4);

  for (const v of vehicles) {
    Object.assign(v.prev, v.sim);
    let controls = NO_CONTROLS;
    if (v.damage.wrecked) controls = NO_CONTROLS;
    else if (v === driving) controls = playerControls;
    // A car's own entry sits at distance 0, which clearDistance ignores.
    else if (v.ai) controls = driveAi(v.ai, v.sim, obstacles, rand, dt);
    stepVehicle(v.sim, controls, VEHICLE_SPECS[v.archetype], dt);
  }

  Object.assign(player.prev, player.ped);
  if (!driving) {
    stepPedestrian(player.ped, player.down || attract.active ? NO_MOVE : input.readMove(), PLAYER_ON_FOOT, dt);
    // Twin-stick: face the aim while walking (strafe), not the way you walk.
    if (aimHeadingNow !== null && !player.down) {
      player.ped.heading = approachAngle(player.ped.heading, aimHeadingNow, AIM_TURN_RATE * dt);
    }
  }

  vehicleStates.length = 0;
  for (const v of vehicles) vehicleStates.push(v.sim);
  const target = playerTarget();
  for (const c of population.crowd) {
    Object.assign(c.prev, c.agent.s);
    const wasDown = c.agent.mode === 'down';
    const event = stepCrowdPed(c.agent, vehicleStates, rand, dt, target);
    if (!wasDown && c.agent.mode === 'down') pedHitByCar(c, driving);
    if (event?.kind === 'punch' && !driving && player.alive && !attract.active) {
      const hit = Math.hypot(player.ped.x - c.agent.s.x, player.ped.z - c.agent.s.z) < PUNCH_REACH + 0.4;
      events.emit({ type: 'punch', x: c.agent.s.x, z: c.agent.s.z, hit, byPlayer: false });
      if (hit) {
        c.model.punch();
        player.hurt(NPC_PUNCH_DAMAGE);
      }
    } else if (event?.kind === 'shoot') {
      c.model.punch(); // same arm raise reads as aiming
      npcShoot(c.agent.s.x, c.agent.s.z, event.dirX, event.dirZ);
    }
  }

  // --- Collisions ---
  for (const v of vehicles) {
    const impact = collideVehicleStatic(v.sim, collision, contact);
    if (impact <= 0) continue;
    const hit = impactDamage(impact);
    applyDamage(v.damage, hit);
    if (v === driving && hit > 0) markPlayerHit(v.damage, simTime);
    if (impact > CRASH_EVENT_MIN) {
      events.emit({ type: 'crash', x: contact.x, z: contact.z, impact, against: 'static', involvesPlayer: v === driving });
    }
  }
  for (let i = 0; i < vehicles.length; i++) {
    for (let j = i + 1; j < vehicles.length; j++) {
      const a = vehicles[i];
      const b = vehicles[j];
      const impact = collideVehicles(a.sim, b.sim, contact);
      if (impact <= 0) continue;
      const hit = impactDamage(impact);
      applyDamage(a.damage, hit);
      applyDamage(b.damage, hit);
      const involvesPlayer = driving !== null && (a === driving || b === driving);
      if (involvesPlayer && hit > 0) {
        markPlayerHit(a.damage, simTime);
        markPlayerHit(b.damage, simTime);
      }
      if (impact > CRASH_EVENT_MIN) {
        events.emit({ type: 'crash', x: contact.x, z: contact.z, impact, against: 'vehicle', involvesPlayer });
      }
      if (involvesPlayer && impact > 6) {
        award(score.award('smash', Math.round(impact * 4)));
        // A hit isn't a near miss.
        nearMissAt.set(a === driving ? b : a, simTime);
      }
    }
  }

  // --- Stunt scoring ---
  simTime += dt;
  score.step(dt);
  if (driving && !driving.damage.wrecked) {
    const ds = driving.sim;
    award(score.drift(Math.abs(lateralSpeed(ds)), speed(ds), dt));
    if (speed(ds) > NEAR_MISS_SPEED) {
      for (const v of vehicles) {
        if (v === driving || v.damage.wrecked) continue;
        const d = Math.hypot(v.sim.x - ds.x, v.sim.z - ds.z);
        if (d > NEAR_MISS_DIST || d < 2.05) continue;
        if (Math.hypot(v.sim.vx - ds.vx, v.sim.vz - ds.vz) < NEAR_MISS_SPEED) continue;
        if (simTime - (nearMissAt.get(v) ?? -99) < 2.5) continue;
        nearMissAt.set(v, simTime);
        award(score.award('nearMiss'));
      }
    }
  }

  // --- Pickups ---
  respawnPickups(pickups, simTime);
  if (!driving && player.alive && !attract.active) {
    const pk = pickupAt(pickups, player.ped.x, player.ped.z);
    if (pk && (pk.kind !== 'health' || player.health < 100)) {
      pk.respawnAt = simTime + PICKUP_RESPAWN;
      if (pk.kind === 'health') {
        player.health = Math.min(100, player.health + HEALTH_PICKUP);
      } else {
        player.arsenal.pickUp(pk.kind);
        player.arsenal.current = pk.kind;
      }
      events.emit({ type: 'pickup', kind: pk.kind, x: pk.x, z: pk.z });
    }
  }
  if (player.step(dt)) respawnPlayer();

  // --- Fire and explosions ---
  for (const v of vehicles) {
    // NPC drivers bail out of burning cars.
    if (v.ai && v.damage.burning) ejectDriver(v, v.sim.x, v.sim.z);
    if (stepDamage(v.damage, dt)) explode(v);
  }
  if (!player.driving) {
    for (const s of vehicleStates) collidePedVehicle(player.ped, s);
    // Static last so a car can't shove the player into a wall.
    collidePedStatic(player.ped, collision);
  }
  for (const c of population.crowd) {
    if (c.agent.mode !== 'down') for (const s of vehicleStates) collidePedVehicle(c.agent.s, s);
    collidePedStatic(c.agent.s, collision);
  }
  syncWeapon();
}

/** A ped was knocked over by a car this step: if it was the player's, that's a hit and run. */
function pedHitByCar(c: CrowdPed, driving: Vehicle | null) {
  const s = c.agent.s;
  const byPlayer = driving !== null && Math.hypot(driving.sim.x - s.x, driving.sim.z - s.z) < 5;
  events.emit({ type: 'pedDown', x: s.x, z: s.z, cause: 'vehicle', byPlayer });
  if (driving && byPlayer) {
    award(score.award('hitAndRun'));
    provoke(c.agent, driving.sim.x, driving.sim.z);
  }
}

function explode(source: Vehicle) {
  const { x, z } = source.sim;
  const ownCar = player.driving === source;
  const byPlayer = ownCar || blamesPlayer(source.damage, simTime);
  charVehicle(source);
  source.wreckAge = 0;
  const distance = Math.hypot(rig.focusX - x, rig.focusZ - z);
  events.emit({ type: 'explosion', x, z, distance, byPlayer, ownCar });
  const at = player.position;
  if (!attract.active && Math.hypot(at.x - x, at.z - z) < BOOM_SCORE_RANGE) award(score.award('boom'));

  if (ownCar) {
    // The slide (if any) dies with the car; you're thrown clear and hurt once.
    score.endDrift(false);
    player.ownCarExploded();
  } else if (!player.driving && !attract.active) {
    const d = Math.hypot(player.ped.x - x, player.ped.z - z);
    if (d < BLAST_RADIUS) {
      player.hurt(blastDamage(d, BLAST_RADIUS, 60));
      player.knockDown(x, z, 6, 2, 'blast', byPlayer);
    }
  }
  for (const v of vehicles) {
    if (v === source) continue;
    const d = Math.hypot(v.sim.x - x, v.sim.z - z);
    const dmg = blastDamage(d, BLAST_RADIUS);
    if (dmg <= 0) continue;
    applyDamage(v.damage, dmg);
    // A chain reaction is still the player's doing.
    if (byPlayer) markPlayerHit(v.damage, simTime);
    const push = (dmg / 70) * 8;
    v.sim.vx += ((v.sim.x - x) / (d || 1)) * push;
    v.sim.vz += ((v.sim.z - z) / (d || 1)) * push;
  }
  for (const c of population.crowd) {
    const d = Math.hypot(c.agent.s.x - x, c.agent.s.z - z);
    if (d < BLAST_RADIUS) {
      if (c.agent.mode !== 'down') events.emit({ type: 'pedDown', x: c.agent.s.x, z: c.agent.s.z, cause: 'blast', byPlayer });
      knockDown(c.agent, x, z, 6, 3);
    } else if (d < 30) scare(c.agent, x, z, 4);
  }
}

function playerTarget(): Target {
  const at = player.position;
  // Behind the title the player is hidden and out of play: nobody comes for them.
  return { x: at.x, z: at.z, inCar: player.driving !== null, alive: player.alive && !attract.active };
}

type BulletHit = { kind: 'ped'; ped: CrowdPed } | { kind: 'vehicle'; v: Vehicle } | { kind: 'player' } | null;
const bulletCircles = [
  { x: 0, z: 0 },
  { x: 0, z: 0 },
  { x: 0, z: 0 },
];

/**
 * Nearest thing a bullet from (ox, oz) along unit (dx, dz) hits within range.
 * Reports where it stopped as a bulletHit event.
 */
function traceBullet(ox: number, oz: number, dx: number, dz: number, range: number, shooterIsPlayer: boolean): BulletHit {
  let best = range;
  let wall = false;
  let hit: BulletHit = null;
  for (const r of collision.near(ox + (dx * range) / 2, oz + (dz * range) / 2, range / 2 + 1)) {
    const t = rayRect(ox, oz, dx, dz, r);
    if (t < best) {
      best = t;
      wall = true;
    }
  }
  for (const c of population.crowd) {
    if (c.agent.mode === 'down') continue;
    const t = rayCircle(ox, oz, dx, dz, { x: c.agent.s.x, z: c.agent.s.z, r: 0.45 });
    if (t > 0.3 && t < best) {
      best = t;
      hit = { kind: 'ped', ped: c };
    }
  }
  for (const v of vehicles) {
    if (shooterIsPlayer && v === player.driving) continue;
    for (const c of carCircles(v.sim, bulletCircles)) {
      const t = rayCircle(ox, oz, dx, dz, { x: c.x, z: c.z, r: CAR_CIRCLE_RADIUS * 0.9 });
      if (t > 0.3 && t < best) {
        best = t;
        hit = { kind: 'vehicle', v };
      }
    }
  }
  if (!shooterIsPlayer && !player.driving && player.alive && !attract.active) {
    const t = rayCircle(ox, oz, dx, dz, { x: player.ped.x, z: player.ped.z, r: 0.45 });
    if (t > 0.3 && t < best) {
      best = t;
      hit = { kind: 'player' };
    }
  }
  events.emit({
    type: 'bulletHit',
    x: ox + dx * best,
    z: oz + dz * best,
    target: hit ? hit.kind : wall ? 'wall' : 'none',
    fromX: ox,
    fromZ: oz,
    byPlayer: shooterIsPlayer,
  });
  return hit;
}

function fireWeapon() {
  const kind = player.arsenal.tryFire();
  if (!kind) return;
  const w = WEAPONS[kind];
  const { x, z, heading } = player.ped;
  const targets = [
    ...population.crowd.filter((c) => c.agent.mode !== 'down').map((c) => c.agent.s),
    ...vehicles.filter((v) => !v.damage.wrecked).map((v) => v.sim),
  ];
  // A deliberate aim (stick, mouse, right stick) snaps within ~15°; otherwise assist around the facing.
  const aim =
    aimHeadingNow !== null ? autoAim(x, z, aimHeadingNow, targets, w.range, AIM_SNAP) : autoAim(x, z, heading, targets, w.range);
  player.ped.heading = Math.atan2(aim.x, aim.z);
  const ox = x + aim.x * 0.6;
  const oz = z + aim.z * 0.6;
  playerModel.punch();
  events.emit({ type: 'shot', x: ox, z: oz, dirX: aim.x, dirZ: aim.z, weapon: kind, byPlayer: true });
  for (let i = 0; i < w.pellets; i++) {
    const a = Math.atan2(aim.x, aim.z) + (rand() * 2 - 1) * w.spread;
    const hit = traceBullet(ox, oz, Math.sin(a), Math.cos(a), w.range, true);
    if (hit?.kind === 'ped') {
      const s = hit.ped.agent.s;
      if (hit.ped.agent.mode !== 'down') events.emit({ type: 'pedDown', x: s.x, z: s.z, cause: 'shot', byPlayer: true });
      knockDown(hit.ped.agent, x, z, 4, 5);
      provoke(hit.ped.agent, x, z);
      award(score.award('knockout'));
    } else if (hit?.kind === 'vehicle') {
      applyDamage(hit.v.damage, w.damage * VEHICLE_SHARE);
      markPlayerHit(hit.v.damage, simTime);
      if (hit.v.ai && rand() < 0.25) ejectDriver(hit.v, x, z);
    }
  }
  // Gunfire: most people run; armed ones nearby join in.
  for (const c of population.crowd) {
    const d = Math.hypot(c.agent.s.x - x, c.agent.s.z - z);
    if (d > 25) continue;
    if (c.agent.temper === 'armed' && d < 18 && rand() < 0.5) provoke(c.agent, x, z);
    else scare(c.agent, x, z, 4);
  }
}

function npcShoot(sx: number, sz: number, dirX: number, dirZ: number) {
  const a = Math.atan2(dirX, dirZ) + (rand() * 2 - 1) * NPC_SPREAD;
  const dx = Math.sin(a);
  const dz = Math.cos(a);
  const ox = sx + dx * 0.6;
  const oz = sz + dz * 0.6;
  events.emit({ type: 'shot', x: ox, z: oz, dirX: dx, dirZ: dz, weapon: null, byPlayer: false });
  const hit = traceBullet(ox, oz, dx, dz, NPC_SHOT_RANGE, false);
  if (hit?.kind === 'player') player.hurt(NPC_SHOT_DAMAGE);
  else if (hit?.kind === 'vehicle') applyDamage(hit.v.damage, NPC_SHOT_DAMAGE);
}

function tryPunch() {
  if (player.driving || !player.ready || player.punchCooldown > 0) return;
  player.punchCooldown = PUNCH_COOLDOWN;
  playerModel.punch();
  if (aimHeadingNow !== null) player.ped.heading = aimHeadingNow;
  const { x, z, heading } = player.ped;
  const fx = Math.sin(heading);
  const fz = Math.cos(heading);
  let landed = false;
  for (const c of population.crowd) {
    const dx = c.agent.s.x - x;
    const dz = c.agent.s.z - z;
    const d = Math.hypot(dx, dz);
    if (d < PUNCH_RANGE && (dx * fx + dz * fz) / (d || 1) > 0.4 && c.agent.mode !== 'down') {
      landed = true;
      events.emit({ type: 'pedDown', x: c.agent.s.x, z: c.agent.s.z, cause: 'punch', byPlayer: true });
      knockDown(c.agent, x, z);
      provoke(c.agent, x, z);
      award(score.award('knockout'));
    } else if (d < 10) scare(c.agent, x, z, 3);
  }
  events.emit({ type: 'punch', x: x + fx * 0.6, z: z + fz * 0.6, hit: landed, byPlayer: true });
}

// --- Loop ---
const loop = new FixedStep(1 / 60);
let last = performance.now();
let paused = false;
let maintainTimer = 0;

function frame(now: number) {
  requestAnimationFrame(frame);
  // Layout is clean at the start of a frame, so reading sizes here is free
  // (after this frame's DOM writes it would force a synchronous layout).
  const resized = fitToScreen();
  // Real time since the last frame; the sim never takes more than 0.25 s of it.
  const elapsed = (now - last) / 1000;
  const frameSeconds = Math.min(0.25, elapsed);
  last = now;
  input.pollGamepad();
  // Menus first: they take keyboard / pad navigation and pause toggles.
  frontDoor.update();
  if (paused) {
    // Resizing clears the canvas (rotating the phone while paused): redraw the
    // frozen scene behind the pause card.
    if (resized && !contextLost) look.render(rig.camera);
    return;
  }

  // Aim: the mouse needs the camera to find the ground under the cursor.
  updateMouseAim(input, rig.camera, player.ped.x, player.ped.z, viewW, viewH);
  const aim = input.readAim();
  const playing = !attract.active;
  aimHeadingNow = playing && !player.driving && player.ready && aim.active ? aimHeading(aim.x, aim.y) : null;
  const pressed = input.consumePunch();
  const cycle = input.consumeCycle();
  const acted = input.consumeAction();
  if (playing) {
    if (cycle !== 0 && !player.driving) player.arsenal.cycle(cycle);
    if (!player.driving && player.ready) {
      const gun = player.arsenal.current;
      if (gun) {
        if (pressed || aim.fire || (WEAPONS[gun].automatic && input.fireHeld)) fireWeapon();
      } else if (pressed || aim.fire) tryPunch();
    }
    if (acted && player.ready) {
      if (player.driving) leaveVehicle();
      else {
        const v = nearestEnterable();
        if (v) boardVehicle(v);
      }
    }
  }
  syncWeapon();

  if ((maintainTimer -= frameSeconds) <= 0) {
    maintainTimer = 0.25;
    maintainPopulation();
  }

  // Hit-stop slows the sim on big moments; the camera keeps real time.
  const alpha = loop.advance(frameSeconds * fx.simScale(frameSeconds), simulate);

  // Interpolate render state between the last two sim steps.
  // Read once per frame: the wheel steer and the engine sound share it.
  const controls = player.driving ? input.readVehicle(player.driving.sim) : null;
  const steer = controls ? controls.steer : 0;
  for (const v of vehicles) {
    v.mesh.root.position.set(lerp(v.prev.x, v.sim.x, alpha), 0, lerp(v.prev.z, v.sim.z, alpha));
    v.mesh.root.rotation.y = lerpAngle(v.prev.heading, v.sim.heading, alpha);
    for (const w of v.mesh.frontWheels) w.rotation.y = v === player.driving ? -steer * 0.5 : 0;
  }
  for (const c of population.crowd) {
    const s = c.agent.s;
    c.model.root.position.set(lerp(c.prev.x, s.x, alpha), 0, lerp(c.prev.z, s.z, alpha));
    c.model.root.rotation.y = lerpAngle(c.prev.heading, s.heading, alpha);
    c.model.update(frameSeconds, Math.hypot(s.vx, s.vz), c.agent.mode === 'down');
  }

  const ped = player.ped;
  const prev = player.prev;
  const px = lerp(prev.x, ped.x, alpha);
  const pz = lerp(prev.z, ped.z, alpha);
  playerModel.root.position.set(px, 0, pz);
  playerModel.root.rotation.y = lerpAngle(prev.heading, ped.heading, alpha);
  playerModel.update(frameSeconds, Math.hypot(ped.vx, ped.vz), player.down);

  // Body motion, tyre marks, damaged-car smoke and fire, weather, particles.
  const focus = attract.active ? attract : player.position;
  fx.update(frameSeconds, controls, focus.x, focus.z, !attract.active);
  updateHud(frameSeconds);

  if (attract.active) {
    attract.update(frameSeconds, vehicles);
    rig.update(frameSeconds, attract.x, attract.z, attract.vx, attract.vz);
  } else if (player.driving) {
    const v = player.driving;
    rig.update(frameSeconds, v.mesh.root.position.x, v.mesh.root.position.z, v.sim.vx, v.sim.vz);
  } else {
    rig.update(frameSeconds, px, pz, ped.vx, ped.vz);
  }
  audioFrame.x = focus.x;
  audioFrame.z = focus.z;
  audioFrame.car = player.driving && controls ? describeCar(audioCar, player.driving.sim, controls, player.driving.archetype) : null;
  audioFrame.footSpeed = player.driving || attract.active ? 0 : Math.hypot(ped.vx, ped.vz);
  audioFrame.health = player.health;
  audio.update(frameSeconds, audioFrame);

  const at = player.position;
  radar.update(frameSeconds, at.x, at.z, player.driving ? player.driving.sim.heading : ped.heading, Math.hypot(at.vx, at.vz), player.driving);
  threats.update(rig.camera, population.crowd, at.x, at.z, viewW, viewH, playing && player.alive);

  look.update(frameSeconds, viewOfPlayer());
  look.render(rig.camera);
  resolution.sample(elapsed);
}

const playerView: PlayerView = { x: 0, z: 0, heading: 0, driving: false, speed: 0, alive: true };
/** Where the player marker goes this frame (the interpolated positions just set). */
function viewOfPlayer(): PlayerView {
  const v = player.driving;
  const o = v ? v.mesh.root : playerModel.root;
  playerView.x = o.position.x;
  playerView.z = o.position.z;
  playerView.heading = o.rotation.y;
  playerView.driving = v !== null;
  playerView.speed = v ? speed(v.sim) : Math.hypot(player.ped.vx, player.ped.vz);
  playerView.alive = player.alive && !attract.active; // no marker over the title
  return playerView;
}

const hudFrame = createHudFrame();
const hudCar: CarHud = { kmh: 0, maxKmh: 100, health: 1, burning: false };
/** Fill this frame's HUD snapshot; the HUD writes to the DOM only what changed. */
function updateHud(frameSeconds: number) {
  const gun = player.arsenal.current;
  const v = player.driving;
  hudFrame.health = player.health;
  hudFrame.weapon = gun;
  hudFrame.ammo = gun ? (player.arsenal.ammo.get(gun) ?? 0) : 0;
  hudFrame.device = input.lastDevice;
  if (v) {
    hudCar.kmh = Math.abs(forwardSpeed(v.sim)) * 3.6;
    hudCar.maxKmh = gaugeTopSpeed(VEHICLE_SPECS[v.archetype]) * 3.6;
    hudCar.health = v.damage.health / v.damage.maxHealth;
    hudCar.burning = damageStage(v.damage) === 'burning';
  }
  hudFrame.car = v ? hudCar : null;
  const nearCar = v || attract.active ? null : nearestEnterable();
  hudFrame.nearCar = nearCar ? (nearCar.ai ? 'jack' : 'enter') : null;
  hudFrame.mouseAim = !v && !attract.active && input.mouseAimLive();
  hud.update(frameSeconds, hudFrame);
  touch.setWeapon(gun, gun !== null || ownsGun());
  touch.setMode(v ? 'car' : 'foot', nearCar !== null);
}
requestAnimationFrame(frame);

/** Any gun with ammo left, i.e. something for the swap button to switch to. */
function ownsGun(): boolean {
  for (const k of WEAPON_ORDER) if ((player.arsenal.ammo.get(k) ?? 0) > 0) return true;
  return false;
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

// --- Front door: HUD, radar, menus, title / attract ---
const hud = new Hud(document.body, score, events, {
  onPause: () => frontDoor.openPause(),
  debugText: () => `${resolution.summary()} · ${viewW}×${viewH} · ${renderer.info.render.calls} dc`,
});
const radar = new Radar(document.body, city, { vehicles, pickups, crowd: population.crowd });
const threats = new ThreatIndicators(document.body);
const frontDoor = new FrontDoor(document.body, document.getElementById('paused')!, input, audio, {
  startGame,
  enterTitle,
  restart: () => respawnPlayer(),
  setPaused: (p, reason) => setPaused(p, reason),
  isPaused: () => paused,
  pauseReason: () => pauseReason,
  applyUpdate: () => updates.atSafePoint(),
});

/**
 * Compile every material in the scene now (behind the title) rather than on
 * first draw mid-play. precompile targets the pass actually used (the HDR
 * target on desktop), which renderer.compile on the canvas would miss.
 */
function warmShaders() {
  try {
    precompile(renderer, scene, rig.camera);
    resolution.holdOff(1);
  } catch {
    // A lost context mid-compile: the first frames compile instead.
  }
}

/** PLAY: from the attract city to a fresh run at the spawn corner. */
function startGame() {
  attract.stop();
  hud.setScene('play');
  radar.visible = true;
  haptics.enabled = true;
  playerModel.root.visible = true;
  rig.setHeights(...CAMERA_FOOT);
  respawnPlayer();
  input.resetAll();
  audio.setMusicMode('game');
  resolution.holdOff();
  enterGameMode(getDevice().handheld);
}

/** Quit to title: drop the run, hide the player, cruise over traffic. */
function enterTitle() {
  respawnPlayer();
  playerModel.root.visible = false;
  attract.start(rig.focusX, rig.focusZ);
  rig.setHeights(...CAMERA_ATTRACT);
  hud.setScene('title');
  radar.visible = false;
  haptics.enabled = false;
  audio.setMusicMode('menu');
  frontDoor.showTitle(score.best);
}

// Boot into the title over attract mode.
playerModel.root.visible = false;
rig.setHeights(...CAMERA_ATTRACT);
hud.setScene('title');
radar.visible = false;
haptics.enabled = false;
audio.setMusicMode('menu');
frontDoor.showTitle(score.best);
frontDoor.rotate.check();
requestAnimationFrame(() => warmShaders());

// --- Lifecycle ---
// App updates wait for a moment when reloading costs nothing (see UpdateGate).
let applyUpdate: ((reload?: boolean) => Promise<void>) | null = null;
const updates = new UpdateGate(
  () => {
    void applyUpdate?.(true);
    // If the new worker never takes control, reload anyway.
    setTimeout(() => location.reload(), 4000);
  },
  () => frontDoor.pause.setUpdateReady(true),
);
applyUpdate = registerSW({ immediate: true, onNeedRefresh: () => updates.markReady() });

/** True while the WebGL context is gone: nothing can resume until it's back. */
let contextLost = false;
/** Paused only because the context was lost (so resume when it's restored). */
let pausedForContext = false;
/** Why the game is paused, while it is. */
let pauseReason: PauseReason = 'paused';

function setPaused(p: boolean, reason: PauseReason = 'paused') {
  if (!p && contextLost) return;
  if (p) {
    pauseReason = reason;
    frontDoor.showPause(reason);
  } else frontDoor.hidePause();
  if (p === paused) return;
  paused = p;
  // Nothing held or queued while paused may leak into play on resume.
  input.resetAll();
  audio.setPaused(p);
  if (!p) {
    last = performance.now();
    loop.reset();
    resolution.holdOff();
  }
  events.emit({ type: 'pause', paused: p });
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) return;
  // Behind the title there's nothing to lose: just take any waiting update.
  if (frontDoor.inTitle) {
    updates.atSafePoint();
    return;
  }
  pausedForContext = false;
  setPaused(true);
  // Backgrounded: nobody is watching, so a waiting update can go in now.
  updates.atSafePoint();
});

// iOS drops the GL context of backgrounded or memory-starved pages. Say so,
// hold the game, and carry on once three.js has rebuilt its GPU resources.
renderer.domElement.addEventListener('webglcontextlost', (e) => {
  e.preventDefault(); // allows the browser to restore it
  contextLost = true;
  pausedForContext = !paused;
  setPaused(true, 'contextLost');
});
renderer.domElement.addEventListener('webglcontextrestored', () => {
  contextLost = false;
  resolution.holdOff();
  if (pausedForContext) setPaused(false);
  else if (paused) setPaused(true, 'paused');
  pausedForContext = false;
});

// Debug hook for poking at the sim from the console / automated checks.
(window as unknown as { __ub: unknown }).__ub = {
  player,
  playerModel,
  vehicles,
  input,
  city,
  population,
  renderer,
  resolution,
  rig,
  look,
  effects,
  fx,
  score,
  events,
  audio,
  explode,
  updates,
  hud,
  radar,
  frontDoor,
  attract,
  touch,
  haptics,
  /** The PLAY button: closes the title and starts a fresh run. */
  startGame: () => frontDoor.play(),
  enterTitle,
  get paused() {
    return paused;
  },
  setPaused,
  get simTime() {
    return simTime;
  },
};

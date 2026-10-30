import {
  AmbientLight,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  MeshLambertMaterial,
  Scene,
  WebGLRenderer,
  type ColorRepresentation,
} from 'three';
import { registerSW } from 'virtual:pwa-register';
import { Input } from './core/input';
import { FixedStep } from './core/loop';
import { PLAYER_ON_FOOT, createPedState, stepPedestrian, type PedState } from './entities/pedestrian';
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
import { Population, type Vehicle } from './game/population';
import { Effects } from './render/effects';
import { CameraRig } from './render/cameraRig';
import { createCarMesh } from './render/carMesh';
import { CharacterModel } from './render/characterModel';
import { DynamicResolution } from './render/dynamicResolution';
import { VehicleModels } from './render/vehicleModels';
import { PUNCH_REACH, knockDown, provoke, resumeWalking, scare, spawnPed, stepCrowdPed, type Target } from './systems/crowd';
import { Arsenal, VEHICLE_SHARE, WEAPONS, autoAim, rayCircle, rayRect } from './systems/weapons';
import { PickupMesh } from './render/pickupMesh';
import { HEALTH_PICKUP, PICKUP_RESPAWN, generatePickups, pickupAt, respawnPickups } from './world/pickups';
import {
  applyDamage,
  blastDamage,
  createDamage,
  damageStage,
  impactDamage,
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
import { ScoreHud, loadBest } from './ui/scoreHud';
import { mountTouchControls } from './ui/touchControls';
import { generateCity } from './world/city';
import { createCityMesh } from './world/cityMesh';
import { StaticGrid } from './world/collision';
import { createGround } from './world/ground';
import { mulberry32 } from './world/random';
import { GameAudio, createAudioFrame, createCarSound, describeCar } from './audio/gameAudio';
import { events } from './core/events';
import { mountRadioToast } from './ui/radioToast';

registerSW({ immediate: true });

const app = document.getElementById('app')!;
const speedBox = document.getElementById('speed')!;
const speedEl = document.getElementById('speed-value')!;
const debugEl = document.getElementById('debug')!;
const pausedEl = document.getElementById('paused')!;
const hintEl = document.getElementById('hint')!;
const playerHealthBar = document.querySelector<HTMLElement>('#phealth > div')!;
const weaponEl = document.getElementById('weapon')!;
const hurtEl = document.getElementById('hurt')!;
const wastedEl = document.getElementById('wasted')!;
const healthBar = document.querySelector<HTMLElement>('#vhealth > div')!;

/** How close (m, centre to centre) you must be to get into a car. */
const ENTER_RANGE = 4;
/** Cars moving faster than this can't be boarded. */
const ENTER_MAX_SPEED = 6;
const CAMERA_FOOT = [20, 24] as const;
const CAMERA_CAR = [26, 58] as const;
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
/** Random aim error of NPC shooters, radians. */
const NPC_SPREAD = 0.14;
const RESPAWN_SECONDS = 3;

// --- Renderer ---
const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
app.append(renderer.domElement);
const resolution = new DynamicResolution(renderer);

// --- Scene ---
const scene = new Scene();
scene.background = new Color('#1b1d22');
scene.fog = new Fog('#1b1d22', 90, 220);
scene.add(new HemisphereLight('#cfd8ff', '#3a3326', 1.2));
scene.add(new AmbientLight('#ffffff', 0.25));
const sun = new DirectionalLight('#fff1d6', 1.6);
sun.position.set(-30, 80, 20);
scene.add(sun);
scene.add(createGround());
const city = generateCity(1337);
const collision = new StaticGrid(city.obstacles);
scene.add(createCityMesh(city));
const rand = mulberry32(Date.now() >>> 0);
const effects = new Effects(scene);
const charred = new MeshLambertMaterial({ color: '#1c1a19' });
const pickups = generatePickups(1337);
const pickupMesh = new PickupMesh(pickups);
scene.add(pickupMesh.mesh);

// --- Vehicles ---
const vehicles: Vehicle[] = [];
let vehicleModels: VehicleModels | null = null;

function makeVehicle(archetype: VehicleArchetype, paint: ColorRepresentation, x = 0, z = 0, heading = 0): Vehicle {
  const sim = createVehicleState(x, z, heading);
  const mesh = createCarMesh(paint);
  vehicleModels?.dress(mesh, archetype, paint);
  scene.add(mesh.root);
  const v: Vehicle = {
    archetype,
    paint,
    sim,
    prev: { ...sim },
    mesh,
    ai: null,
    damage: createDamage(VEHICLE_HEALTH[archetype]),
    wreckAge: 0,
  };
  vehicles.push(v);
  return v;
}

// A few parked at the kerbs around the spawn intersection.
const PARKED: Array<[VehicleArchetype, number, number, number, ColorRepresentation]> = [
  ['sedan', 5.5, -14, Math.PI, '#c8342b'],
  ['compact', -5.5, 16, 0, '#2f6fc0'],
  ['van', 20, 5.5, Math.PI / 2, '#d9d6cc'],
  ['sports', -22, -5.5, -Math.PI / 2, '#e8b923'],
  ['police', 5.5, 34, Math.PI, '#f2f2f2'],
];
for (const [archetype, x, z, h, paint] of PARKED) makeVehicle(archetype, paint, x, z, h);

// Placeholder boxes show until the Blender-built models arrive.
VehicleModels.load('/assets/vehicles.glb').then(
  (models) => {
    vehicleModels = models;
    for (const v of vehicles) models.dress(v.mesh, v.archetype, v.paint);
  },
  (err) => console.error('Failed to load vehicles.glb', err),
);

function resetVehicle(v: Vehicle) {
  v.damage = createDamage(VEHICLE_HEALTH[v.archetype]);
  v.wreckAge = 0;
  vehicleModels?.dress(v.mesh, v.archetype, v.paint); // replaces charred parts
}

/** Blacken a burnt-out car (the blob shadow keeps its material). */
function charVehicle(v: Vehicle) {
  v.mesh.root.traverse((o) => {
    if (o instanceof Mesh && o.name !== 'shadow') o.material = charred;
  });
}

const population = new Population(scene, vehicles, (a, p) => makeVehicle(a, p), resetVehicle, rand);

// --- Player ---
const player = {
  ped: createPedState(9.5, 9.5, Math.PI),
  prev: null as PedState | null,
  model: new CharacterModel('/assets/player.glb'),
  /** Vehicle being driven, or null when on foot. */
  driving: null as Vehicle | null,
  /** Seconds left lying on the ground after a blast. */
  stunned: 0,
  punchCooldown: 0,
  health: 100,
  /** Seconds until respawn while "wasted"; 0 when alive. */
  dead: 0,
  arsenal: new Arsenal(),
};
player.prev = { ...player.ped };
scene.add(player.model.root);

const rig = new CameraRig(1);
let viewW = 0;
let viewH = 0;
/**
 * Match the drawing buffer to #app's laid-out size. Checked every frame rather
 * than on 'resize': iOS home-screen apps fire resize before the rotated
 * dimensions are available, which left the canvas stuck at portrait size.
 */
function fitToScreen() {
  const w = app.clientWidth;
  const h = app.clientHeight;
  if (w === viewW && h === viewH) return;
  if (w === 0 || h === 0) return;
  viewW = w;
  viewH = h;
  renderer.setSize(w, h, false); // CSS sizes the canvas; only set the buffer
  rig.resize(w / h);
}
fitToScreen();
rig.setHeights(...CAMERA_FOOT);
rig.snapTo(player.ped.x, player.ped.z);

// --- Score ---
const score = new Score(loadBest());
const scoreHud = new ScoreHud(document.body, score);
const award = (a: Award | null) => a && scoreHud.pop(a);
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
const touch = mountTouchControls(document.body, input.touch);
const NO_CONTROLS: VehicleControls = { throttle: 0, steer: 0, handbrake: false };

function nearestEnterable(): Vehicle | null {
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
  const door = driverDoorPosition(v.sim);
  const agent = spawnPed(0, 0, 0, 0, rand);
  Object.assign(agent.s, { x: door.x, z: door.z, vx: 0, vz: 0, heading: v.sim.heading });
  scare(agent, fromX, fromZ, 5);
  population.addPed(agent);
}

function enterVehicle(v: Vehicle) {
  // Carjack: the driver is thrown out and runs for it.
  if (v.ai) {
    ejectDriver(v, player.ped.x, player.ped.z);
    award(score.award('carjack'));
  }
  player.driving = v;
  player.model.root.visible = false;
  rig.setHeights(...CAMERA_CAR);
}

function exitVehicle(vx = 0, vz = 0) {
  const v = player.driving!;
  const door = driverDoorPosition(v.sim);
  Object.assign(player.ped, { x: door.x, z: door.z, heading: v.sim.heading, vx, vz });
  Object.assign(player.prev!, player.ped);
  player.driving = null;
  player.model.root.visible = true;
  rig.setHeights(...CAMERA_FOOT);
}

// --- Simulation ---
const obstacles: Obstacle[] = [];
const vehicleStates = () => vehicles.map((v) => v.sim);

function simulate(dt: number) {
  const driving = player.driving;
  const playerControls = input.readVehicle();

  // What AI drivers need to avoid this step.
  obstacles.length = 0;
  for (const v of vehicles) obstacles.push({ x: v.sim.x, z: v.sim.z, halfWidth: 1 });
  if (!driving) obstacles.push({ x: player.ped.x, z: player.ped.z, halfWidth: 0.4 });
  for (const c of population.crowd) obstacles.push({ x: c.agent.s.x, z: c.agent.s.z, halfWidth: 0.4 });

  for (const v of vehicles) {
    Object.assign(v.prev, v.sim);
    let controls = NO_CONTROLS;
    if (v.damage.wrecked) controls = NO_CONTROLS;
    else if (v === driving) controls = playerControls;
    // A car's own entry sits at distance 0, which clearDistance ignores.
    else if (v.ai) controls = driveAi(v.ai, v.sim, obstacles, rand, dt);
    stepVehicle(v.sim, controls, VEHICLE_SPECS[v.archetype], dt);
  }

  Object.assign(player.prev!, player.ped);
  if (!driving) {
    const stunned = player.stunned > 0 || player.dead > 0;
    if (stunned) player.stunned = Math.max(0, player.stunned - dt);
    stepPedestrian(player.ped, stunned ? { x: 0, y: 0, sprint: false } : input.readMove(), PLAYER_ON_FOOT, dt);
  }

  const states = vehicleStates();
  for (const c of population.crowd) {
    Object.assign(c.prev, c.agent.s);
    const wasDown = c.agent.mode === 'down';
    const event = stepCrowdPed(c.agent, states, rand, dt, playerTarget());
    // Knocked over by the player's car?
    if (!wasDown && c.agent.mode === 'down' && driving) {
      if (Math.hypot(driving.sim.x - c.agent.s.x, driving.sim.z - c.agent.s.z) < 5) {
        award(score.award('hitAndRun'));
        provoke(c.agent, driving.sim.x, driving.sim.z);
      }
    }
    if (event?.kind === 'punch' && !driving && player.dead === 0) {
      if (Math.hypot(player.ped.x - c.agent.s.x, player.ped.z - c.agent.s.z) < PUNCH_REACH + 0.4) {
        c.model.punch();
        hurtPlayer(NPC_PUNCH_DAMAGE);
      }
    } else if (event?.kind === 'shoot') {
      c.model.punch(); // same arm raise reads as aiming
      npcShoot(c.agent.s.x, c.agent.s.z, event.dirX, event.dirZ);
    }
  }

  // --- Collisions ---
  for (const v of vehicles) applyDamage(v.damage, impactDamage(collideVehicleStatic(v.sim, collision)));
  for (let i = 0; i < vehicles.length; i++) {
    for (let j = i + 1; j < vehicles.length; j++) {
      const impact = collideVehicles(vehicles[i].sim, vehicles[j].sim);
      const hit = impactDamage(impact);
      applyDamage(vehicles[i].damage, hit);
      applyDamage(vehicles[j].damage, hit);
      if (driving && impact > 6 && (vehicles[i] === driving || vehicles[j] === driving)) {
        award(score.award('smash', Math.round(impact * 4)));
        // A hit isn't a near miss.
        nearMissAt.set(vehicles[i] === driving ? vehicles[j] : vehicles[i], simTime);
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
  if (!driving && player.dead === 0) {
    const pk = pickupAt(pickups, player.ped.x, player.ped.z);
    if (pk && (pk.kind !== 'health' || player.health < 100)) {
      pk.respawnAt = simTime + PICKUP_RESPAWN;
      if (pk.kind === 'health') {
        player.health = Math.min(100, player.health + HEALTH_PICKUP);
        scoreHud.notice('+ HEALTH', 'health');
      } else {
        player.arsenal.pickUp(pk.kind);
        player.arsenal.current = pk.kind;
        scoreHud.notice(`+ ${WEAPONS[pk.kind].label}`, 'weapon');
      }
    }
  }
  player.arsenal.step(dt);
  if (player.dead > 0 && (player.dead -= dt) <= 0) respawn();

  // --- Fire and explosions ---
  for (const v of vehicles) {
    // NPC drivers bail out of burning cars.
    if (v.ai && v.damage.burning) ejectDriver(v, v.sim.x, v.sim.z);
    if (stepDamage(v.damage, dt)) explode(v);
  }
  if (!driving) {
    for (const s of states) collidePedVehicle(player.ped, s);
    // Static last so a car can't shove the player into a wall.
    collidePedStatic(player.ped, collision);
  }
  for (const c of population.crowd) {
    if (c.agent.mode !== 'down') for (const s of states) collidePedVehicle(c.agent.s, s);
    collidePedStatic(c.agent.s, collision);
  }
}

function explode(source: Vehicle) {
  const { x, z } = source.sim;
  effects.explode(x, z);
  charVehicle(source);
  source.wreckAge = 0;
  const focus = player.driving ? player.driving.sim : player.ped;
  const distance = Math.hypot(focus.x - x, focus.z - z);
  rig.shake(Math.max(0, 2.5 - distance / 30));
  if (distance < BOOM_SCORE_RANGE) award(score.award('boom'));

  if (player.driving === source) {
    hurtPlayer(35);
    // Thrown clear of your own car.
    exitVehicle(Math.sin(source.sim.heading + Math.PI / 2) * 4, Math.cos(source.sim.heading + Math.PI / 2) * 4);
    player.stunned = 2.5;
  }
  for (const v of vehicles) {
    if (v === source) continue;
    const d = Math.hypot(v.sim.x - x, v.sim.z - z);
    const dmg = blastDamage(d, BLAST_RADIUS);
    if (dmg <= 0) continue;
    applyDamage(v.damage, dmg);
    const push = (dmg / 70) * 8;
    v.sim.vx += ((v.sim.x - x) / (d || 1)) * push;
    v.sim.vz += ((v.sim.z - z) / (d || 1)) * push;
  }
  for (const c of population.crowd) {
    const d = Math.hypot(c.agent.s.x - x, c.agent.s.z - z);
    if (d < BLAST_RADIUS) knockDown(c.agent, x, z, 6, 3);
    else if (d < 30) scare(c.agent, x, z, 4);
  }
  if (!player.driving && Math.hypot(player.ped.x - x, player.ped.z - z) < BLAST_RADIUS) {
    hurtPlayer(blastDamage(Math.hypot(player.ped.x - x, player.ped.z - z), BLAST_RADIUS, 60));
    player.stunned = 2;
    const d = Math.hypot(player.ped.x - x, player.ped.z - z) || 1;
    player.ped.vx = ((player.ped.x - x) / d) * 6;
    player.ped.vz = ((player.ped.z - z) / d) * 6;
  }
}

function playerTarget(): Target {
  const at = player.driving ? player.driving.sim : player.ped;
  return { x: at.x, z: at.z, inCar: player.driving !== null, alive: player.dead === 0 };
}

function hurtPlayer(amount: number) {
  if (player.dead > 0 || amount <= 0) return;
  player.health = Math.max(0, player.health - amount);
  hurtEl.classList.add('on');
  requestAnimationFrame(() => requestAnimationFrame(() => hurtEl.classList.remove('on')));
  rig.shake(0.4);
  if (player.health === 0) die();
}

function die() {
  if (player.driving) exitVehicle();
  player.dead = RESPAWN_SECONDS;
  player.stunned = RESPAWN_SECONDS;
  wastedEl.hidden = false;
  player.arsenal.clear();
  // Nobody keeps fighting a dead man.
  for (const c of population.crowd) if (c.agent.mode === 'fight' || c.agent.mode === 'shoot') resumeWalking(c.agent);
}

function respawn() {
  player.dead = 0;
  player.stunned = 0;
  player.health = 100;
  score.resetRun();
  Object.assign(player.ped, { x: SPAWN_POINT.x, z: SPAWN_POINT.z, vx: 0, vz: 0, heading: Math.PI });
  Object.assign(player.prev!, player.ped);
  rig.snapTo(player.ped.x, player.ped.z);
  wastedEl.hidden = true;
}

/** Nearest thing a bullet from (ox, oz) along unit (dx, dz) hits within range. */
function traceBullet(ox: number, oz: number, dx: number, dz: number, range: number, shooterIsPlayer: boolean) {
  let best = range;
  let hit: { kind: 'ped'; ped: (typeof population.crowd)[number] } | { kind: 'vehicle'; v: Vehicle } | { kind: 'player' } | null = null;
  for (const r of collision.near(ox + (dx * range) / 2, oz + (dz * range) / 2, range / 2 + 1)) {
    best = Math.min(best, rayRect(ox, oz, dx, dz, r));
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
    for (const c of carCircles(v.sim)) {
      const t = rayCircle(ox, oz, dx, dz, { x: c.x, z: c.z, r: CAR_CIRCLE_RADIUS * 0.9 });
      if (t > 0.3 && t < best) {
        best = t;
        hit = { kind: 'vehicle', v };
      }
    }
  }
  if (!shooterIsPlayer && !player.driving && player.dead === 0) {
    const t = rayCircle(ox, oz, dx, dz, { x: player.ped.x, z: player.ped.z, r: 0.45 });
    if (t > 0.3 && t < best) {
      best = t;
      hit = { kind: 'player' };
    }
  }
  return { t: best, hit };
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
  const aim = autoAim(x, z, heading, targets, w.range);
  player.ped.heading = Math.atan2(aim.x, aim.z);
  const ox = x + aim.x * 0.6;
  const oz = z + aim.z * 0.6;
  effects.emitFire(ox, oz, 1.2);
  player.model.punch();
  for (let i = 0; i < w.pellets; i++) {
    const a = Math.atan2(aim.x, aim.z) + (rand() * 2 - 1) * w.spread;
    const dx = Math.sin(a);
    const dz = Math.cos(a);
    const { t, hit } = traceBullet(ox, oz, dx, dz, w.range, true);
    effects.tracer(ox, oz, ox + dx * t, oz + dz * t);
    if (hit?.kind === 'ped') {
      knockDown(hit.ped.agent, x, z, 4, 5);
      provoke(hit.ped.agent, x, z);
      award(score.award('knockout'));
    } else if (hit?.kind === 'vehicle') {
      applyDamage(hit.v.damage, w.damage * VEHICLE_SHARE);
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
  const { t, hit } = traceBullet(ox, oz, dx, dz, 26, false);
  effects.emitFire(ox, oz, 1.2);
  effects.tracer(ox, oz, ox + dx * t, oz + dz * t);
  if (hit?.kind === 'player') hurtPlayer(NPC_SHOT_DAMAGE);
  else if (hit?.kind === 'vehicle') applyDamage(hit.v.damage, NPC_SHOT_DAMAGE);
}

function tryPunch() {
  if (player.driving || player.stunned > 0 || player.punchCooldown > 0) return;
  player.punchCooldown = PUNCH_COOLDOWN;
  player.model.punch();
  const { x, z, heading } = player.ped;
  const fx = Math.sin(heading);
  const fz = Math.cos(heading);
  for (const c of population.crowd) {
    const dx = c.agent.s.x - x;
    const dz = c.agent.s.z - z;
    const d = Math.hypot(dx, dz);
    if (d < PUNCH_RANGE && (dx * fx + dz * fz) / (d || 1) > 0.4 && c.agent.mode !== 'down') {
      knockDown(c.agent, x, z);
      provoke(c.agent, x, z);
      award(score.award('knockout'));
    }
    else if (d < 10) scare(c.agent, x, z, 3);
  }
}

// --- Loop ---
const loop = new FixedStep(1 / 60);
let last = performance.now();
let paused = false;
let maintainTimer = 0;

function frame(now: number) {
  requestAnimationFrame(frame);
  const frameSeconds = Math.min(0.25, (now - last) / 1000);
  last = now;
  if (paused) return;

  input.pollGamepad();
  player.punchCooldown = Math.max(0, player.punchCooldown - frameSeconds);
  const pressed = input.consumePunch();
  if (input.consumeCycle() && !player.driving) player.arsenal.cycle();
  if (!player.driving && player.dead === 0 && player.stunned <= 0) {
    const gun = player.arsenal.current;
    if (gun) {
      if (pressed || (WEAPONS[gun].automatic && input.fireHeld)) fireWeapon();
    } else if (pressed) tryPunch();
  }
  if (input.consumeAction() && player.stunned <= 0) {
    if (player.driving) exitVehicle();
    else {
      const v = nearestEnterable();
      if (v) enterVehicle(v);
    }
  }

  const focus = player.driving ? player.driving.sim : player.ped;
  if ((maintainTimer -= frameSeconds) <= 0) {
    maintainTimer = 0.25;
    population.maintain(focus.x, focus.z, player.driving);
  }

  const alpha = loop.advance(frameSeconds, simulate);

  // Interpolate render state between the last two sim steps.
  // Read once per frame: the wheel steer and the engine sound share it.
  const controls = player.driving ? input.readVehicle() : null;
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
  const prev = player.prev!;
  const px = lerp(prev.x, ped.x, alpha);
  const pz = lerp(prev.z, ped.z, alpha);
  player.model.root.position.set(px, 0, pz);
  player.model.root.rotation.y = lerpAngle(prev.heading, ped.heading, alpha);
  player.model.update(frameSeconds, Math.hypot(ped.vx, ped.vz), player.stunned > 0);

  // Smoke and fire from damaged cars near the action.
  for (const v of vehicles) {
    if (Math.abs(v.sim.x - focus.x) > 120 || Math.abs(v.sim.z - focus.z) > 120) continue;
    const stage = damageStage(v.damage);
    const hood = { x: v.sim.x + Math.sin(v.sim.heading) * 1.4, z: v.sim.z + Math.cos(v.sim.heading) * 1.4 };
    if (stage === 'smoking' && rand() < frameSeconds * 14) effects.emitSmoke(hood.x, hood.z, 1.2, 0.2);
    else if (stage === 'burning') {
      if (rand() < frameSeconds * 45) effects.emitFire(hood.x, hood.z, 1.2);
      if (rand() < frameSeconds * 16) effects.emitSmoke(hood.x, hood.z, 1.8, 0.9);
    } else if (stage === 'wrecked' && v.wreckAge < 25) {
      v.wreckAge += frameSeconds;
      if (rand() < frameSeconds * 6) effects.emitSmoke(v.sim.x, v.sim.z, 1, 0.8);
      if (v.wreckAge < 4 && rand() < frameSeconds * 30) effects.emitFire(v.sim.x, v.sim.z, 0.8);
    }
  }
  effects.update(frameSeconds);
  pickupMesh.update(now / 1000);
  scoreHud.update();
  playerHealthBar.style.width = `${player.health}%`;
  const gun = player.arsenal.current;
  weaponEl.textContent = gun ? `${WEAPONS[gun].label} · ${player.arsenal.ammo.get(gun) ?? 0}` : 'FISTS';
  touch.setWeapon(gun ? WEAPONS[gun].label : null);

  const nearCar = player.driving ? null : nearestEnterable();
  touch.setMode(player.driving ? 'car' : 'foot', nearCar !== null);
  hintEl.hidden = !nearCar || !document.querySelector('.touch-layer[hidden]');
  hintEl.textContent = nearCar?.ai ? 'Press E to take this car' : 'Press E to get in';

  if (player.driving) {
    const v = player.driving;
    rig.update(frameSeconds, v.mesh.root.position.x, v.mesh.root.position.z, v.sim.vx, v.sim.vz);
    speedEl.textContent = String(Math.round(Math.abs(forwardSpeed(v.sim)) * 3.6));
    const hp = v.damage.health / v.damage.maxHealth;
    healthBar.style.width = `${Math.round(hp * 100)}%`;
    healthBar.style.background = hp > 0.6 ? '#6cc46c' : hp > 0.25 ? '#e0b040' : '#e05040';
  } else {
    rig.update(frameSeconds, px, pz, ped.vx, ped.vz);
  }
  speedBox.hidden = !player.driving;

  audioFrame.x = focus.x;
  audioFrame.z = focus.z;
  audioFrame.car = player.driving && controls ? describeCar(audioCar, player.driving.sim, controls, player.driving.archetype) : null;
  audioFrame.footSpeed = player.driving ? 0 : Math.hypot(ped.vx, ped.vz);
  audioFrame.health = player.health;
  audio.update(frameSeconds, audioFrame);

  fitToScreen();
  renderer.render(scene, rig.camera);

  resolution.sample(frameSeconds);
  debugEl.textContent = `${resolution.summary()} · ${viewW}×${viewH} · ${renderer.info.render.calls} dc`;
}
requestAnimationFrame(frame);

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

// --- Lifecycle ---
function setPaused(p: boolean) {
  paused = p;
  pausedEl.hidden = !p;
  audio.setPaused(p);
  if (!p) {
    last = performance.now();
    loop.reset();
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) setPaused(true);
});
pausedEl.addEventListener('pointerdown', () => setPaused(false));
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyP' || e.code === 'Escape') setPaused(!paused);
});

// Debug hook for poking at the sim from the console / automated checks.
(window as unknown as { __ub: unknown }).__ub = { player, vehicles, input, city, population, renderer, score };
Object.assign((window as unknown as { __ub: object }).__ub, { audio, events });

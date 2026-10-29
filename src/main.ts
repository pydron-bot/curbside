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
import { knockDown, scare, spawnPed, stepCrowdPed } from './systems/crowd';
import {
  applyDamage,
  blastDamage,
  createDamage,
  damageStage,
  impactDamage,
  stepDamage,
} from './systems/damage';
import {
  collidePedStatic,
  collidePedVehicle,
  collideVehicleStatic,
  collideVehicles,
} from './systems/physics';
import { driveAi, type Obstacle } from './systems/traffic';
import { mountTouchControls } from './ui/touchControls';
import { generateCity } from './world/city';
import { createCityMesh } from './world/cityMesh';
import { StaticGrid } from './world/collision';
import { createGround } from './world/ground';
import { mulberry32 } from './world/random';

registerSW({ immediate: true });

const app = document.getElementById('app')!;
const speedBox = document.getElementById('speed')!;
const speedEl = document.getElementById('speed-value')!;
const debugEl = document.getElementById('debug')!;
const pausedEl = document.getElementById('paused')!;
const hintEl = document.getElementById('hint')!;
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
  if (v.ai) ejectDriver(v, player.ped.x, player.ped.z);
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
    const stunned = player.stunned > 0;
    if (stunned) player.stunned = Math.max(0, player.stunned - dt);
    stepPedestrian(player.ped, stunned ? { x: 0, y: 0, sprint: false } : input.readMove(), PLAYER_ON_FOOT, dt);
  }

  const states = vehicleStates();
  for (const c of population.crowd) {
    Object.assign(c.prev, c.agent.s);
    stepCrowdPed(c.agent, states, rand, dt);
  }

  // --- Collisions ---
  for (const v of vehicles) applyDamage(v.damage, impactDamage(collideVehicleStatic(v.sim, collision)));
  for (let i = 0; i < vehicles.length; i++) {
    for (let j = i + 1; j < vehicles.length; j++) {
      const hit = impactDamage(collideVehicles(vehicles[i].sim, vehicles[j].sim));
      applyDamage(vehicles[i].damage, hit);
      applyDamage(vehicles[j].damage, hit);
    }
  }

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
  rig.shake(Math.max(0, 2.5 - Math.hypot(focus.x - x, focus.z - z) / 30));

  if (player.driving === source) {
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
    player.stunned = 2;
    const d = Math.hypot(player.ped.x - x, player.ped.z - z) || 1;
    player.ped.vx = ((player.ped.x - x) / d) * 6;
    player.ped.vz = ((player.ped.z - z) / d) * 6;
  }
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
    if (d < PUNCH_RANGE && (dx * fx + dz * fz) / (d || 1) > 0.4) knockDown(c.agent, x, z);
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
  if (input.consumePunch()) tryPunch();
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
  const steer = player.driving ? input.readVehicle().steer : 0;
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
(window as unknown as { __ub: unknown }).__ub = { player, vehicles, input, city, population, renderer };

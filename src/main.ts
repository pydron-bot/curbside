import {
  AmbientLight,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Scene,
  WebGLRenderer,
  type ColorRepresentation,
} from 'three';
import { registerSW } from 'virtual:pwa-register';
import { Input } from './core/input';
import { FixedStep } from './core/loop';
import { PLAYER_ON_FOOT, createPedState, stepPedestrian, type PedState } from './entities/pedestrian';
import {
  SEDAN,
  createVehicleState,
  driverDoorPosition,
  forwardSpeed,
  lerpAngle,
  speed,
  stepVehicle,
  type VehicleControls,
  type VehicleState,
} from './entities/vehicle';
import { CameraRig } from './render/cameraRig';
import { createCarMesh, type CarMesh } from './render/carMesh';
import { CharacterModel } from './render/characterModel';
import { DynamicResolution } from './render/dynamicResolution';
import { mountTouchControls } from './ui/touchControls';
import { createGround } from './world/ground';

registerSW({ immediate: true });

const app = document.getElementById('app')!;
const speedBox = document.getElementById('speed')!;
const speedEl = document.getElementById('speed-value')!;
const debugEl = document.getElementById('debug')!;
const pausedEl = document.getElementById('paused')!;
const hintEl = document.getElementById('hint')!;

/** How close (m, centre to centre) you must be to get into a car. */
const ENTER_RANGE = 4;
/** Cars moving faster than this can't be boarded. */
const ENTER_MAX_SPEED = 6;
const CAMERA_FOOT = [16, 22] as const;
const CAMERA_CAR = [26, 58] as const;

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

// --- Vehicles (parked at the kerbs around the spawn intersection) ---
interface Vehicle {
  sim: VehicleState;
  prev: VehicleState;
  mesh: CarMesh;
}
const PARKED: Array<[x: number, z: number, heading: number, paint: ColorRepresentation]> = [
  [5.5, -14, Math.PI, '#c8342b'],
  [-5.5, 16, 0, '#2f6fc0'],
  [20, 5.5, Math.PI / 2, '#d9d6cc'],
];
const vehicles: Vehicle[] = PARKED.map(([x, z, h, paint]) => {
  const sim = createVehicleState(x, z, h);
  const mesh = createCarMesh(paint);
  scene.add(mesh.root);
  return { sim, prev: { ...sim }, mesh };
});

// --- Player ---
const player = {
  ped: createPedState(9.5, 9.5, Math.PI),
  prev: null as PedState | null,
  model: new CharacterModel('/assets/player.glb'),
  /** Vehicle being driven, or null when on foot. */
  driving: null as Vehicle | null,
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
    if (d < bestDist && speed(v.sim) < ENTER_MAX_SPEED) {
      best = v;
      bestDist = d;
    }
  }
  return best;
}

function enterVehicle(v: Vehicle) {
  player.driving = v;
  player.model.root.visible = false;
  rig.setHeights(...CAMERA_CAR);
}

function exitVehicle() {
  const v = player.driving!;
  const door = driverDoorPosition(v.sim);
  Object.assign(player.ped, { x: door.x, z: door.z, heading: v.sim.heading, vx: 0, vz: 0 });
  Object.assign(player.prev!, player.ped);
  player.driving = null;
  player.model.root.visible = true;
  rig.setHeights(...CAMERA_FOOT);
}

// --- Loop ---
const loop = new FixedStep(1 / 60);
let last = performance.now();
let paused = false;

function simulate(dt: number) {
  const driving = player.driving;
  const vehicleControls = input.readVehicle();
  for (const v of vehicles) {
    Object.assign(v.prev, v.sim);
    stepVehicle(v.sim, v === driving ? vehicleControls : NO_CONTROLS, SEDAN, dt);
  }
  Object.assign(player.prev!, player.ped);
  if (!driving) stepPedestrian(player.ped, input.readMove(), PLAYER_ON_FOOT, dt);
}

function frame(now: number) {
  requestAnimationFrame(frame);
  const frameSeconds = Math.min(0.25, (now - last) / 1000);
  last = now;
  if (paused) return;

  input.pollGamepad();
  if (input.consumeAction()) {
    if (player.driving) exitVehicle();
    else {
      const v = nearestEnterable();
      if (v) enterVehicle(v);
    }
  }

  const alpha = loop.advance(frameSeconds, simulate);

  // Interpolate render state between the last two sim steps.
  const steer = player.driving ? input.readVehicle().steer : 0;
  for (const v of vehicles) {
    v.mesh.root.position.set(lerp(v.prev.x, v.sim.x, alpha), 0, lerp(v.prev.z, v.sim.z, alpha));
    v.mesh.root.rotation.y = lerpAngle(v.prev.heading, v.sim.heading, alpha);
    for (const w of v.mesh.frontWheels) w.rotation.y = v === player.driving ? -steer * 0.5 : 0;
  }

  const ped = player.ped;
  const prev = player.prev!;
  const px = lerp(prev.x, ped.x, alpha);
  const pz = lerp(prev.z, ped.z, alpha);
  player.model.root.position.set(px, 0, pz);
  player.model.root.rotation.y = lerpAngle(prev.heading, ped.heading, alpha);
  player.model.update(frameSeconds, Math.hypot(ped.vx, ped.vz));

  const nearCar = player.driving ? null : nearestEnterable();
  touch.setMode(player.driving ? 'car' : 'foot', nearCar !== null);
  hintEl.hidden = !nearCar || !document.querySelector('.touch-layer[hidden]');
  hintEl.textContent = 'Press E to get in';

  if (player.driving) {
    const v = player.driving;
    const x = v.mesh.root.position.x;
    const z = v.mesh.root.position.z;
    rig.update(frameSeconds, x, z, v.sim.vx, v.sim.vz);
    speedEl.textContent = String(Math.round(Math.abs(forwardSpeed(v.sim)) * 3.6));
  } else {
    rig.update(frameSeconds, px, pz, ped.vx, ped.vz);
  }
  speedBox.hidden = !player.driving;
  fitToScreen();
  renderer.render(scene, rig.camera);

  resolution.sample(frameSeconds);
  debugEl.textContent = `${resolution.summary()} · ${viewW}×${viewH}`;
}
requestAnimationFrame(frame);

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

// --- Window / lifecycle ---
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
(window as unknown as { __ub: unknown }).__ub = { player, vehicles, input };

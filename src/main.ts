import {
  AmbientLight,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Scene,
  WebGLRenderer,
} from 'three';
import { registerSW } from 'virtual:pwa-register';
import { Input } from './core/input';
import { FixedStep } from './core/loop';
import {
  SEDAN,
  createVehicleState,
  forwardSpeed,
  lerpAngle,
  stepVehicle,
  type VehicleState,
} from './entities/vehicle';
import { CameraRig } from './render/cameraRig';
import { createCarMesh } from './render/carMesh';
import { DynamicResolution } from './render/dynamicResolution';
import { mountTouchControls } from './ui/touchControls';
import { createGround } from './world/ground';

registerSW({ immediate: true });

const app = document.getElementById('app')!;
const speedEl = document.getElementById('speed-value')!;
const debugEl = document.getElementById('debug')!;
const pausedEl = document.getElementById('paused')!;

// --- Renderer ---
const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
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

// --- Player car ---
const car = createCarMesh();
scene.add(car.root);
const sim: VehicleState = createVehicleState(0, 0);
const prev: VehicleState = { ...sim };

const rig = new CameraRig(window.innerWidth / window.innerHeight);
rig.resize(window.innerWidth / window.innerHeight);
rig.snapTo(sim.x, sim.z);

// --- Input ---
const input = new Input();
mountTouchControls(document.body, input.touch);

// --- Loop ---
const loop = new FixedStep(1 / 60);
let last = performance.now();
let paused = false;
let lastControls = input.read();

function frame(now: number) {
  requestAnimationFrame(frame);
  const frameSeconds = Math.min(0.25, (now - last) / 1000);
  last = now;
  if (paused) return;

  input.pollGamepad();
  lastControls = input.read();

  const alpha = loop.advance(frameSeconds, (dt) => {
    Object.assign(prev, sim);
    stepVehicle(sim, lastControls, SEDAN, dt);
  });

  // Interpolate render state between the last two sim steps.
  const x = prev.x + (sim.x - prev.x) * alpha;
  const z = prev.z + (sim.z - prev.z) * alpha;
  car.root.position.set(x, 0, z);
  car.root.rotation.y = lerpAngle(prev.heading, sim.heading, alpha);
  for (const w of car.frontWheels) w.rotation.y = -lastControls.steer * 0.5;

  rig.update(frameSeconds, x, z, sim.vx, sim.vz);
  renderer.render(scene, rig.camera);

  resolution.sample(frameSeconds);
  speedEl.textContent = String(Math.round(Math.abs(forwardSpeed(sim)) * 3.6));
  debugEl.textContent = resolution.summary();
}
requestAnimationFrame(frame);

// --- Window / lifecycle ---
window.addEventListener('resize', () => {
  const aspect = window.innerWidth / window.innerHeight;
  renderer.setSize(window.innerWidth, window.innerHeight);
  rig.resize(aspect);
});

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
(window as unknown as { __ub: unknown }).__ub = { sim, input };

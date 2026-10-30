import { Scene, type ColorRepresentation } from 'three';
import { registerSW } from 'virtual:pwa-register';
import { events } from './core/events';
import { Input } from './core/input';
import { FixedStep } from './core/loop';
import { UpdateGate } from './core/updateGate';
import { PLAYER_ON_FOOT, copyPedState, stepPedestrian } from './entities/pedestrian';
import {
  GRAVITY,
  VEHICLE_BODIES,
  VEHICLE_HEALTH,
  VEHICLE_SPECS,
  copyVehicleState,
  createVehicleState,
  bikeThrows,
  driverDoorPosition,
  forwardSpeed,
  isBike,
  lateralSpeed,
  lerpAngle,
  slideOnSide,
  speed,
  stepVehicle,
  type VehicleArchetype,
  type VehicleControls,
} from './entities/vehicle';
import { Combat, type AimInput } from './game/combat';
import { Heat } from './game/heat';
import { NITRO_DRIFT, NITRO_MIN, NITRO_NEAR_MISS, NITRO_STUNT, Nitro } from './game/nitro';
import { HeatPresenter } from './game/heatPresenter';
import { Player } from './game/player';
import { ProgressDirector } from './game/progressDirector';
import { CROWD_DESPAWN, Population, type CrowdPed, type ParkingSpot, type Vehicle } from './game/population';
import { Effects } from './render/effects';
import { FxDirector } from './render/fxDirector';
import { CameraRig } from './render/cameraRig';
import { DynamicResolution } from './render/dynamicResolution';
import { Look, type PlayerView } from './render/look';
import { addHeatLook } from './render/heatLook';
import { CombatLook } from './render/combatLook';
import { PeoplePose } from './render/peoplePose';
import { PigeonLook } from './render/pigeonMesh';
import { createRenderer, precompile } from './render/post';
import { getQuality } from './render/quality';
import { VehicleModels } from './render/vehicleModels';
import { charVehicle, restoreVehicleLook } from './render/vehicleLooks';
import { knockDown, provoke, resumeWalking, scare, spawnPed, stepCrowdPed, type Target } from './systems/crowd';
import { WEAPONS, WEAPON_ORDER, type WeaponKind } from './systems/weapons';
import { PICKUP_RESPAWN, generatePickups, pickupAt, respawnPickups } from './world/pickups';
import {
  PLAYER_CRASH_SHARE,
  applyDamage,
  createDamage,
  crashDamage,
  damageStage,
  impactDamage,
  landingDamage,
  markPlayerHit,
  stepDamage,
} from './systems/damage';
import { StuntTracker } from './systems/stunts';
import { enteringRamp, placeKickers, placeRamps, rampSolids, rideRamps } from './world/ramps';
import { RampMesh } from './render/rampMesh';
import {
  bodyDistance,
  collidePedStatic,
  collidePedVehicle,
  collideVehicleStatic,
  collideVehicles,
  type CarContact,
} from './systems/physics';
import { Score, rammed, smashCredit, type Award } from './systems/score';
import { vehicleObstacles, type Obstacle } from './systems/traffic';
import type { PauseReason } from './ui/pauseOverlay';
import { loadBest } from './ui/scoreHud';
import { mountTouchControls } from './ui/touchControls';
import { mountCarButtons } from './ui/carButtons';
import { CombatHud } from './ui/combatHud';
import { AIM_TURN_RATE, aimHeading, approachAngle } from './core/aim';
import { getDevice } from './render/quality';
import { AttractCamera } from './ui/attract';
import { FrontDoor } from './ui/frontDoor';
import { blockBrowserGestures } from './ui/gestures';
import { Haptics } from './ui/haptics';
import { Hud, createHudFrame, gaugeTopSpeed, type CarHud } from './ui/hud';
import { mouseGround, updateMouseAim } from './ui/mouseAim';
import { Radar } from './ui/radar';
import { ThreatIndicators } from './ui/threats';
import { enterGameMode } from './ui/titleScreen';
import { WantedHud } from './ui/wantedHud';
import { ScreenAwake } from './ui/wakeLock';
import { generateCity, type Rect } from './world/city';
import { StaticGrid } from './world/collision';
import { mulberry32 } from './world/random';
import { Knockables, type KnockableItem } from './systems/knockables';
import { KnockFx } from './render/knockFx';
import { dressCity } from './world/dressing';
import { TrafficSignals } from './world/signals';
import { GameAudio, createAudioFrame, createCarSound, describeCar } from './audio/gameAudio';
import { StreetLife } from './game/streetLife';
import { mountRadioToast } from './ui/radioToast';
import { publicUrl } from './core/paths';

const app = document.getElementById('app')!;

/** How close (m, centre to centre) you must be to get into a car. */
const ENTER_RANGE = 4;
/** Cars moving faster than this can't be boarded. */
const ENTER_MAX_SPEED = 6;
/** Beside a long body, the reach counts from its side (a sedan's door is ~0.6 m from its body, 1.6 m from its centre). */
const ENTER_BODY_SLACK = 1;
/**
 * On foot: tuned for a landscape phone; a 16:9 desktop sees less across at
 * the same height, so it sits higher (~42 × 23 m on screen) to keep NPC
 * gunfights (22–24 m) and the pistol's 32 m in view.
 */
const CAMERA_FOOT: readonly [number, number] = getDevice().handheld ? [20, 24] : [27, 31];
/** Mouse aim leads the view toward the cursor by this share of its ground offset, at most this far (m). */
const MOUSE_LEAD = 0.3;
const MOUSE_LEAD_MAX = 8;
const CAMERA_CAR = [26, 64] as const;
/** The title screen's slow cruise over traffic. */
const CAMERA_ATTRACT = [34, 46] as const;
/** Passing this close (centre to centre) at speed without touching is a near miss. */
const NEAR_MISS_DIST = 3.4;
const NEAR_MISS_SPEED = 10;
const SPAWN_POINT = { x: 9.5, z: 9.5 };
/** Crashes slower than this (m/s closing speed) aren't worth an event. */
const CRASH_EVENT_MIN = 2.5;

// --- Renderer ---
const renderer = createRenderer();
app.append(renderer.domElement);
const resolution = new DynamicResolution(renderer);

// --- Scene ---
const scene = new Scene();
const city = generateCity(1337);
const pickups = generatePickups(1337);
/** Stunt ramps and kickers: their sides and backs are solid. */
const bigRamps = placeRamps(1337);
const ramps = [...bigRamps, ...placeKickers(1337, bigRamps)];
/** Street furniture and landmark models: lamp posts, signal poles, bollards, booth walls... collide. */
const dressing = dressCity(city, pickups, ramps);
const collision = new StaticGrid([...city.obstacles, ...dressing.solids]);
const rand = mulberry32(Date.now() >>> 0);
const rig = new CameraRig(1);
// Lights, time of day, ground, city, props, and the batched people/car/glow renderers.
const look = new Look(renderer, scene, city, rig, pickups, app, dressing.street);
look.props.setLandmarks(dressing.landmarks);
const effects = new Effects(scene);
/** Hydrants, bins, benches, cones: a car knocks them flying (they're back a minute later). */
const knockables = new Knockables(dressing.knockables);
const knockFx = new KnockFx(look.props, effects);
look.addGlowSource((_g, view) => knockFx.update(view));
// Blown-up cars shed debris.glb's parts once it's in.
look.props.onLoaded(() => (effects.debris.parts = look.props.debris));
look.addGlowSource(() => effects.debris.drawParts());
const rampGrid = new StaticGrid(rampSolids(ramps));
scene.add(new RampMesh(ramps, look).mesh);
const stunts = new StuntTracker();
/** Pigeon flocks on plazas, parks and pavements that scatter at cars, runners and gunfire (one draw call). */
const pigeons = new PigeonLook(scene, look, city, collision, events, mulberry32((Date.now() ^ 0x5eed) >>> 0));
/** Traffic lights: their clock runs with the sim; traffic stops on red, the lenses show it. */
const signals = new TrafficSignals();
look.props.signals = signals;

// --- Vehicles ---
const vehicles: Vehicle[] = [];

function createVehicle(archetype: VehicleArchetype, paint: ColorRepresentation): Vehicle {
  const sim = createVehicleState(0, 0, 0);
  sim.body = VEHICLE_BODIES[archetype];
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

/**
 * Parked at the kerbs around the spawn intersection; put back on every
 * respawn. The yellow sports car waits on the centreline across the
 * junction, lined up on the ramp a block east: the first car invites the
 * first STUNT (23 m of run-up, ~0.9 s of air flat out).
 */
const PARKED: ParkingSpot[] = [
  { archetype: 'sedan', x: 5.5, z: -14, heading: Math.PI, paint: '#c8342b' },
  { archetype: 'compact', x: -5.5, z: 16, heading: 0, paint: '#2f6fc0' },
  { archetype: 'van', x: 20, z: 5.5, heading: Math.PI / 2, paint: '#d9d6cc' },
  { archetype: 'sports', x: -11, z: 0, heading: Math.PI / 2, paint: '#e8b923' },
  { archetype: 'police', x: 5.5, z: 34, heading: Math.PI, paint: '#f2f2f2' },
  { archetype: 'scooter', x: -20, z: -5.8, heading: Math.PI / 2, paint: '#2fb5a8' },
];

/** Ready a recycled car for traffic: full health, and its proper look if it was a wreck or restyled. */
function resetVehicle(v: Vehicle, restyled: boolean) {
  v.damage = createDamage(VEHICLE_HEALTH[v.archetype]);
  v.sim.body = v.prev.body = VEHICLE_BODIES[v.archetype];
  v.wreckAge = 0;
  if (v.charred || restyled) restoreVehicleLook(v, look.cars);
}

const population = new Population(
  vehicles,
  {
    createVehicle,
    resetVehicle,
    createPedModel: (outfit, body) => {
      const model = look.characters.create(outfit, body);
      scene.add(model.root);
      return model;
    },
  },
  rand,
);

// Placeholder boxes show until the Blender-built models arrive.
VehicleModels.load(publicUrl('assets/vehicles.glb')).then(
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
/** Cars an activity needs kept (a mission's target, the Chaos Run car): filled by the progress director. */
const activityCars: Vehicle[] = [];
/**
 * Recycle and top up traffic and crowd; `seed` fills the streets from scratch
 * and puts the spawn point's parked cars back.
 */
function maintainPopulation(seed = false, parked = seed) {
  // Behind the title the streets follow the attract camera instead.
  const at = attract.active ? attract : player.position;
  keepVehicles[0] = player.driving;
  keepVehicles[1] = player.lastDriven;
  keepVehicles.length = 2;
  for (const v of activityCars) keepVehicles.push(v);
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
    parked: parked ? PARKED : undefined,
  });
  // Knocked-over furniture is back once nobody's looking.
  knockables.restore(viewRect, restoreProp);
}
const restoreProp = (k: KnockableItem) => look.props.restore(k.id);
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

// --- Heat: wanted level, police, arrests, Pay 'n' Spray, traffic reactions ---
const heatView: Rect = { minX: 0, minZ: 0, maxX: 0, maxZ: 0 };
const heat = new Heat({
  bus: events,
  city,
  grid: collision,
  vehicles,
  population,
  player,
  score,
  rand,
  view: () => rig.visibleGround(heatView),
  playing: () => !attract.active,
  award,
  ejectDriver,
  npcShoot,
  repaint: (v) => look.cars.restyle(v.mesh, v.archetype, v.paint),
  // Resprays cost cash (the progress director sets the price and can refuse).
  pay: (cost) => progress.payRespray(cost),
  // A race or Chaos Run 3-2-1 holds the car: no bust while it can't move.
  held: () => progress.holdControls,
  bustFine: () => progress.bustShare(),
  signals,
});
addHeatLook(look, heat, {
  scene,
  camera: () => rig.camera.position,
  playerCar: () => player.driving?.sim ?? null,
  knock: (kind, x, z, vx, vz) => knockFx.hit(kind, x, z, vx, vz),
});

// --- Combat: guns, fists, throws, rockets, drive-bys, blasts, fire ---
const combat = new Combat({
  bus: events,
  player,
  vehicles,
  crowd: population.crowd,
  grid: collision,
  rand,
  score,
  award,
  ejectDriver,
  now: () => simTime,
  playing: () => !attract.active,
  focus: () => ({ x: rig.focusX, z: rig.focusZ }),
  stars: () => heat.wanted.level,
  pose: playerModel,
});
const combatLook = new CombatLook(scene, look, effects, combat, population.crowd, player);
// Everyone's place, pose and clip each frame (and the player ducking into cars, cheering wins).
const people = new PeoplePose({
  bus: events,
  player,
  model: playerModel,
  crowd: population.crowd,
  locked: () => combat.lock !== null,
  playing: () => !attract.active,
});

// --- Audio (unlocks on the first tap / click / key) ---
const audio = new GameAudio({ best: score.best });
const audioFrame = createAudioFrame(vehicles);
const audioCar = createCarSound();
mountRadioToast(document.body, audio);
const streetLife = new StreetLife({
  vehicles,
  player,
  playerModel,
  police: heat.police,
  cars: look.cars,
  createRider: (outfit) => {
    const model = look.characters.create(outfit);
    scene.add(model.root);
    return model;
  },
  audio,
});

// --- Input ---
const input = new Input();
input.attachMouse(renderer.domElement);
const haptics = new Haptics(input, events);
// Screen on while a run is played and not paused (controller-only play never touches it).
const screenAwake = new ScreenAwake();
const touch = mountTouchControls(document.body, input.touch, haptics);
input.addResetHook(() => touch.reset());
const carButtons = mountCarButtons(touch.layer, input.touch, haptics);
input.addResetHook(() => carButtons.reset());
/** The player's nitro tank (fills by drifting, near misses and stunts). */
const nitro = new Nitro(events);
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
  // Muzzle flashes at the end of the barrel in the shooter's hand.
  muzzle: (e, out) => look.characters.placeShot(e, out),
});
events.on('enterVehicle', () => {
  // PeoplePose hides the body once it has ducked into the car.
  rig.setHeights(...CAMERA_CAR);
  input.setDriving(true);
  input.resetActions();
});
events.on('exitVehicle', () => {
  playerModel.root.visible = true;
  rig.setHeights(...CAMERA_FOOT);
  input.setDriving(false);
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
  let bestD2 = ENTER_RANGE * ENTER_RANGE;
  for (const v of vehicles) {
    const dx = v.sim.x - player.ped.x;
    const dz = v.sim.z - player.ped.z;
    // Long vehicles: anywhere along the body counts (the bus's door is 4 m from its middle).
    const d2 = Math.min(dx * dx + dz * dz, (bodyDistance(v.sim, player.ped.x, player.ped.z) + ENTER_BODY_SLACK) ** 2);
    if (d2 < bestD2 && speed(v.sim) < ENTER_MAX_SPEED && !v.damage.wrecked && !v.exported) {
      best = v;
      bestD2 = d2;
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
  // A bike on its side is stood back up; an ambulance or fire truck taken off its call goes dark.
  v.tipped = false;
  if (v.emergency) {
    v.emergency = false;
    look.cars.setSiren(v, false);
  }
  player.enter(v);
}

/** Step out of the car; a slide in progress is banked. Not in mid-air. */
function leaveVehicle() {
  if (!player.driving || player.driving.sim.airborne) return;
  award(score.endDrift(true));
  stunts.cancel();
  player.exit();
}

function respawnPlayer() {
  score.resetRun();
  // A new run (or the title) starts with nobody after you.
  calmHostiles();
  heat.reset();
  combat.reset();
  nitro.reset();
  stunts.cancel();
  // A fresh run starts empty-handed (perks re-arm on the respawn event).
  player.arsenal.clear();
  player.respawn(SPAWN_POINT.x, SPAWN_POINT.z);
  rig.snapTo(player.ped.x, player.ped.z);
  knockables.reset(restoreProp);
  knockFx.clear();
  maintainPopulation(true);
  // The run is over anyway: a good moment to pick up a waiting app update.
  updates.atSafePoint();
}

/** Out of custody after a bust: on the police station's steps, score (minus the fine) kept. */
function releasePlayer() {
  calmHostiles();
  heat.police.reset();
  const st = heat.station;
  player.respawn(st.x, st.z, st.heading);
  rig.snapTo(player.ped.x, player.ped.z);
  maintainPopulation(true, false);
  updates.atSafePoint();
}

// --- Simulation ---
const obstacles: Obstacle[] = [];
/** Obstacle records reused every step (one per car and ped). */
const obstaclePool: Obstacle[] = [];
function addObstacle(x: number, z: number, halfWidth: number, isPlayer = false, owner: Vehicle['sim'] | null = null) {
  const o = obstaclePool[obstacles.length] ?? (obstaclePool[obstacles.length] = { x: 0, z: 0, halfWidth: 0, player: false, owner: null });
  o.x = x;
  o.z = z;
  o.halfWidth = halfWidth;
  o.player = isPlayer;
  o.owner = owner;
  obstacles.push(o);
}
const vehicleStates: Array<Vehicle['sim']> = [];
const contact: CarContact = { x: 0, z: 0, nx: 0, nz: 0, closingA: 0, closingB: 0 };

function simulate(dt: number) {
  const driving = player.driving;
  // A race or Chaos Run 3-2-1 holds the car on the line.
  const playerControls = driving && !progress.holdControls ? input.readVehicle(driving.sim, dt) : NO_CONTROLS;
  // Nitro burns only while held, lit and in the tank.
  const boosting = nitro.step(dt, driving !== null && playerControls.boost === true && !attract.active, driving ? driving.sim : null);
  // NO_CONTROLS is shared: only the frame's own read gets the boost flag.
  if (playerControls !== NO_CONTROLS) playerControls.boost = boosting;

  // What AI drivers need to avoid this step.
  obstacles.length = 0;
  // Cars as their middle, long vehicles as a point per body circle (so queues stop at a bus's tail).
  for (const v of vehicles) vehicleObstacles(v.sim, v === driving, addObstacle);
  if (!driving && !attract.active) addObstacle(player.ped.x, player.ped.z, 0.4, true);
  for (const c of population.crowd) addObstacle(c.agent.s.x, c.agent.s.z, 0.4);

  for (const v of vehicles) {
    copyVehicleState(v.prev, v.sim);
    let controls = NO_CONTROLS;
    if (v.damage.wrecked) controls = NO_CONTROLS;
    else if (v.tipped) slideOnSide(v.sim, dt);
    else if (v === driving) controls = playerControls;
    // Traffic, police and road ragers. (A car's own entry sits at distance 0, which clearDistance ignores.)
    else if (v.ai || v.pursuit) controls = heat.drive(v, obstacles, dt);
    const landed = stepVehicle(v.sim, controls, VEHICLE_SPECS[v.archetype], dt);
    if (landed > 0) carLanded(v, landed, v === driving);
    if (rideRamps(v.sim, ramps) === 'launch') carJumped(v, v === driving);
  }

  copyPedState(player.prev, player.ped);
  if (!driving) {
    stepPedestrian(player.ped, player.down || attract.active ? NO_MOVE : input.readMove(), PLAYER_ON_FOOT, dt);
    // Twin-stick: face the lock-on or the aim while walking (strafe), not the way you walk.
    const face = combat.lockHeading() ?? aimHeadingNow;
    if (face !== null && !player.down) {
      player.ped.heading = approachAngle(player.ped.heading, face, AIM_TURN_RATE * dt);
    }
  }

  // Cars flying over people don't touch them.
  vehicleStates.length = 0;
  for (const v of vehicles) if (v.sim.y < 0.8) vehicleStates.push(v.sim);
  const target = playerTarget();
  // Only once the furniture is drawn (props.glb in): nothing invisible to knock.
  if (look.props.loaded) knockables.step(vehicleStates, dt, knockProp);
  for (const c of population.crowd) {
    copyPedState(c.prev, c.agent.s);
    const event = stepCrowdPed(c.agent, vehicleStates, rand, dt, target);
    if (event?.kind === 'struck') pedHitByCar(c, driving !== null && event.car === driving.sim ? driving : null);
    else if (event?.kind === 'punch') {
      combat.npcPunch(c);
    } else if (event?.kind === 'shoot') {
      c.model.shoot();
      npcShoot(c.agent.s.x, c.agent.s.z, event.dirX, event.dirZ);
    }
  }

  // --- Collisions ---
  for (const v of vehicles) {
    let impact = collideVehicleStatic(v.sim, collision, contact);
    // A ramp's sides and back are solid to anything not riding up it.
    if (!v.sim.airborne && v.sim.y <= 0 && !enteringRamp(v.sim, ramps)) impact = Math.max(impact, collideVehicleStatic(v.sim, rampGrid, contact));
    if (impact <= 0) continue;
    const hit = impactDamage(impact) * (v === driving ? PLAYER_CRASH_SHARE : 1);
    applyDamage(v.damage, hit);
    if (v === driving && hit > 0) markPlayerHit(v.damage, simTime);
    if (impact > CRASH_EVENT_MIN) {
      events.emit({ type: 'crash', x: contact.x, z: contact.z, impact, against: 'static', involvesPlayer: v === driving });
    }
    if (isBike(v.archetype) && bikeThrows(impact)) throwRider(v, impact);
  }
  for (let i = 0; i < vehicles.length; i++) {
    for (let j = i + 1; j < vehicles.length; j++) {
      const a = vehicles[i];
      const b = vehicles[j];
      const ma = VEHICLE_SPECS[a.archetype].mass;
      const mb = VEHICLE_SPECS[b.archetype].mass;
      const impact = collideVehicles(a.sim, b.sim, contact, ma, mb);
      if (impact <= 0) continue;
      // The rammer takes less than the car it hits, the heavier car less than the lighter.
      const hitA = crashDamage(impact, contact.closingA, contact.closingB, ma, mb) * (a === driving ? PLAYER_CRASH_SHARE : 1);
      const hitB = crashDamage(impact, contact.closingB, contact.closingA, mb, ma) * (b === driving ? PLAYER_CRASH_SHARE : 1);
      applyDamage(a.damage, hitA);
      applyDamage(b.damage, hitB);
      // A hard hit throws a bike's rider off (whichever of the two is a bike);
      // it's the player's doing only if the player's car did the ramming.
      if (isBike(a.archetype) && bikeThrows(impact)) throwRider(a, impact, b === driving && rammed(contact.closingB, contact.closingA));
      if (isBike(b.archetype) && bikeThrows(impact)) throwRider(b, impact, a === driving && rammed(contact.closingA, contact.closingB));
      const involvesPlayer = driving !== null && (a === driving || b === driving);
      if (involvesPlayer && hitA + hitB > 0) {
        markPlayerHit(a.damage, simTime);
        markPlayerHit(b.damage, simTime);
      }
      if (impact > CRASH_EVENT_MIN) {
        events.emit({ type: 'crash', x: contact.x, z: contact.z, impact, against: 'vehicle', involvesPlayer });
      }
      if (involvesPlayer && impact > 6) {
        // SMASH only for ramming, not for being rammed.
        const own = a === driving ? contact.closingA : contact.closingB;
        const other = a === driving ? contact.closingB : contact.closingA;
        if (smashCredit(impact, own, other)) award(score.award('smash', Math.round(impact * 4)));
        // Ramming a cop is a crime; an ordinary driver may panic, rage or bail.
        heat.playerCrash(a === driving ? b : a, impact);
        // A hit isn't a near miss.
        nearMissAt.set(a === driving ? b : a, simTime);
      }
    }
  }

  // --- Stunt scoring ---
  simTime += dt;
  signals.step(dt);
  score.step(dt);
  if (driving) {
    const stunt = stunts.step(driving.sim, dt);
    if (stunt && !driving.damage.wrecked) {
      const a = score.award('stunt', stunt.points);
      a.label = stunt.label;
      award(a);
      nitro.add(NITRO_STUNT);
      const ds = driving.sim;
      events.emit({ type: 'stunt', x: ds.x, z: ds.z, airtime: stunt.airtime, distance: stunt.distance, spin: stunt.spin, points: a.points, label: stunt.label });
    }
  } else stunts.cancel(); // thrown out mid-air (the car blew up): that jump is void
  if (driving && !driving.damage.wrecked && !driving.sim.airborne) {
    const ds = driving.sim;
    const slip = Math.abs(lateralSpeed(ds));
    award(score.drift(slip, speed(ds), dt));
    if (slip > 3.5 && speed(ds) > 8) nitro.add(NITRO_DRIFT * dt);
    if (speed(ds) > NEAR_MISS_SPEED) {
      for (const v of vehicles) {
        if (v === driving || v.damage.wrecked) continue;
        const dx = v.sim.x - ds.x;
        const dz = v.sim.z - ds.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > NEAR_MISS_DIST * NEAR_MISS_DIST || d2 < 2.05 * 2.05) continue;
        if (Math.hypot(v.sim.vx - ds.vx, v.sim.vz - ds.vz) < NEAR_MISS_SPEED) continue;
        if (simTime - (nearMissAt.get(v) ?? -99) < 2.5) continue;
        nearMissAt.set(v, simTime);
        award(score.award('nearMiss'));
        nitro.add(NITRO_NEAR_MISS);
      }
    }
  }

  // --- Pickups ---
  respawnPickups(pickups, simTime);
  if (!driving && player.alive && !attract.active) {
    const pk = pickupAt(pickups, player.ped.x, player.ped.z);
    // A crate you can't use (full health, armour or ammo) stays for later.
    if (pk && combat.collect(pk.kind)) {
      pk.respawnAt = simTime + PICKUP_RESPAWN;
      events.emit({ type: 'pickup', kind: pk.kind, x: pk.x, z: pk.z });
    }
  }
  heat.step(dt);
  combat.step(dt);
  // Cash, the Chaos Run clock and the free-roam activities.
  progress.step(dt);
  // Back on your feet: after dying a fresh run; after a bust, released at the station.
  const held = player.arrested;
  if (player.step(dt)) {
    if (held) releasePlayer();
    else respawnPlayer();
  }

  // --- Fire and explosions ---
  for (const v of vehicles) {
    // NPC drivers bail out of burning cars.
    if (v.ai && v.damage.burning) ejectDriver(v, v.sim.x, v.sim.z);
    if (stepDamage(v.damage, dt)) explode(v);
  }
  if (!player.driving) {
    for (const s of vehicleStates) collidePedVehicle(player.ped, s);
    // Static last so a car can't shove the player into a wall (or a ramp).
    collidePedStatic(player.ped, collision);
    collidePedStatic(player.ped, rampGrid);
  }
  for (const c of population.crowd) {
    if (c.agent.mode !== 'down') for (const s of vehicleStates) collidePedVehicle(c.agent.s, s);
    collidePedStatic(c.agent.s, collision);
    collidePedStatic(c.agent.s, rampGrid);
  }
  syncWeapon();
}

/** A car knocked street furniture flying: it's gone from its spot, a copy tumbles away, and the hit is heard. */
function knockProp(k: KnockableItem, car: Vehicle['sim']) {
  look.props.knock(k.id);
  knockFx.hit(k.kind, k.x, k.z, car.vx, car.vz);
  const impact = Math.min(7, Math.max(3, speed(car) * 0.3));
  events.emit({ type: 'crash', x: k.x, z: k.z, impact, against: 'static', involvesPlayer: player.driving !== null && player.driving.sim === car });
}

/** Off a bike in a hard crash: knocked flat this long (the player), s; hurt by this much per m/s of impact. */
const BIKE_THROW_STUN = 1.6;
const BIKE_THROW_HURT = 1.4;

/**
 * A bike crashed hard: the rider is thrown off over the bars and knocked
 * flat (hurt, if it's the player), and the bike is left on its side. A
 * police bike's officer is thrown by the police (they see `tipped`).
 * `byPlayer`: the player's car rammed it (scored and reported like any
 * hit-and-run).
 */
function throwRider(v: Vehicle, impact: number, byPlayer = false) {
  if (v.tipped) return;
  v.tipped = true;
  const s = v.sim;
  // Flung on along the way the bike was going.
  const fromX = s.x - s.vx;
  const fromZ = s.z - s.vz;
  const push = Math.min(9, 3 + impact * 0.4);
  if (v === player.driving) {
    player.exit(s.vx * 0.5, s.vz * 0.5);
    player.knockDown(fromX, fromZ, push, BIKE_THROW_STUN, 'vehicle', false);
    player.hurt(impact * BIKE_THROW_HURT);
    stunts.cancel();
    return;
  }
  if (!v.ai) return;
  v.ai = null;
  const at = player.position;
  if (Math.hypot(s.x - at.x, s.z - at.z) > CROWD_DESPAWN) return;
  const door = driverDoorPosition(s);
  const agent = spawnPed(0, 0, 0, 0, rand);
  Object.assign(agent.s, { x: door.x, z: door.z, vx: 0, vz: 0, heading: s.heading });
  knockDown(agent, fromX, fromZ, push, 2.5);
  population.addPed(agent);
  // Rammed off by the player: a hit-and-run like any other.
  events.emit({ type: 'pedDown', x: door.x, z: door.z, cause: 'vehicle', byPlayer });
  if (byPlayer && player.driving) {
    award(score.award('hitAndRun'));
    provoke(agent, player.driving.sim.x, player.driving.sim.z);
  }
}

/** A car came off a ramp: report the take-off and the flight time to expect. */
function carJumped(v: Vehicle, isPlayer: boolean) {
  const s = v.sim;
  // Off the lip at its height (s.y): a ramp's 1.6 m, a kicker's 0.6 m.
  const airtime = (s.vy + Math.sqrt(s.vy * s.vy + 2 * GRAVITY * Math.max(0, s.y))) / GRAVITY;
  events.emit({ type: 'jump', x: s.x, z: s.z, speed: speed(s), airtime, involvesPlayer: isPlayer });
}

/** A car came down from a jump at `impact` m/s: hard landings hurt it. */
function carLanded(v: Vehicle, impact: number, isPlayer: boolean) {
  applyDamage(v.damage, landingDamage(impact));
  if (impact > 3) events.emit({ type: 'land', x: v.sim.x, z: v.sim.z, impact, involvesPlayer: isPlayer });
}

/**
 * A ped was knocked over by a car this step; `playerCar` is set only when it
 * was the player's car that hit them (a police car running down its own
 * officer beside you isn't your hit and run).
 */
function pedHitByCar(c: CrowdPed, playerCar: Vehicle | null) {
  const s = c.agent.s;
  events.emit({ type: 'pedDown', x: s.x, z: s.z, cause: 'vehicle', byPlayer: playerCar !== null, cop: c.agent.role === 'cop' });
  if (playerCar) {
    award(score.award('hitAndRun'));
    provoke(c.agent, playerCar.sim.x, playerCar.sim.z);
  }
}

/** A car blew up: char it, then the blast (Combat) does the rest. */
function explode(source: Vehicle) {
  charVehicle(source);
  source.wreckAge = 0;
  combat.vehicleExploded(source);
}

function playerTarget(): Target {
  const at = player.position;
  // Behind the title the player is hidden and out of play: nobody comes for them.
  return { x: at.x, z: at.z, inCar: player.driving !== null, alive: player.alive && !player.arrested && !attract.active };
}

/** An NPC (an armed ped, the police) shot from (sx, sz) along unit (dirX, dirZ). */
function npcShoot(sx: number, sz: number, dirX: number, dirZ: number) {
  combat.npcShoot(sx, sz, dirX, dirZ);
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
  // Never negative: a frame's timestamp can predate `last` when RESUME / PLAY
  // reset it mid-frame on a busy main thread, and easing, springs and clips
  // stepped backwards blow up (the camera once ended up under the street).
  const frameSeconds = Math.min(0.25, Math.max(0, elapsed));
  last = now;
  input.pollGamepad();
  // The pad's Select / View tunes the radio anywhere, like R or tapping the radio card.
  if (input.consumeStation()) audio.nextStation();
  // Menus first: they take keyboard / pad navigation and pause toggles.
  frontDoor.update();
  if (paused) {
    // Resizing clears the canvas (rotating the phone while paused): redraw the
    // frozen scene behind the pause card.
    if ((resized || redrawPaused) && !contextLost) {
      redrawPaused = false;
      look.render(rig.camera);
    }
    return;
  }

  // Aim: the mouse needs the camera to find the ground under the cursor.
  const me = player.position;
  updateMouseAim(input, rig.camera, me.x, me.z, viewW, viewH);
  const aim = input.readAim();
  const playing = !attract.active;
  // On foot with the mouse: see what you shoot at (the view leans toward the cursor).
  if (playing && !player.driving && mouseGround.valid) {
    const dx = (mouseGround.x - me.x) * MOUSE_LEAD;
    const dz = (mouseGround.z - me.z) * MOUSE_LEAD;
    const k = Math.min(1, MOUSE_LEAD_MAX / (Math.hypot(dx, dz) || 1));
    rig.aimAt(dx * k, dz * k);
  } else rig.aimAt(0, 0);
  // A card over the game (results, a phone call, the shop) takes the input.
  const control = playing && !progress.blocksInput;
  const aiming = control && player.ready && aim.active ? aimHeading(aim.x, aim.y) : null;
  aimHeadingNow = player.driving ? null : aiming;
  const pressed = input.consumePunch();
  const cycle = input.consumeCycle();
  const acted = input.consumeAction();
  if (control) {
    // In a car, only what fires out of a window is on offer.
    if (cycle !== 0) player.arsenal.cycle(cycle, player.driving ? driveByOnly : undefined);
    const gun = player.arsenal.current;
    if (player.driving) {
      const auto = gun !== null && WEAPONS[gun].driveBy && WEAPONS[gun].automatic;
      if (pressed || (auto && input.fireHeld)) combat.driveBy(aiming);
      combat.updateAim(false, aimInput);
    } else if (player.ready) {
      aimInput.heading = aimHeadingNow;
      aimInput.reach = aim.active ? Math.min(1, Math.hypot(aim.x, aim.y)) : 0;
      aimInput.ground = input.mouseAimLive() && mouseGround.valid ? mouseGround : null;
      combat.updateAim(pressed || aim.fire || input.fireHeld, aimInput);
      if (gun) {
        // Throwables go when the aim stick is let go (once), never on a held push.
        const stick = WEAPONS[gun].mode === 'throw' ? aim.release : aim.fire;
        if (pressed || stick || (WEAPONS[gun].automatic && input.fireHeld)) combat.fire(aimInput);
      } else if (pressed || aim.fire) combat.punch(aimHeadingNow);
    } else combat.updateAim(false, aimInput);
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
  // Cards freeze it; the end of a Chaos Run slows it to a stop.
  const alpha = loop.advance(frameSeconds * fx.simScale(frameSeconds) * progress.simScale(), simulate);

  // Interpolate render state between the last two sim steps.
  // Read once per frame: the wheel steer and the engine sound share it.
  const controls = player.driving ? input.readVehicle(player.driving.sim) : null;
  const steer = controls ? controls.steer : 0;
  for (const v of vehicles) {
    v.mesh.root.position.set(lerp(v.prev.x, v.sim.x, alpha), lerp(v.prev.y, v.sim.y, alpha), lerp(v.prev.z, v.sim.z, alpha));
    v.mesh.root.rotation.y = lerpAngle(v.prev.heading, v.sim.heading, alpha);
    for (const w of v.mesh.frontWheels) w.rotation.y = v === player.driving ? -steer * 0.5 : 0;
  }
  // People: placed, holding what they hold, playing the clip for what they're doing (hit-stop freezes them too).
  people.update(frameSeconds * fx.hitStop.scale, alpha, aimHeadingNow);
  const ped = player.ped;
  const prev = player.prev;
  const px = lerp(prev.x, ped.x, alpha);
  const pz = lerp(prev.z, ped.z, alpha);

  // Body motion, tyre marks, damaged-car smoke and fire, weather, particles.
  const focus = attract.active ? attract : player.position;
  pigeons.update(frameSeconds * fx.hitStop.scale, focus.x, focus.z, rig, vehicles, population.crowd, attract.active ? null : player);
  fx.update(frameSeconds, controls, focus.x, focus.z, !attract.active);
  // Bikes lean and carry their riders; emergency sirens and the ice cream chime.
  streetLife.update(frameSeconds, focus.x, focus.z, !attract.active);
  combatLook.update(frameSeconds * fx.hitStop.scale);
  updateHud(frameSeconds);
  progress.update(frameSeconds);
  heatPresenter.update(frameSeconds, focus.x, focus.z, playing);

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

/** This frame's aim, for Combat (reused). */
const aimInput: AimInput = { heading: null, reach: 0, ground: null };
const driveByOnly = (k: WeaponKind) => WEAPONS[k].driveBy;

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
  // The bar shows the share of this life's maximum (TOUGH SKIN raises it).
  hudFrame.health = (player.health * 100) / player.maxHealth;
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
  const nearCar = v || attract.active || progress.blocksInput ? null : nearestEnterable();
  hudFrame.nearCar = nearCar ? (nearCar.ai ? 'jack' : 'enter') : null;
  hudFrame.mouseAim = !v && !attract.active && input.mouseAimLive();
  hudFrame.driveBy = v !== null && gun !== null && WEAPONS[gun].driveBy;
  hud.update(frameSeconds, hudFrame);
  combatHud.update(player.armour, nitro.charge, nitro.boosting, nitro.charge >= NITRO_MIN);
  carButtons.update(v ? (gun && WEAPONS[gun].driveBy ? gun : player.arsenal.driveByGun()) : null, nitro.charge, nitro.charge >= NITRO_MIN || nitro.boosting);
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
const combatHud = new CombatHud(document.getElementById('hud')!);
const radar = new Radar(document.body, city, { vehicles, pickups, crowd: population.crowd });
const wantedHud = new WantedHud(document.body, events);
const heatPresenter = new HeatPresenter(heat, audio, radar, wantedHud, hud.score, events);
const threats = new ThreatIndicators(document.body);
const frontDoor = new FrontDoor(document.body, document.getElementById('paused')!, input, audio, {
  startGame,
  enterTitle,
  // A Chaos Run starts over as a fresh run; free roam respawns.
  restart: () => {
    if (!progress.restart()) respawnPlayer();
  },
  setPaused: (p, reason) => setPaused(p, reason),
  isPaused: () => paused,
  pauseReason: () => pauseReason,
  applyUpdate: () => updates.atSafePoint(),
});
// Cash, saves, Chaos Run, activities and missions (adds CHAOS RUN to the title, PROGRESS / SHOP to the pause menu).
const progress = new ProgressDirector({
  bus: events,
  player,
  vehicles,
  population,
  heat,
  score,
  city,
  rand,
  look,
  rig,
  radar,
  hud,
  audio,
  frontDoor,
  input,
  haptics,
  scene,
  pinned: activityCars,
  playing: () => !attract.active,
  enterTitle: () => enterTitle(),
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
  progress.startRun();
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
  screenAwake.set(true);
  enterGameMode(getDevice().handheld);
}

/** Quit to title: drop the run, hide the player, cruise over traffic. */
function enterTitle() {
  progress.enterTitle();
  screenAwake.set(false);
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
/** Draw one frame behind the pause card (the GL context came back while paused). */
let redrawPaused = false;
/** No restore this long after a lost context: offer a reload, ms. */
const RELOAD_OFFER_MS = 6000;
let reloadOfferTimer = 0;
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
  screenAwake.set(!p && !frontDoor.inTitle);
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
  // A restore that never comes would leave the card up for good: offer a reload (the save is flushed first).
  window.clearTimeout(reloadOfferTimer);
  reloadOfferTimer = window.setTimeout(() => {
    if (!contextLost) return;
    frontDoor.pause.offerReload(() => {
      progress.progress.flush();
      location.reload();
    });
  }, RELOAD_OFFER_MS);
});
renderer.domElement.addEventListener('webglcontextrestored', () => {
  contextLost = false;
  window.clearTimeout(reloadOfferTimer);
  frontDoor.pause.offerReload(null);
  resolution.holdOff();
  if (pausedForContext) setPaused(false);
  else if (paused) {
    // Back to the pause menu: draw the city behind it again now (and compile
    // every program while still paused, not on the RESUME frame).
    setPaused(true, 'paused');
    redrawPaused = true;
  }
  pausedForContext = false;
});

// Debug hook for poking at the sim from the console / automated checks.
(window as unknown as { __ub: unknown }).__ub = {
  player,
  playerModel,
  people,
  pigeons,
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
  heat,
  progress,
  combat,
  nitro,
  ramps,
  stunts,
  dressing,
  knockables,
  signals,
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
  /**
   * Run the simulation `seconds` ahead in fixed steps without rendering, for
   * automated checks on slow (software) GPUs where frames take seconds.
   */
  fastForward(seconds: number) {
    for (let t = 0; t < seconds; t += 1 / 60) {
      simulate(1 / 60);
      if ((maintainTimer -= 1 / 60) <= 0) {
        maintainTimer = 0.25;
        maintainPopulation();
      }
    }
  },
};

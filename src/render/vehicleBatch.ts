import {
  BackSide,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  FrontSide,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  MeshDepthMaterial,
  MeshStandardMaterial,
  PMREMGenerator,
  WebGLRenderTarget,
  type BufferGeometry,
  type Camera,
  type ColorRepresentation,
  type Object3D,
  type Scene,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { VEHICLE_SPECS, type VehicleArchetype } from '../entities/vehicle';
import type { Rect } from '../world/city';
import { createCarMesh, placeholderCarGeometry, type CarMesh } from './carMesh';
import type { ContactShadows } from './contactShadows';
import { GLOW, uploadRange, type GlowSprites } from './glowSprites';
import { UB_COMMON, UB_STREET_LIGHT, after, replace, useWorldUniforms, worldUniforms } from './shaderLib';
import { dimsOf, type CarDims, type VehicleModels } from './vehicleModels';

/** Most cars of one model drawn at once (cars off-screen aren't drawn at all). */
const PER_ARCHETYPE = 48;
/**
 * One shadow-depth material for every car batch. Otherwise cars share
 * three's default one with the city chunks (which have instanceColor), and
 * each flip between the two rebuilds its program parameters, twice a frame.
 */
const CAR_DEPTH = new MeshDepthMaterial();
/** The face three's shadow pass draws for each material side (WebGLShadowMap). */
const SHADOW_SIDE = { [FrontSide]: BackSide, [BackSide]: FrontSide, [DoubleSide]: DoubleSide };
/** Cars this far outside the visible ground still draw (their shadows and lights reach in), m. */
const VIEW_MARGIN = 10;
/** Headlights stay on this long after a car last moved (parked cars stay dark), s. */
const LIGHTS_LINGER = 20;

interface ArchetypeMesh {
  mesh: InstancedMesh;
  paint: InstancedBufferAttribute;
  state: InstancedBufferAttribute;
  siren: InstancedBufferAttribute;
  dims: CarDims;
  count: number;
}

/** Per-car render bookkeeping: motion (to light brake lights) and when it last moved. */
interface CarRecord {
  car: CarMesh;
  x: number;
  z: number;
  speed: number;
  brake: number;
  idle: number;
  tracked: boolean;
}

/**
 * Draws every car: one instanced mesh per model (sedan, van, ...), so the
 * whole traffic jam costs ~7 draw calls whatever its size, plus the same in
 * the shadow pass. Paint, steering, brake lights, charring and sirens are
 * per-instance attributes read by a MeshStandardMaterial patched with
 * onBeforeCompile; paint and glass reflect a PMREM studio environment (set on
 * this material only, not the scene) so cars gleam.
 *
 * Also lays down each car's contact shadow and its faked lights (headlight
 * beams at night, tail and brake lights, siren wash) into GlowSprites.
 */
export class CarBatch {
  readonly root = new Group();
  readonly material: MeshStandardMaterial;
  private readonly meshes = new Map<VehicleArchetype, ArchetypeMesh>();
  /** The same meshes as a list, for allocation-free iteration every frame. */
  private readonly meshList: ArchetypeMesh[] = [];
  private readonly records: CarRecord[] = [];
  private readonly placeholder = placeholderCarGeometry();
  private models: VehicleModels | null = null;
  private envMap: Texture | null = null;
  /**
   * Draw every model's mesh next frame even with no cars (zero instances: no
   * GL draw call, but its geometry is uploaded), so a model's first
   * appearance mid-drive never stalls on an upload.
   */
  private uploadAll = true;

  constructor(private readonly renderer: WebGLRenderer) {
    this.root.name = 'cars';
    this.material = carMaterial();
    this.buildEnvironment();
    // Every model's mesh up front (see uploadAll).
    for (const archetype of Object.keys(VEHICLE_SPECS) as VehicleArchetype[]) this.meshFor(archetype);
  }

  /**
   * Compile the cars' shadow-depth program now (renderer.compile skips depth
   * materials), in the state the shadow pass draws it: into a target, with
   * the face and map it copies from the car material, `scene`'s lights and
   * no fog (the pass draws outside any scene).
   */
  precompileDepth(scene: Scene, camera: Camera): void {
    const am = this.meshList[0];
    if (!am) return;
    const m = this.material;
    CAR_DEPTH.side = m.shadowSide ?? SHADOW_SIDE[m.side];
    CAR_DEPTH.map = m.map;
    const probe = new InstancedMesh(am.mesh.geometry, CAR_DEPTH, 1);
    const target = new WebGLRenderTarget(1, 1);
    const previous = this.renderer.getRenderTarget();
    const fog = scene.fog;
    scene.fog = null;
    this.renderer.setRenderTarget(target);
    try {
      this.renderer.compile(probe, camera, scene);
    } finally {
      this.renderer.setRenderTarget(previous);
      scene.fog = fog;
      target.dispose();
    }
  }

  /** (Re)build the reflection map, e.g. after the GL context was restored. */
  buildEnvironment(): void {
    const pmrem = new PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    const env = pmrem.fromScene(room, 0.04).texture;
    room.dispose();
    pmrem.dispose();
    this.envMap?.dispose();
    this.envMap = env;
    this.material.envMap = env;
    this.material.needsUpdate = true;
  }

  /** How strongly paint and glass reflect (follows the time of day). */
  set envIntensity(v: number) {
    this.material.envMapIntensity = v;
  }

  /** A new car (its root goes in the scene; place it like any object). */
  create(archetype: VehicleArchetype, paint: ColorRepresentation): CarMesh {
    const car = createCarMesh(archetype, new Color(paint));
    this.records.push({ car, x: 0, z: 0, speed: 0, brake: 0, idle: LIGHTS_LINGER, tracked: false });
    return car;
  }

  /** Change a car's model or paint (recycling). */
  restyle(car: CarMesh, archetype: VehicleArchetype, paint: ColorRepresentation): void {
    car.archetype = archetype;
    car.paint.set(paint);
  }

  /**
   * Flash a car's red/blue light bar and the coloured wash on the road
   * round it (police chases), or stop it. Stays until turned off or the car
   * is recycled.
   */
  setSiren(vehicle: { mesh: CarMesh }, on: boolean): void {
    setSiren(vehicle, on);
  }

  /** A bike's seat from vehicles.glb (the rider's hips, in its own frame), once loaded. */
  seat(archetype: VehicleArchetype): readonly [number, number, number] | undefined {
    return this.models?.seat(archetype);
  }

  /** vehicles.glb arrived: every car switches from the placeholder boxes to its model. */
  setModels(models: VehicleModels): void {
    this.models = models;
    for (const [archetype, am] of this.meshes) this.useGeometry(am, archetype);
    this.uploadAll = true;
  }

  /**
   * Write every visible car into the instance buffers, its contact shadow,
   * and its lights. Call once per frame before rendering.
   */
  flush(view: Rect, dt: number, shadows: ContactShadows, glows: GlowSprites): void {
    const list = this.meshList;
    for (let k = 0; k < list.length; k++) list[k].count = 0;
    const night = worldUniforms.uNight.value;
    const time = worldUniforms.uTime.value;
    for (const rec of this.records) {
      const car = rec.car;
      if (!isShown(car.root)) {
        rec.tracked = false;
        continue;
      }
      car.root.updateWorldMatrix(true, false);
      const e = car.root.matrixWorld.elements;
      const x = e[12];
      const z = e[14];
      const sin = e[8];
      const cos = e[10];
      this.track(rec, x, z, sin, cos, dt);
      if (x < view.minX - VIEW_MARGIN || x > view.maxX + VIEW_MARGIN || z < view.minZ - VIEW_MARGIN || z > view.maxZ + VIEW_MARGIN) continue;

      const am = this.meshFor(car.archetype);
      if (am.count >= PER_ARCHETYPE) continue;
      const i = am.count++;
      const lights = !car.charred && rec.idle < LIGHTS_LINGER ? 1 : 0;
      am.mesh.setMatrixAt(i, car.root.matrixWorld);
      am.paint.setXYZ(i, car.paint.r, car.paint.g, car.paint.b);
      am.state.setXYZW(i, car.frontWheels[0]?.rotation.y ?? 0, car.charred ? 0 : rec.brake, car.charred ? 1 : 0, lights);
      am.siren.setX(i, car.siren && !car.charred ? 1 : 0);

      const d = am.dims;
      const heading = Math.atan2(sin, cos);
      const mid = (d.front - d.rear) / 2;
      // Off the ground (a ramp, a jump) the shadow stays on the road, softer and fainter with height.
      const lift = Math.max(0, e[13]);
      shadows.add(x + sin * mid, z + cos * mid, heading, d.halfWidth * 0.98, (d.front + d.rear) / 2, 0.45 + lift * 0.25, 0.62 / (1 + lift * 0.35));
      this.addLights(glows, car, rec, d, x, z, sin, cos, heading, night * lights, time);
    }
    for (let k = 0; k < list.length; k++) {
      const am = list[k];
      const n = am.count;
      am.mesh.count = n;
      am.mesh.visible = n > 0 || this.uploadAll;
      // An empty archetype's mesh is hidden, so there is nothing to upload.
      if (n === 0 && !this.uploadAll) continue;
      uploadRange(am.mesh.instanceMatrix, n);
      uploadRange(am.paint, n);
      uploadRange(am.state, n);
      uploadRange(am.siren, n);
    }
    this.uploadAll = false;
  }

  /** Follow a car's motion: forward speed, braking (hard deceleration) and how long it's been still. */
  private track(rec: CarRecord, x: number, z: number, sin: number, cos: number, dt: number): void {
    if (rec.tracked && dt > 0) {
      const forward = ((x - rec.x) * sin + (z - rec.z) * cos) / dt;
      const accel = (forward - rec.speed) / dt;
      rec.speed += (forward - rec.speed) * Math.min(1, dt * 12);
      const braking = Math.abs(rec.speed) > 0.6 && accel * Math.sign(rec.speed) < -4 ? 1 : 0;
      rec.brake += (braking - rec.brake) * Math.min(1, dt * (braking ? 14 : 3));
      rec.idle = Math.abs(rec.speed) > 0.4 ? 0 : rec.idle + dt;
    } else {
      rec.speed = 0;
      rec.brake = 0;
    }
    rec.x = x;
    rec.z = z;
    rec.tracked = true;
  }

  private addLights(
    glows: GlowSprites,
    car: CarMesh,
    rec: CarRecord,
    d: CarDims,
    x: number,
    z: number,
    sin: number,
    cos: number,
    heading: number,
    beams: number,
    time: number,
  ): void {
    if (beams > 0.01) {
      // Beam on the road ahead, and flares at the lamps themselves.
      const reach = 13;
      glows.addFlat(x + sin * (d.front + reach / 2 - 0.3), 0.07, z + cos * (d.front + reach / 2 - 0.3), heading, 7.5, reach, 0.34 * beams, 0.29 * beams, 0.2 * beams, GLOW.cone);
      for (let side = -1; side <= 1; side += 2) {
        const lx = x + sin * (d.front - 0.1) + cos * side * d.halfWidth * 0.62;
        const lz = z + cos * (d.front - 0.1) - sin * side * d.halfWidth * 0.62;
        glows.addFlat(lx, 0.8, lz, heading, 1.1, 1.1, 0.9 * beams, 0.8 * beams, 0.6 * beams, GLOW.disc);
      }
    }
    const tail = 0.55 * beams + 1.5 * rec.brake;
    if (tail > 0.02) {
      glows.addFlat(x - sin * (d.rear + 0.2), 0.75, z - cos * (d.rear + 0.2), heading, d.halfWidth * 2.3, 0.9, tail, 0.06 * tail, 0.04 * tail, GLOW.bar);
    }
    if (car.siren && !car.charred) {
      const phase = (time * 2.5) % 1;
      const blue = phase < 0.5;
      const side = blue ? 1 : -1;
      const top = d.height + 0.15;
      // A police bike's lights are smaller and closer together than a car's light bar.
      const size = Math.min(1, d.halfWidth / 0.9);
      const bx = x + cos * side * 0.45 * size;
      const bz = z - sin * side * 0.45 * size;
      const r = blue ? 0.15 : 2.2;
      const g = blue ? 0.45 : 0.1;
      const b = blue ? 2.6 : 0.08;
      const flare = 2.2 * (0.5 + 0.5 * size);
      glows.addFlat(bx, top, bz, heading, flare, flare, r, g, b, GLOW.disc);
      // Wash on the road around the car.
      const wash = 0.18 + 0.22 * worldUniforms.uNight.value;
      const pool = 11 * (0.55 + 0.45 * size);
      glows.addFlat(x, 0.08, z, heading, pool, pool, r * wash, g * wash, b * wash, GLOW.disc);
    }
  }

  private meshFor(archetype: VehicleArchetype): ArchetypeMesh {
    let am = this.meshes.get(archetype);
    if (am) return am;
    const mesh = new InstancedMesh(this.placeholder, this.material, PER_ARCHETYPE);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false; // culled per car in flush()
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.customDepthMaterial = CAR_DEPTH;
    mesh.count = 0;
    mesh.name = `cars_${archetype}`;
    const attr = (size: number) => new InstancedBufferAttribute(new Float32Array(PER_ARCHETYPE * size), size).setUsage(DynamicDrawUsage);
    am = { mesh, paint: attr(3), state: attr(4), siren: attr(1), dims: dimsOf(this.placeholder), count: 0 };
    this.meshes.set(archetype, am);
    this.meshList.push(am);
    this.useGeometry(am, archetype);
    this.root.add(mesh);
    return am;
  }

  /** Point an archetype's mesh at its model (or the placeholder), carrying the instance attributes over. */
  private useGeometry(am: ArchetypeMesh, archetype: VehicleArchetype): void {
    const source: BufferGeometry = this.models?.geometry(archetype) ?? this.placeholder;
    const geo = source.clone();
    geo.setAttribute('aPaint', am.paint);
    geo.setAttribute('aState', am.state);
    geo.setAttribute('aSiren', am.siren);
    const old = am.mesh.geometry;
    am.mesh.geometry = geo;
    if (old !== this.placeholder) old.dispose();
    am.dims = this.models?.dims(archetype) ?? dimsOf(this.placeholder);
  }
}

/** Turn a car's light bar (and the blue/red wash around it) on or off. */
export function setSiren(vehicle: { mesh: CarMesh }, on: boolean): void {
  vehicle.mesh.siren = on;
}

function carMaterial(): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({ roughness: 0.5, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    useWorldUniforms(shader);
    shader.vertexShader = after(
      shader.vertexShader,
      '#include <common>',
      `attribute vec3 aColor;
      attribute float aKind;
      attribute vec3 aWheel;
      attribute vec3 aPaint;
      attribute vec4 aState;
      attribute float aSiren;
      uniform float uTime;
      uniform float uNight;
      varying vec3 vCarColor;
      varying vec3 vCarEmissive;
      varying vec3 vCarSurf;
      varying vec3 vCarWorld;
      varying vec3 vCarNormal;`,
    );
    shader.vertexShader = replace(
      shader.vertexShader,
      '#include <beginnormal_vertex>',
      `float carC = cos(aState.x);
      float carS = sin(aState.x);
      #include <beginnormal_vertex>
      if (aWheel.z > 0.5) objectNormal = vec3(carC * objectNormal.x + carS * objectNormal.z, objectNormal.y, -carS * objectNormal.x + carC * objectNormal.z);`,
    );
    shader.vertexShader = after(
      shader.vertexShader,
      '#include <begin_vertex>',
      `if (aWheel.z > 0.5) {
        vec2 wd = transformed.xz - aWheel.xy;
        transformed.xz = aWheel.xy + vec2(carC * wd.x + carS * wd.y, -carS * wd.x + carC * wd.y);
      }`,
    );
    shader.vertexShader = after(
      shader.vertexShader,
      '#include <project_vertex>',
      `int kind = int(aKind + 0.5);
      float charred = aState.z;
      float lights = aState.w * uNight;
      float blink = step(0.5, fract(uTime * 2.5));
      vec3 col = kind == 0 ? aPaint : aColor;
      vec3 surf = vec3(0.55, 0.0, 0.25); // roughness, metalness, reflection
      vec3 emis = vec3(0.0);
      if (kind == 0) surf = vec3(0.3, 0.0, 1.0);
      else if (kind == 1) surf = vec3(0.06, 0.0, 1.5);
      else if (kind == 2) { surf = vec3(0.2, 0.0, 0.6); emis = vec3(1.0, 0.86, 0.62) * (0.06 + 2.6 * lights); }
      else if (kind == 3) { surf = vec3(0.25, 0.0, 0.6); emis = vec3(1.0, 0.06, 0.03) * (0.05 + 0.9 * lights + 2.4 * aState.y); }
      else if (kind == 4) surf = vec3(0.92, 0.0, 0.06);
      else if (kind == 5) surf = vec3(0.5, 0.3, 0.35);
      else if (kind == 6) { surf = vec3(0.25, 0.0, 0.6); emis = vec3(0.1, 0.3, 1.0) * aSiren * blink * 4.0; }
      else if (kind == 7) { surf = vec3(0.25, 0.0, 0.6); emis = vec3(1.0, 0.08, 0.05) * aSiren * (1.0 - blink) * 4.0; }
      vCarColor = mix(col, vec3(0.012, 0.011, 0.01), charred);
      vCarEmissive = emis * (1.0 - charred);
      vCarSurf = mix(surf, vec3(0.95, 0.0, 0.03), charred);
      vCarWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
      vCarNormal = normalize(mat3(modelMatrix * instanceMatrix) * objectNormal);`,
    );
    shader.fragmentShader = after(
      shader.fragmentShader,
      '#include <common>',
      `varying vec3 vCarColor;
      varying vec3 vCarEmissive;
      varying vec3 vCarSurf;
      varying vec3 vCarWorld;
      varying vec3 vCarNormal;
      ${UB_COMMON}
      ${UB_STREET_LIGHT}`,
    );
    shader.fragmentShader = replace(shader.fragmentShader, '#include <color_fragment>', 'diffuseColor.rgb = vCarColor;');
    shader.fragmentShader = after(shader.fragmentShader, '#include <roughnessmap_fragment>', 'roughnessFactor = vCarSurf.x;');
    shader.fragmentShader = after(shader.fragmentShader, '#include <metalnessmap_fragment>', 'metalnessFactor = vCarSurf.y;');
    shader.fragmentShader = after(
      shader.fragmentShader,
      '#include <emissivemap_fragment>',
      'totalEmissiveRadiance = vCarEmissive + diffuseColor.rgb * ubStreetLight(vCarWorld, normalize(vCarNormal));',
    );
    shader.fragmentShader = after(
      shader.fragmentShader,
      '#include <lights_fragment_maps>',
      'radiance *= vCarSurf.z;\niblIrradiance *= 0.2;',
    );
  };
  mat.customProgramCacheKey = () => 'curbside-cars';
  return mat;
}

/** Visible and in the scene (an ancestor hidden hides it too). */
function isShown(o: Object3D): boolean {
  let p: Object3D | null = o;
  while (p) {
    if (!p.visible) return false;
    if (!p.parent) return (p as { isScene?: boolean }).isScene === true;
    p = p.parent;
  }
  return false;
}

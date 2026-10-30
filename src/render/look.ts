import type { Camera, Object3D, Scene, WebGLRenderer } from 'three';
import type { City, Rect } from '../world/city';
import { createCityMesh, type CityMesh } from '../world/cityMesh';
import { createGround } from '../world/ground';
import type { Pickup } from '../world/pickups';
import type { CameraRig } from './cameraRig';
import { CharacterBodies } from './characterBodies';
import { ContactShadows } from './contactShadows';
import { GLOW, GlowSprites } from './glowSprites';

/** Adds faked lights for one frame (muzzle flashes, beacons, ...); `view` is the visible ground. */
export type GlowSource = (glows: GlowSprites, view: Rect) => void;
import { PickupMesh } from './pickupMesh';
import { PostEffects, mountVignette, precompile } from './post';
import { getQuality, onQualityChange } from './quality';
import { SceneLighting } from './sceneLighting';
import { worldUniforms } from './shaderLib';
import { SunShadow } from './sunShadow';
import { TimeOfDay } from './timeOfDay';
import { CarBatch } from './vehicleBatch';

/** Where the player is, for the marker that keeps them findable. */
export interface PlayerView {
  x: number;
  z: number;
  /** Game heading: facing (sin h, cos h). */
  heading: number;
  driving: boolean;
  /** Ground speed, m/s. */
  speed: number;
  alive: boolean;
}

/** Marker colour (linear): a warm gold that reads on asphalt, paving and grass. */
const MARKER = [1.0, 0.62, 0.08] as const;

/**
 * The world's look in one place: renderer-facing setup (lights, time of
 * day, sun shadows, bloom, vignette), the ground and city meshes, and the
 * batched renderers every person and car is drawn by. main.ts creates it,
 * calls update() each frame and render() to draw.
 *
 * Per-frame draw calls stay low because everything repeated is instanced:
 * all people 1 per body on screen (+1 for the weapons in hand), all cars ~1 per model, all glows 1, all contact shadows 1,
 * the city ~4–5 per visible 256 m chunk.
 */
export class Look {
  readonly time = new TimeOfDay();
  readonly lighting: SceneLighting;
  /** Everyone, by body (one batch each), and what they hold. */
  readonly characters: CharacterBodies;
  readonly cars: CarBatch;
  readonly glows = new GlowSprites();
  readonly contactShadows = new ContactShadows();
  readonly pickups: PickupMesh;
  readonly post: PostEffects;
  private readonly sunShadow: SunShadow;
  private readonly city: CityMesh;
  private readonly view: Rect = { minX: 0, minZ: 0, maxX: 0, maxZ: 0 };
  private dt = 0;
  private player: PlayerView | null = null;
  private warmedUp = false;
  /** Every city chunk's buffers are on the GPU (see uploadCity). */
  private uploaded = false;
  private readonly glowSources: GlowSource[] = [];
  /**
   * Multiplier on the sky's exposure, for flashes (e.g. an explosion kicking
   * it to 1.8 and easing back). The sky sets exposure every frame, so set
   * this rather than renderer.toneMappingExposure.
   */
  exposureBoost = 1;

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly scene: Scene,
    city: City,
    private readonly rig: CameraRig,
    pickups: Pickup[],
    overlayParent: HTMLElement,
  ) {
    this.lighting = new SceneLighting(renderer, scene);
    this.sunShadow = new SunShadow(renderer, this.lighting.sun);
    scene.add(createGround(city));
    this.city = createCityMesh(city);
    scene.add(this.city.root);
    this.characters = new CharacterBodies();
    this.cars = new CarBatch(renderer);
    this.pickups = new PickupMesh(pickups);
    scene.add(...this.characters.meshes, this.cars.root, this.pickups.mesh, this.contactShadows.mesh, this.glows.mesh);
    this.post = new PostEffects(renderer);
    renderer.info.autoReset = false; // reset once per frame in render()
    mountVignette(overlayParent);
    onQualityChange(() => this.applyTier());
    this.applyTier();
    // Lost GPU state is rebuilt by three.js, except what was rendered into a
    // target; programs come back lazily, so warm them all up again too.
    renderer.domElement.addEventListener('webglcontextrestored', () => {
      this.cars.buildEnvironment();
      this.warmedUp = false;
      this.uploaded = false;
    });
    this.update(0, null);
  }

  /** Advance the clock and the sky; `player` places the marker (null hides it). */
  update(dt: number, player: PlayerView | null): void {
    this.dt = dt;
    this.player = player;
    this.time.update(dt);
    worldUniforms.uTime.value += dt;
    const sky = this.lighting.apply(this.time.hour);
    this.renderer.toneMappingExposure *= this.exposureBoost;
    this.sunShadow.setStrength(sky.shadowStrength);
    this.cars.envIntensity = sky.envIntensity;
    this.post.setNight(sky.night);
    this.city.update(sky.night);
  }

  /** Draw a frame: fill the batched renderers for this view, fit the shadows, render. */
  render(camera: Camera): void {
    if (!this.warmedUp) this.warmUp(camera);
    const view = this.rig.visibleGround(this.view);
    this.contactShadows.begin();
    this.glows.begin();
    this.characters.flush(this.contactShadows, view);
    this.cars.flush(view, this.dt, this.contactShadows, this.glows);
    // A redraw without update() (resized while paused) must not read as motion.
    this.dt = 0;
    this.pickups.update(worldUniforms.uTime.value, this.glows, view);
    this.addMarker();
    for (let i = 0; i < this.glowSources.length; i++) this.glowSources[i](this.glows, view);
    this.contactShadows.end();
    this.glows.end();
    this.sunShadow.update(view, this.lighting.toLight);
    if (!this.uploaded) this.uploadCity(camera);
    // Count the whole frame (shadow pass, scene, bloom), not just the last pass.
    this.renderer.info.reset();
    this.renderer.render(this.scene, camera);
  }

  /**
   * Have `source` add faked lights every frame, drawn with all the other
   * glows (no extra draw call). Returns a function that removes it.
   */
  addGlowSource(source: GlowSource): () => void {
    this.glowSources.push(source);
    return () => {
      const i = this.glowSources.indexOf(source);
      if (i >= 0) this.glowSources.splice(i, 1);
    };
  }

  /**
   * Compile every program before play, including the night-only glow meshes
   * that are hidden by day (compile() walks hidden objects too): otherwise
   * the first dusk would stall a frame compiling them mid-drive.
   */
  private warmUp(camera: Camera): void {
    this.warmedUp = true;
    precompile(this.renderer, this.scene, camera);
  }

  /**
   * Draw the whole city once with culling off (night-only meshes too), so
   * every chunk's instanced buffers go up to the GPU now, behind the title
   * or the pause card: renderer.compile builds programs but uploads nothing,
   * so otherwise each chunk uploaded on the first frame it came into view (a
   * small hitch driving fast into a new district, or a Chaos Run's random
   * start). The real render straight after overwrites this one.
   */
  private uploadCity(camera: Camera): void {
    this.uploaded = true;
    const touched: Object3D[] = [];
    const state: boolean[] = [];
    this.city.root.traverse((o) => {
      if (!('isMesh' in o)) return;
      touched.push(o);
      state.push(o.frustumCulled, o.visible);
      o.frustumCulled = false;
      o.visible = true;
    });
    this.renderer.render(this.scene, camera);
    for (let i = 0; i < touched.length; i++) {
      touched[i].frustumCulled = state[i * 2];
      touched[i].visible = state[i * 2 + 1];
    }
  }

  /** On foot: a pulsing ring and a heading chevron; driving: a ring round the car that dims at speed, and a chevron ahead. */
  private addMarker(): void {
    const p = this.player;
    if (!p || !p.alive) return;
    const t = worldUniforms.uTime.value;
    const pulse = 0.5 + 0.5 * Math.sin(t * 4);
    const [r, g, b] = MARKER;
    if (!p.driving) {
      const k = 0.55 + 0.35 * pulse;
      const size = 1.7 + 0.25 * pulse;
      this.glows.addFlat(p.x, 0.05, p.z, 0, size, size, r * k, g * k, b * k, GLOW.ring);
      const fx = Math.sin(p.heading);
      const fz = Math.cos(p.heading);
      this.glows.addFlat(p.x + fx * 1.25, 0.06, p.z + fz * 1.25, p.heading, 0.7, 0.55, r * 0.9, g * 0.9, b * 0.9, GLOW.chevron);
    } else {
      // The ring fades as the car picks up speed, but not out: among
      // same-coloured traffic you'd lose your own car. At speed a chevron
      // just ahead of the bumper takes over (both in the glow batch: free).
      const fast = Math.min(1, Math.max(0, (p.speed - 4) / 10));
      const k = (0.35 + 0.2 * pulse) * Math.max(0.3, 1 - fast);
      this.glows.addFlat(p.x, 0.05, p.z, p.heading, 6.4, 6.4, r * k, g * k, b * k, GLOW.ring);
      if (fast > 0.05) {
        const kc = 0.8 * fast;
        const ahead = 3.4;
        this.glows.addFlat(p.x + Math.sin(p.heading) * ahead, 0.06, p.z + Math.cos(p.heading) * ahead, p.heading, 1.5, 1.1, r * kc, g * kc, b * kc, GLOW.chevron);
      }
    }
  }

  private applyTier(): void {
    // Without a shadow map the contact shadows do all the grounding.
    this.contactShadows.strength = getQuality().shadowMapSize > 0 ? 1 : 1.35;
  }
}

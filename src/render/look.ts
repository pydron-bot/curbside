import type { Camera, Scene, WebGLRenderer } from 'three';
import type { City, Rect } from '../world/city';
import { createCityMesh, type CityMesh } from '../world/cityMesh';
import { createGround } from '../world/ground';
import type { Pickup } from '../world/pickups';
import type { CameraRig } from './cameraRig';
import { CharacterBatch } from './characterModel';
import { ContactShadows } from './contactShadows';
import { GLOW, GlowSprites } from './glowSprites';
import { PickupMesh } from './pickupMesh';
import { PostEffects, mountVignette } from './post';
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
 * all people 1, all cars ~1 per model, all glows 1, all contact shadows 1,
 * the city ~4–5 per visible 256 m chunk.
 */
export class Look {
  readonly time = new TimeOfDay();
  readonly lighting: SceneLighting;
  readonly characters: CharacterBatch;
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
    this.characters = new CharacterBatch('/assets/player.glb');
    this.cars = new CarBatch(renderer);
    this.pickups = new PickupMesh(pickups);
    scene.add(this.characters.mesh, this.cars.root, this.pickups.mesh, this.contactShadows.mesh, this.glows.mesh);
    this.post = new PostEffects(renderer);
    mountVignette(overlayParent);
    onQualityChange(() => this.applyTier());
    this.applyTier();
    // Lost GPU state is rebuilt by three.js, except what was rendered into a target.
    renderer.domElement.addEventListener('webglcontextrestored', () => this.cars.buildEnvironment());
    this.update(0, null);
  }

  /** Advance the clock and the sky; `player` places the marker (null hides it). */
  update(dt: number, player: PlayerView | null): void {
    this.dt = dt;
    this.player = player;
    this.time.update(dt);
    worldUniforms.uTime.value += dt;
    const sky = this.lighting.apply(this.time.hour);
    this.sunShadow.setStrength(sky.shadowStrength);
    this.cars.envIntensity = sky.envIntensity;
    this.city.update(sky.night);
  }

  /** Draw a frame: fill the batched renderers for this view, fit the shadows, render. */
  render(camera: Camera): void {
    const view = this.rig.visibleGround(this.view);
    this.contactShadows.begin();
    this.glows.begin();
    this.characters.flush(this.contactShadows);
    this.cars.flush(view, this.dt, this.contactShadows, this.glows);
    this.pickups.update(worldUniforms.uTime.value, this.glows, view);
    this.addMarker();
    this.contactShadows.end();
    this.glows.end();
    this.sunShadow.update(view, this.lighting.toLight);
    this.renderer.render(this.scene, camera);
  }

  /** On foot: a pulsing ring and a heading chevron; driving: a ring round the car that fades at speed. */
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
      const fade = 1 - Math.min(1, Math.max(0, (p.speed - 4) / 10));
      if (fade <= 0.01) return;
      const k = (0.35 + 0.2 * pulse) * fade;
      this.glows.addFlat(p.x, 0.05, p.z, p.heading, 6.4, 6.4, r * k, g * k, b * k, GLOW.ring);
    }
  }

  private applyTier(): void {
    // Without a shadow map the contact shadows do all the grounding.
    this.contactShadows.strength = getQuality().shadowMapSize > 0 ? 1 : 1.35;
  }
}

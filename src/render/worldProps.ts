import type { Object3D } from 'three';
import type { BuildingPlan, RoofProp } from '../world/buildingPlans';
import { LANDMARK_KNOCK_ID } from '../world/dressing';
import { signalAt } from '../world/signals';
import type { Rect } from '../world/city';
import type { Landmarks } from '../world/landmarkProps';
import type { StreetProps } from '../world/streetProps';
import { GLOW, type GlowSprites } from './glowSprites';
import { PropBatch, propUniforms } from './propBatch';
import { PropModels } from './propModels';
import { worldUniforms } from './shaderLib';

/** The rooftop kit's models by plan kind (chimneys and solar panels stay boxes in the city mesh). */
const ROOF_MODEL: Partial<Record<RoofProp['kind'], string>> = {
  ac: 'ac_unit',
  vent: 'vent',
  tank: 'water_tank',
  dish: 'satellite_dish',
  antenna: 'antenna',
  housing: 'rooftop_door',
};


/** A booth or garage roof opens while the player is this close to its middle, m. */
const ROOF_CUT_RADIUS = 7.5;
/** ...and the signs on it above this height go with it, m. */
const ROOF_SIGN_HEIGHT = 4.4;
/** The landmarks with a roof to open. */
const ROOFED = new Set(['spray_booth', 'export_bay']);

/** Lens heights on the traffic_light model (red, amber, green), m. */
const LENS_Y = [3.85, 3.55, 3.25] as const;
/** Lens colours (linear) for the glow beside each lit lens. */
const LENS_RGB = [
  [1.0, 0.08, 0.04],
  [1.0, 0.5, 0.04],
  [0.1, 1.0, 0.35],
] as const;

/** Something with a clock for the traffic lights (world/signals.ts TrafficSignals). */
export interface SignalClock {
  readonly time: number;
}

/**
 * Every props.glb model in the world, drawn as six instanced families
 * (PropBatch): street lamps; street furniture and traffic lights; rooftop
 * kit; trees; landmarks (spray booths, the export garage, the station sign,
 * the safehouse door, payphones, race gantries, ramps); and `things`, the
 * small models that move or come and go each frame (pickup crates, hidden
 * packages, frenzy gems, roadblock barriers and cones), which other
 * presenters add through `things` every frame; and blown-up cars' parts
 * (debris.glb, written by the fx debris). Each family is one draw call
 * (plus one in the shadow pass) while any of it is in view, so the whole
 * street scene adds about a dozen calls whatever is on screen, and the
 * city's per-chunk stand-ins for lamps, rooftop boxes and trees go away.
 *
 * Until pickups.glb / props.glb arrive (or if they fail) nothing here draws
 * and the stand-ins stay: `loaded` tells the presenters which to use.
 */
export class WorldProps {
  readonly lamps = new PropBatch('lamps', ['streetlamp'], 700);
  readonly street = new PropBatch(
    'street',
    ['traffic_light', 'hydrant', 'bench', 'trash_bin', 'bollard', 'newspaper_box', 'mailbox', 'dumpster', 'payphone', 'road_barrier_long', 'traffic_cone'],
    900,
  );
  readonly roofs = new PropBatch('roofs', ['ac_unit', 'vent', 'water_tank', 'satellite_dish', 'rooftop_door', 'antenna'], 1400);
  readonly trees = new PropBatch('trees', ['tree_round', 'tree_tall', 'palm'], 400, { receiveShadows: false });
  readonly landmarks = new PropBatch('landmarks', ['spray_booth', 'export_bay', 'police_sign', 'safehouse_door', 'start_gantry', 'ramp', 'kicker'], 96);
  /** Dynamic: refilled every frame by whoever draws pickups, packages, gems and roadblocks. */
  readonly things = new PropBatch(
    'things',
    [
      'crate_pistol',
      'crate_smg',
      'crate_shotgun',
      'crate_grenade',
      'crate_molotov',
      'crate_rocket',
      'health_kit',
      'armour',
      'ammo_box',
      'package',
      'cash',
      'frenzy_token',
      'barrier',
      'traffic_cone',
      'road_barrier_long',
    ],
    192,
  );
  /** Car parts thrown by explosions (fx debris writes them per frame), tinted with the car's paint; no shadows. */
  readonly debris = new PropBatch('debris', ['door', 'hood', 'bumper', 'wheel', 'panel_a', 'panel_b', 'panel_c'], 96, { shadows: false });
  /** The traffic lights' clock (set by main.ts); the lenses follow it. */
  signals: SignalClock | null = null;
  models: PropModels | null = null;
  private readonly families: PropBatch[];
  private landmarkData: Landmarks | null = null;
  /** Knockable id → [family, handle], once the statics are in. */
  private readonly handles = new Map<number, [PropBatch, number]>();
  private readonly loadedHooks: Array<() => void> = [];
  /** The traffic lights, for their lens glows: x, z, heading, cycle offset, east-west (1/0). */
  private readonly signalData: Float32Array;

  constructor(
    private readonly streetProps: StreetProps,
    private readonly plans: readonly BuildingPlan[],
  ) {
    this.families = [this.lamps, this.street, this.roofs, this.trees, this.landmarks, this.things, this.debris];
    const lights = streetProps.props.filter((p) => p.kind === 'traffic_light');
    this.signalData = new Float32Array(lights.length * 5);
    lights.forEach((p, i) => this.signalData.set([p.x, p.z, p.heading, p.phase, p.eastWest ? 1 : 0], i * 5));
    PropModels.load('/assets/props.glb', '/assets/pickups.glb', '/assets/debris.glb').then(
      (models) => this.useModels(models),
      (err) => console.error('Failed to load props.glb / pickups.glb / debris.glb', err),
    );
  }

  /** The meshes to put in the scene. */
  get objects(): Object3D[] {
    return this.families.map((f) => f.mesh);
  }

  /** props.glb is in and drawing (until then the city's stand-ins show). */
  get loaded(): boolean {
    return this.models !== null;
  }

  /** Run `fn` once the models are in (now, if they already are). */
  onLoaded(fn: () => void): void {
    if (this.loaded) fn();
    else this.loadedHooks.push(fn);
  }

  /** The landmark models (placed when the models arrive, or now if they're in). */
  setLandmarks(l: Landmarks): void {
    this.landmarkData = l;
    if (this.loaded) this.addLandmarks();
  }

  /** A street prop (or a landmark's cone) knocked flying: hide it until restore(). */
  knock(id: number): void {
    const h = this.handles.get(id);
    if (h) h[0].setHidden(h[1], true);
  }

  restore(id: number): void {
    const h = this.handles.get(id);
    if (h) h[0].setHidden(h[1], false);
  }


  /**
   * Start a frame (before anything adds `things`): the static families follow
   * the view; (focusX, focusZ) is the player, whose booth roof opens up.
   */
  begin(view: Rect, focusX = 0, focusZ = 0, focusActive = false): void {
    propUniforms.uSignalTime.value = this.signals?.time ?? 0;
    propUniforms.uFocus.value.set(focusX, focusZ, focusActive ? ROOF_CUT_RADIUS : 0);
    for (const f of this.families) f.begin(view);
  }

  /** Finish the frame (after every presenter has added its things). */
  end(): void {
    for (const f of this.families) f.end();
  }

  /**
   * The lit lens of every traffic light in view, as a coloured glow just in
   * front of it (seen from above the lenses face sideways, so the glow is
   * what reads), and its colour on the road at night. Shared glow batch: free.
   */
  drawGlows(glows: GlowSprites, view: { minX: number; minZ: number; maxX: number; maxZ: number }): void {
    if (!this.loaded) return;
    const time = this.signals?.time ?? 0;
    const night = worldUniforms.uNight.value;
    const d = this.signalData;
    for (let o = 0; o < d.length; o += 5) {
      const x = d[o];
      const z = d[o + 1];
      if (x < view.minX - 4 || x > view.maxX + 4 || z < view.minZ - 4 || z > view.maxZ + 4) continue;
      const light = signalAt(d[o + 4] > 0.5, time + d[o + 3]);
      const k = light === 'red' ? 0 : light === 'amber' ? 1 : 2;
      const [r, g, b] = LENS_RGB[k];
      const fx = Math.sin(d[o + 2]);
      const fz = Math.cos(d[o + 2]);
      const a = 0.9 + 0.6 * night;
      glows.addFlat(x + fx * 0.45, LENS_Y[k], z + fz * 0.45, d[o + 2], 1.1, 1.1, r * a, g * a, b * a, GLOW.disc);
      if (night > 0.05) {
        const w = 0.35 * night;
        glows.addFlat(x + fx * 3.2, 0.06, z + fz * 3.2, d[o + 2], 4.5, 5.5, r * w, g * w, b * w, GLOW.disc);
      }
    }
  }

  private useModels(models: PropModels): void {
    this.models = models;
    for (const f of this.families) f.setModels(models);
    this.addStreet();
    this.addRoofs(models);
    if (this.landmarkData) this.addLandmarks();
    for (const fn of this.loadedHooks) fn();
    this.loadedHooks.length = 0;
  }

  private addStreet(): void {
    this.streetProps.props.forEach((p, i) => {
      const f = p.kind === 'streetlamp' ? this.lamps : p.kind === 'tree_round' || p.kind === 'tree_tall' || p.kind === 'palm' ? this.trees : this.street;
      const h = f.addStatic(p.kind, p.x, 0, p.z, p.heading, p.scale, p.scale, p.scale, p.phase, p.eastWest ? 1 : 0);
      this.handles.set(i, [f, h]);
    });
  }

  private addLandmarks(): void {
    const l = this.landmarkData!;
    this.landmarks.clearStatic();
    l.props.forEach((p, i) => {
      const f = this.landmarks.kindOf(p.kind) >= 0 ? this.landmarks : this.street;
      const h = f.addStatic(p.kind, p.x, p.y, p.z, p.heading, p.sx, p.sy, p.sz, 0, ROOFED.has(p.kind) ? ROOF_SIGN_HEIGHT : 0);
      this.handles.set(LANDMARK_KNOCK_ID + i, [f, h]);
    });
  }

  /**
   * The rooftop kit, fitted to the footprints the building plans gave them:
   * scaled to fill the rect (the stair hut to fit its housing, long side
   * along the long side), the model's own off-centre bounds allowed for.
   */
  private addRoofs(models: PropModels): void {
    for (const plan of this.plans) {
      for (const p of plan.props) {
        const name = ROOF_MODEL[p.kind];
        const d = name ? models.dims(name) : undefined;
        if (!name || !d) continue;
        const mw = d.max.x - d.min.x;
        const md = d.max.z - d.min.z;
        const w = p.maxX - p.minX;
        const depth = p.maxZ - p.minZ;
        let yaw = p.yaw;
        let s: number;
        if (p.kind === 'housing') {
          yaw = w > depth ? Math.PI / 2 : 0;
          const turned = w > depth;
          s = Math.max(0.75, Math.min(1.4, Math.min((turned ? depth : w) / mw, (turned ? w : depth) / md)));
        } else {
          const turned = Math.abs(Math.sin(yaw)) > 0.5;
          s = ((turned ? depth : w) / mw + (turned ? w : depth) / md) / 2;
        }
        // Centre the model's bounds (not its origin) on the footprint.
        const cx = ((d.min.x + d.max.x) / 2) * s;
        const cz = ((d.min.z + d.max.z) / 2) * s;
        const c = Math.cos(yaw);
        const sn = Math.sin(yaw);
        const x = (p.minX + p.maxX) / 2 - (cx * c + cz * sn);
        const z = (p.minZ + p.maxZ) / 2 - (-cx * sn + cz * c);
        this.roofs.addStatic(name, x, p.y0, z, yaw, s, s, s, (x * 0.37 + z * 0.11) % 1);
      }
    }
  }
}

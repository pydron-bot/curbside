import type { Object3D, Vector3 } from 'three';
import { publicUrl } from '../core/paths';
import { BODY_KINDS, bodyUrl, type BodyKind } from '../game/bodies';
import type { Rect } from '../world/city';
import { CharacterBatch, type CharacterModel, type Outfit } from './characterModel';
import type { ContactShadows } from './contactShadows';
import { HeldWeapons } from './heldWeapons';

/** Rows each body's batch starts with (they grow when more are on screen). */
const START_ROWS: Record<BodyKind, number> = {
  player: 16,
  ped_slim: 16,
  ped_stocky: 16,
  ped_coat: 16,
  cop: 16,
  vex: 4,
  tuna: 4,
  pike: 4,
};

/**
 * Everyone in the city, by body: one CharacterBatch per body GLB (one draw
 * call each, plus its shadow pass, and nothing for a body nobody on screen
 * wears), and the weapons in their hands (one more call while anyone holds
 * one). Look flushes it once a frame before rendering.
 */
export class CharacterBodies {
  readonly batches: readonly CharacterBatch[];
  readonly weapons: HeldWeapons;
  private readonly byKind: Record<BodyKind, CharacterBatch>;

  constructor(load = true) {
    const byKind = {} as Record<BodyKind, CharacterBatch>;
    for (const kind of BODY_KINDS) byKind[kind] = new CharacterBatch(load ? bodyUrl(kind) : '', kind, START_ROWS[kind]);
    this.byKind = byKind;
    this.batches = BODY_KINDS.map((k) => byKind[k]);
    this.weapons = new HeldWeapons(load ? publicUrl('assets/weapons.glb') : '');
  }

  /** Everything to add to the scene. */
  get meshes(): Object3D[] {
    return [...this.batches.map((b) => b.mesh), this.weapons.mesh];
  }

  /** A new person wearing `body` (the player's own by default). */
  create(outfit: Outfit = {}, body: BodyKind = 'player'): CharacterModel {
    return this.byKind[body].create(outfit);
  }

  /** Write everyone on screen (`view`: the ground the camera sees) and what they hold; contact shadows too. */
  flush(shadows?: ContactShadows, view?: Rect): void {
    for (const b of this.batches) b.flush(shadows, view);
    this.weapons.flush(this.batches);
  }

  /** Where `model`'s muzzle is, as drawn last frame (false: empty-handed). */
  muzzleOf(model: CharacterModel, out: Vector3): boolean {
    return this.weapons.muzzleOf(model, out);
  }

  /** A shot's muzzle flash at the end of the shooter's barrel (see HeldWeapons.placeShot). */
  placeShot(e: { x: number; z: number; dirX: number; dirZ: number; driveBy?: boolean }, out: { x: number; y: number; z: number }): boolean {
    return this.weapons.placeShot(e, this.batches, out);
  }
}

/**
 * Hidden packages on the screen: small green parcels spinning over a soft
 * glow, picked up by walking (or driving) into them. Each pays, the feed
 * says "PACKAGES 12/40", and every tenth unlocks a perk (packages.ts). With
 * the scanner bought they show on the radar. Also applies the perks that
 * act on each life: starting weapons, the bank bonus, first aid.
 */
import type { GlowSprites } from '../../render/glowSprites';
import type { Arsenal, WeaponKind } from '../../systems/weapons';
import { MARK, groundRing, nearView, type ProgressProps } from '../../render/progressLook';
import type { City, Rect } from '../../world/city';
import type { Mode, ModeCtx } from './context';
import { PACKAGE_COUNT, PACKAGE_PAY, PACKAGE_REACH_CAR, PACKAGE_REACH_FOOT, generatePackages, perkFor, type HiddenPackage } from './packages';

/** First aid (the 40-package perk): health refills this fast after this long unhurt. */
const FIRST_AID_DELAY = 6;
const FIRST_AID_RATE = 5;

export class PackageMode implements Mode {
  readonly packages: HiddenPackage[];
  private readonly found: Set<number>;
  private blipsOn = false;
  private sinceHurt = 0;

  constructor(
    private readonly ctx: ModeCtx,
    city: City,
  ) {
    this.packages = generatePackages(city);
    this.found = new Set(ctx.progress.data.packages);
    const { bus, player } = ctx.deps;
    bus.on('playerHurt', () => (this.sinceHurt = 0));
    // Perks that start every life.
    bus.on('respawn', () => {
      const p = ctx.progress;
      if (p.has('perk-pistol')) topUp(player.arsenal, 'pistol');
      if (p.has('perk-smg')) topUp(player.arsenal, 'smg');
    });
  }

  get count(): number {
    return this.found.size;
  }

  /** Bonus multiplier on banked chains (the 20-package perk). */
  get bankBonus(): number {
    return this.ctx.progress.has('perk-banker') ? 1.25 : 1;
  }

  step(dt: number): void {
    const ctx = this.ctx;
    this.syncBlips();
    if (!ctx.live) return;
    const p = ctx.deps.player;
    if (ctx.progress.has('perk-firstaid')) {
      this.sinceHurt += dt;
      if (this.sinceHurt > FIRST_AID_DELAY && p.health < p.maxHealth) p.health = Math.min(p.maxHealth, p.health + FIRST_AID_RATE * dt);
    }
    if (!ctx.freeRoam) return;
    const at = p.position;
    const reach = p.driving ? PACKAGE_REACH_CAR : PACKAGE_REACH_FOOT;
    for (const pk of this.packages) {
      if (this.found.has(pk.index)) continue;
      if (Math.abs(pk.x - at.x) > reach || Math.abs(pk.z - at.z) > reach) continue;
      if (Math.hypot(pk.x - at.x, pk.z - at.z) > reach) continue;
      this.collect(pk);
    }
  }

  private collect(pk: HiddenPackage): void {
    const ctx = this.ctx;
    this.found.add(pk.index);
    ctx.progress.data.packages.push(pk.index);
    ctx.unblip(blipId(pk));
    const n = this.found.size;
    ctx.pay(PACKAGE_PAY, 'package', `PACKAGES ${n}/${PACKAGE_COUNT}`);
    const perk = perkFor(n);
    if (perk) {
      ctx.progress.unlock(perk[1]);
      ctx.ui.banner(n === PACKAGE_COUNT ? 'ALL PACKAGES!' : `${n} PACKAGES!`, 'gold', perk[2], 3);
      ctx.deps.audio.ui('success');
      if (perk[1] === 'perk-pistol') topUp(ctx.deps.player.arsenal, 'pistol');
      if (perk[1] === 'perk-smg') topUp(ctx.deps.player.arsenal, 'smg');
    }
    ctx.progress.flush();
  }

  hud(): boolean {
    return false;
  }

  prompt(): string | null {
    return null;
  }

  glow(g: GlowSprites, props: ProgressProps, view: Rect, t: number): void {
    if (!this.ctx.freeRoam) return;
    const [r, gr, b] = MARK.package;
    for (const pk of this.packages) {
      if (this.found.has(pk.index) || !nearView(pk.x, pk.z, view)) continue;
      const i = pk.index;
      const pulse = 0.5 + 0.5 * Math.sin(t * 3 + i);
      groundRing(g, pk.x, pk.z, 1.6 + pulse * 0.3, MARK.package, 0.55 + 0.35 * pulse, t);
      props.box(pk.x, 0.65 + Math.sin(t * 2.6 + i) * 0.12, pk.z, 0.55, 0.42, 0.55, t * 2 + i, r * 0.55, gr * 0.85, b * 0.4);
    }
  }

  reset(): void {
    this.sinceHurt = 0;
  }

  /** Scanner: every package not yet found on the radar (free roam only). */
  private syncBlips(): void {
    const want = this.ctx.freeRoam && this.ctx.progress.has('scanner');
    if (want === this.blipsOn) return;
    this.blipsOn = want;
    for (const pk of this.packages) {
      if (want && !this.found.has(pk.index)) this.ctx.blip(blipId(pk), { x: pk.x, z: pk.z, kind: 'pickup', colour: '#6dff5a', icon: '?', size: 4.5 });
      else this.ctx.unblip(blipId(pk));
    }
  }
}

const blipId = (pk: HiddenPackage) => `pkg-${pk.index}`;

/** Make sure a life starts with at least a pickup's worth of ammo for `kind`. */
function topUp(arsenal: Arsenal, kind: WeaponKind): void {
  if ((arsenal.ammo.get(kind) ?? 0) <= 0) arsenal.pickUp(kind);
}

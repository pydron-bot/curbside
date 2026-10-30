import './feel.css';
import { ICONS } from './icons';

/**
 * Small HUD additions for combat and driving, added into the main HUD's DOM
 * (hud.ts) rather than changing its layout: body armour as a cyan strip
 * over the health bar, and a nitro gauge beside the speedometer. Writes to
 * the DOM only what changed.
 */
export class CombatHud {
  private readonly armour: HTMLElement;
  private readonly nitro: HTMLElement;
  private readonly nitroFill: HTMLElement;
  private shownArmour = -1;
  private shownNitro = -1;
  private shownNitroState = '';

  constructor(hudRoot: ParentNode) {
    const hpBar = hudRoot.querySelector('.hp-bar');
    const speedo = hudRoot.querySelector('.speedo');
    this.armour = document.createElement('i');
    this.armour.className = 'hp-armour';
    this.armour.hidden = true;
    // Under the segment gaps, so the strip reads as part of the bar.
    hpBar?.insertBefore(this.armour, hpBar.querySelector('.hp-gaps'));
    this.nitro = document.createElement('div');
    this.nitro.className = 'nitro';
    this.nitroFill = document.createElement('i');
    this.nitro.append(this.nitroFill);
    const icon = document.createElement('span');
    icon.className = 'nitro-icon';
    icon.innerHTML = ICONS.nitro;
    speedo?.append(this.nitro, icon);
  }

  /** Per frame: armour 0..100, nitro tank 0..1, whether it's burning, whether it can be lit. */
  update(armour: number, nitro: number, boosting: boolean, ready: boolean): void {
    const a = Math.ceil(armour);
    if (a !== this.shownArmour) {
      this.shownArmour = a;
      this.armour.hidden = a <= 0;
      this.armour.style.transform = `scaleX(${a / 100})`;
    }
    const n = Math.round(nitro * 100);
    if (n !== this.shownNitro) {
      this.shownNitro = n;
      this.nitroFill.style.transform = `scaleY(${n / 100})`;
    }
    const state = boosting ? 'boosting' : ready ? 'ready' : '';
    if (state !== this.shownNitroState) {
      this.nitro.classList.toggle('boosting', boosting);
      this.nitro.classList.toggle('ready', ready && !boosting);
      this.shownNitroState = state;
    }
  }
}

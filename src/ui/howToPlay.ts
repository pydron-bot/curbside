import type { GameAudio } from '../audio/gameAudio';
import type { InputDevice } from '../core/input';
import { settings, type Settings } from '../core/settings';
import { ICONS } from './icons';
import { MenuNav, overlay, type Panel } from './menu';

type Binding = readonly [action: string, keys: string];

/**
 * Touch rows follow the settings: which thumb does what (left-handed) and
 * what the stick does in a car (directional vs classic steering).
 */
function touchRows(s: Settings): Binding[] {
  const [stick, other] = s.leftHanded ? ['Right', 'Left'] : ['Left', 'Right'];
  return [
    ['Walk / run', `${stick} thumb anywhere — push further to run`],
    s.steering === 'directional'
      ? ['Drive', 'Point the stick where to go; push further for more gas']
      : ['Steer', 'Stick left / right; GAS to go'],
    ['Gas · brake · handbrake', `${other} thumb — slide between pedals`],
    ['Drift', 'The DRIFT band presses gas + handbrake; stopped, it\'s a burnout'],
    ['Nitro', 'Hold NOS (fills as you drift, near-miss and jump)'],
    ['Aim & shoot', `${other} thumb anywhere: drag to aim, push far to fire, tap to fire`],
    ['Punch / fire', 'The big button (punches combo: jab, jab, hook)'],
    ['Drive-by', 'The car FIRE button (pistol or SMG)'],
    ['Switch weapon', '[[⇄]]'],
    ['Get in / out', 'The door button (it pulses next to a car)'],
    ['Pause', '[[❚❚]] top centre'],
  ];
}

/** `[[Space]]` renders as a key cap; the rest is plain text. */
const CONTROLS: Record<Exclude<InputDevice, 'touch'>, { title: string; rows: readonly Binding[] }> = {
  keyboard: {
    title: 'KEYBOARD & MOUSE',
    rows: [
      ['Walk / steer', '[[W]][[A]][[S]][[D]] or arrows'],
      ['Sprint', '[[Shift]]'],
      ['Gas / brake', '[[W]] / [[S]]'],
      ['Handbrake (drift)', '[[Space]] — with [[W]] from a stop, a burnout'],
      ['Nitro', '[[Shift]] in a car'],
      ['Aim', 'Mouse (grenades land at the cursor)'],
      ['Punch / fire', 'Left click, [[Space]] or [[J]] — hold for SMG'],
      ['Drive-by', 'Left click or [[J]] in a car'],
      ['Switch weapon', 'Wheel, right click, [[Q]] / [[Tab]]'],
      ['Get in / out', '[[E]]'],
      ['Radio station', '[[R]]'],
      ['Pause', '[[P]] / [[Esc]]'],
    ],
  },
  gamepad: {
    title: 'CONTROLLER',
    rows: [
      ['Walk / steer', 'Left stick'],
      ['Aim', 'Right stick'],
      ['Gas / brake', '[[RT]] / [[LT]]'],
      ['Handbrake · sprint', '[[A]]'],
      ['Nitro', '[[B]] in a car'],
      ['Fire / punch', '[[RT]] on foot, or [[X]] (drive-bys too)'],
      ['Switch weapon', '[[LB]] / [[RB]]'],
      ['Get in / out', '[[Y]]'],
      ['Pause', '[[Start]]'],
    ],
  },
};

const TIPS = [
  ['Chain it', 'Anything within 3 s of the last stunt builds a combo, up to ×10.'],
  ['Score', 'Drifts, near misses, smashes, hit & runs, knockouts, carjacks, explosions and ramp jumps.'],
  ['Survive', 'Grab health and armour crates. Get WASTED and the run is over — your best is kept.'],
] as const;

/**
 * How to play: the controls for each device (tabs, opening on the one in
 * use) and how scoring works.
 */
export class HowToPlay implements Panel {
  readonly root: HTMLElement;
  readonly nav: MenuNav;
  private readonly tabs = new Map<InputDevice, HTMLButtonElement>();
  private readonly table: HTMLElement;
  private device: InputDevice = 'keyboard';
  private onClose: () => void = () => {};

  constructor(
    parent: HTMLElement,
    private readonly audio: GameAudio,
  ) {
    const { root, card } = overlay('howto', 'ui-sheet');
    this.root = root;
    this.nav = new MenuNav(root);
    card.innerHTML = `
      <header class="sheet-head"><h2>HOW TO PLAY</h2><div class="tabs"></div></header>
      <div class="sheet-body howto" data-scroll>
        <div class="howto-controls"></div>
        <div class="howto-tips"></div>
      </div>`;
    const head = card.querySelector('.sheet-head')!;
    const tabs = card.querySelector('.tabs')!;
    for (const d of ['touch', 'keyboard', 'gamepad'] as const) {
      const b = document.createElement('button');
      b.type = 'button';
      b.tabIndex = -1;
      b.className = 'tab';
      b.textContent = d === 'touch' ? 'Touch' : d === 'keyboard' ? 'Keyboard' : 'Controller';
      tabs.append(b);
      this.tabs.set(d, b);
      this.nav.add({ el: b, activate: () => this.show(d) });
    }
    const close = document.createElement('button');
    close.type = 'button';
    close.tabIndex = -1;
    close.className = 'sheet-close';
    close.setAttribute('aria-label', 'Close');
    close.innerHTML = ICONS.close;
    head.append(close);
    this.nav.add({ el: close, activate: () => this.back() });
    this.table = card.querySelector('.howto-controls')!;
    const tips = card.querySelector('.howto-tips')!;
    for (const [title, text] of TIPS) {
      const t = document.createElement('div');
      t.className = 'tip';
      t.innerHTML = '<b></b><span></span>';
      t.querySelector('b')!.textContent = title;
      t.querySelector('span')!.textContent = text;
      tips.append(t);
    }
    parent.append(root);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(device: InputDevice, onClose: () => void, showFocus: boolean): void {
    this.onClose = onClose;
    this.show(device);
    this.root.hidden = false;
    this.nav.focusElement(this.tabs.get(device)!);
    this.nav.showFocus(showFocus);
  }

  back(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.audio.ui('back');
    this.onClose();
  }

  private show(device: InputDevice): void {
    if (device !== this.device) this.audio.ui('click');
    this.device = device;
    for (const [d, b] of this.tabs) b.classList.toggle('selected', d === device);
    this.table.textContent = '';
    for (const [action, keys] of device === 'touch' ? touchRows(settings) : CONTROLS[device].rows) {
      const row = document.createElement('div');
      row.className = 'howto-row';
      const a = document.createElement('span');
      a.textContent = action;
      const k = document.createElement('span');
      k.className = 'howto-keys';
      // Split "[[W]] or arrows" into key caps and text, without innerHTML.
      for (const part of keys.split(/(\[\[.+?\]\])/)) {
        if (!part) continue;
        const m = /^\[\[(.+)\]\]$/.exec(part);
        if (m) {
          const kbd = document.createElement('kbd');
          kbd.textContent = m[1];
          k.append(kbd);
        } else k.append(part);
      }
      row.append(a, k);
      this.table.append(row);
    }
  }
}

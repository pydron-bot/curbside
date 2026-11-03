import type { GameAudio } from '../audio/gameAudio';
import { onSettingsChange, settings } from '../core/settings';
import { CAR_NAMES } from '../game/modes/exports';
import { ARCHETYPES, SCENES, SLOW_MO, TIME_PRESETS, type RainMode, type TestTools } from '../game/testTools';
import type { City } from '../world/city';
import type { FrontDoor } from './frontDoor';
import { ICONS } from './icons';
import { MenuNav, overlay, type Panel } from './menu';
import { TeleportMap } from './teleportMap';
import './testMenu.css';

type Tab = 'player' | 'cars' | 'world' | 'map' | 'scenes' | 'save';
const TABS: ReadonlyArray<readonly [Tab, string]> = [
  ['player', 'PLAYER'],
  ['cars', 'CARS'],
  ['world', 'WORLD'],
  ['map', 'MAP'],
  ['scenes', 'SCENES'],
  ['save', 'SAVE'],
];

/** A destructive button's first press arms it for this long, ms. */
const CONFIRM_MS = 3000;
/** The notice strip shows this long, ms. */
const NOTICE_MS = 2600;

export interface TestMenuHooks {
  /** Close every menu and play on. */
  resume(): void;
  /** The city map, to tap a teleport (over this sheet). */
  openMap(): void;
  /** What an action did, in the HUD feed too (it shows once play resumes). */
  notice(text: string): void;
  /** The map editor (desktop only), when the game has one. */
  openEditor?(): void;
}

/**
 * The TEST sheet (pause menu, with Settings → Test tools on): tabs of big
 * buttons for playtesting on a phone. Every button acts at once and says
 * what it did in a strip at the foot of the card (and the HUD feed); the
 * destructive save tools take a second press. Keyboard / pad navigable
 * (MenuNav); Back closes it to the pause menu; ▶ resumes play.
 */
export class TestMenu implements Panel {
  readonly root: HTMLElement;
  readonly nav: MenuNav;
  readonly sheet = true;
  private readonly body: HTMLElement;
  private readonly tabs = new Map<Tab, HTMLButtonElement>();
  private readonly panes = new Map<string, HTMLElement>();
  private readonly toast: HTMLElement;
  private readonly refreshers: Array<() => void> = [];
  private readonly jobList: HTMLElement;
  private readonly paste: HTMLTextAreaElement;
  private tab: Tab = 'player';
  private armed: HTMLButtonElement | null = null;
  private armTimer = 0;
  private toastTimer = 0;
  private onClose: () => void = () => {};

  constructor(
    parent: HTMLElement,
    private readonly audio: GameAudio,
    private readonly tools: TestTools,
    private readonly hooks: TestMenuHooks,
  ) {
    const { root, card } = overlay('testmenu', 'ui-sheet test-sheet');
    this.root = root;
    this.nav = new MenuNav(root);
    card.innerHTML = `
      <header class="sheet-head"><h2>TEST</h2><div class="tabs"></div></header>
      <div class="sheet-body test-body" data-scroll></div>
      <div class="test-toast" hidden></div>`;
    const head = card.querySelector('.sheet-head')!;
    const tabs = card.querySelector('.tabs')!;
    this.body = card.querySelector('.test-body')!;
    this.toast = card.querySelector('.test-toast')!;
    for (const [id, label] of TABS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.tabIndex = -1;
      b.className = 'tab';
      b.textContent = label;
      tabs.append(b);
      this.tabs.set(id, b);
      this.nav.add({ el: b, activate: () => this.show(id) });
    }
    const play = this.headButton('Resume', ICONS.play, 'test-play');
    const close = this.headButton('Close', ICONS.close, 'sheet-close');
    head.append(play, close);
    this.nav.add({ el: play, activate: () => hooks.resume() });
    this.nav.add({ el: close, activate: () => this.back() });

    this.buildPlayer();
    this.buildCars();
    this.buildWorld();
    this.buildMap();
    this.buildScenes();
    const save = this.pane('save');
    this.jobList = this.pane('jobs');
    const imp = this.pane('import');
    this.buildSave(save);
    this.paste = this.buildImport(imp);

    tools.onChange = () => this.refresh();
    parent.append(root);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(onClose: () => void, showFocus: boolean): void {
    this.onClose = onClose;
    this.root.hidden = false;
    this.show(this.tab, true);
    this.nav.focusElement(this.tabs.get(this.tab)!);
    this.nav.showFocus(showFocus);
  }

  /** The stack under it is closing (resumed from the pause menu). */
  hide(): void {
    this.root.hidden = true;
    this.disarm();
  }

  back(): void {
    if (this.root.hidden) return;
    // Out of a sub-list first (a job pick, the import box).
    if (this.panes.get('jobs')!.hidden === false || this.panes.get('import')!.hidden === false) {
      this.show('save');
      return;
    }
    this.hide();
    this.audio.ui('back');
    this.onClose();
  }

  /** Say what an action did (also used by the map). */
  say(text: string): void {
    this.hooks.notice(text);
    this.toast.textContent = text;
    this.toast.hidden = false;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.toast.hidden = true), NOTICE_MS);
  }

  private show(tab: Tab | 'jobs' | 'import', quiet = false): void {
    if (!quiet) this.audio.ui('click');
    this.disarm();
    const main: Tab = tab === 'jobs' || tab === 'import' ? 'save' : tab;
    this.tab = main;
    for (const [id, b] of this.tabs) b.classList.toggle('selected', id === main);
    for (const [id, p] of this.panes) p.hidden = id !== tab;
    if (tab === 'jobs') this.fillJobs();
    this.refresh();
    this.body.scrollTop = 0;
  }

  private refresh(): void {
    for (const fn of this.refreshers) fn();
  }

  // --- Building blocks ---

  private headButton(label: string, svg: string, className: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.tabIndex = -1;
    b.className = className;
    b.setAttribute('aria-label', label);
    b.innerHTML = svg;
    return b;
  }

  private pane(id: string): HTMLElement {
    const p = document.createElement('div');
    p.className = 'test-pane';
    p.hidden = true;
    this.body.append(p);
    this.panes.set(id, p);
    return p;
  }

  private section(pane: HTMLElement, title: string, className = ''): HTMLElement {
    const s = document.createElement('section');
    s.className = 'test-sec';
    s.innerHTML = '<h3></h3><div class="test-grid"></div>';
    s.querySelector('h3')!.textContent = title;
    const grid = s.querySelector<HTMLElement>('.test-grid')!;
    if (className) grid.classList.add(className);
    pane.append(s);
    return grid;
  }

  /**
   * A button that runs `act` and shows what it says. `confirm`: the first
   * press only arms it (destructive save tools). `state`: refreshed text
   * under the label and whether it's lit.
   */
  private button(
    grid: HTMLElement,
    label: string,
    act: () => string | void,
    opts: { sub?: string; confirm?: boolean; state?: () => { on: boolean; sub?: string }; className?: string } = {},
  ): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.tabIndex = -1;
    b.className = `test-btn${opts.confirm ? ' risky' : ''}${opts.className ? ` ${opts.className}` : ''}`;
    b.innerHTML = '<b></b><small></small>';
    const name = b.querySelector('b')!;
    const sub = b.querySelector('small')!;
    name.textContent = label;
    sub.textContent = opts.sub ?? '';
    b.dataset.label = label;
    b.dataset.sub = opts.sub ?? '';
    grid.append(b);
    this.nav.add({
      el: b,
      activate: () => {
        if (opts.confirm && this.armed !== b) {
          this.arm(b);
          return;
        }
        this.disarm();
        this.audio.ui('confirm');
        const said = act();
        if (said) this.say(said);
        this.refresh();
      },
    });
    if (opts.state) {
      const state = opts.state;
      this.refreshers.push(() => {
        const s = state();
        b.classList.toggle('on', s.on);
        if (s.sub !== undefined && this.armed !== b) sub.textContent = s.sub;
      });
    }
    return b;
  }

  private arm(b: HTMLButtonElement): void {
    this.disarm();
    this.armed = b;
    b.classList.add('armed');
    b.querySelector('small')!.textContent = 'PRESS AGAIN TO CONFIRM';
    this.audio.ui('click');
    this.armTimer = window.setTimeout(() => this.disarm(), CONFIRM_MS);
  }

  private disarm(): void {
    window.clearTimeout(this.armTimer);
    const b = this.armed;
    if (!b) return;
    this.armed = null;
    b.classList.remove('armed');
    b.querySelector('small')!.textContent = b.dataset.sub ?? '';
    this.refresh();
  }

  // --- Tabs ---

  private buildPlayer(): void {
    const t = this.tools;
    const pane = this.pane('player');
    const g = this.section(pane, 'PLAYER');
    this.button(g, 'GOD MODE', () => t.god(), {
      state: () => ({ on: settings.godMode, sub: settings.godMode ? "ON · CAN'T DIE OR BE BUSTED" : 'OFF' }),
    });
    this.button(g, 'HEAL', () => t.heal(), { sub: 'FULL HEALTH AND ARMOUR' });
    this.button(g, 'ALL WEAPONS', () => t.weapons(), { sub: 'EVERY GUN, FULL AMMO' });
    const w = this.section(pane, 'WANTED', 'test-row7');
    for (let s = 0; s <= 5; s++) this.button(w, s === 0 ? '0' : `${s}★`, () => t.wanted(s), { className: 'small' });
    this.button(w, 'CLEAR', () => t.clearWanted(), { className: 'small' });
    const note = document.createElement('p');
    note.className = 'test-note';
    note.textContent = 'Anything here (but LABELS and EXPORT) marks the life: no CRED, bests or medals. TEST shows by the heart.';
    pane.append(note);
  }

  private buildCars(): void {
    const t = this.tools;
    const pane = this.pane('cars');
    const g = this.section(pane, 'YOUR CAR');
    this.button(
      g,
      'GET IN',
      () => {
        t.getIn = !t.getIn;
        return t.getIn ? 'SPAWNED CARS: YOU GET IN' : 'SPAWNED CARS: LEFT BESIDE YOU';
      },
      { state: () => ({ on: t.getIn, sub: t.getIn ? 'ON · SPAWN AND DRIVE' : 'OFF · SPAWN BESIDE YOU' }) },
    );
    this.button(g, 'REPAIR', () => t.repairCar(), { sub: 'THE CAR YOU ARE IN' });
    this.button(g, 'FLIP / UNSTICK', () => t.unstick(), { sub: 'ONTO THE NEAREST LANE' });
    const s = this.section(pane, 'SPAWN', 'test-grid4');
    for (const a of ARCHETYPES) this.button(s, CAR_NAMES[a], () => t.spawn(a), { className: 'small' });
  }

  private buildWorld(): void {
    const t = this.tools;
    const pane = this.pane('world');
    const g = this.section(pane, 'TIME OF DAY', 'test-row6');
    for (const [label, hour] of TIME_PRESETS) this.button(g, label, () => t.setHour(hour, label), { className: 'small' });
    this.button(g, 'FREEZE', () => t.freeze(), { className: 'small', state: () => ({ on: t.frozen, sub: t.frozen ? 'ON' : 'OFF' }) });
    const r = this.section(pane, 'RAIN', 'test-grid3');
    const modes: ReadonlyArray<readonly [RainMode, string]> = [
      ['on', 'ON'],
      ['off', 'OFF'],
      ['auto', 'AUTO'],
    ];
    for (const [m, label] of modes) this.button(r, label, () => t.setRain(m), { className: 'small', state: () => ({ on: t.rain === m }) });
    const s = this.section(pane, 'SLOW MOTION', 'test-grid3');
    for (const k of SLOW_MO) this.button(s, `${k}×`, () => t.slowMo(k), { className: 'small', state: () => ({ on: t.timeScale === k }) });
    const l = this.section(pane, 'OVERLAY');
    this.button(l, 'LABELS', () => t.labels(), { state: () => ({ on: settings.debugLabels, sub: settings.debugLabels ? 'ON' : 'OFF' }) });
  }

  private buildMap(): void {
    const t = this.tools;
    const pane = this.pane('map');
    const g = this.section(pane, 'TELEPORT');
    this.button(g, 'CITY MAP', () => this.hooks.openMap(), { sub: 'TAP A SPOT TO GO THERE', className: 'wide' });
    const q = this.section(pane, 'QUICK', 'test-grid4');
    for (const m of t.landmarks) this.button(q, m.label, () => t.landmark(m.id), { className: 'small' });
    const openEditor = this.hooks.openEditor;
    if (openEditor) {
      // The map editor is a mouse-and-keyboard tool: hidden on touch screens.
      const e = this.section(pane, 'EDIT');
      const b = this.button(e, 'MAP EDITOR', () => openEditor(), { sub: 'BLOCKS, ROADS, SPOTS, PROPS · WHAT RELIES ON THEM', className: 'wide' });
      const sync = () => (e.parentElement!.hidden = b.hidden = !finePointer());
      sync();
      this.refreshers.push(sync);
    }
  }

  private buildScenes(): void {
    const t = this.tools;
    const pane = this.pane('scenes');
    const g = this.section(pane, 'START NEAR YOU', 'test-grid4');
    for (const [id, label] of SCENES) this.button(g, label, () => t.scene(id), { className: 'small' });
  }

  private buildSave(pane: HTMLElement): void {
    const t = this.tools;
    const c = this.section(pane, 'CRED & CASH', 'test-grid4');
    this.button(c, '+1 LEVEL', () => t.credLevel(), { className: 'small', sub: 'A PERK ON DEATH' });
    this.button(c, 'MAX PERKS', () => t.maxPerks(), { className: 'small', confirm: true });
    this.button(c, 'RESET CRED', () => t.resetCred(), { className: 'small', confirm: true });
    this.button(c, '+$10,000', () => t.cash(), { className: 'small' });
    const m = this.section(pane, 'STORY & OPENING', 'test-grid4');
    this.button(m, 'UNLOCK ALL JOBS', () => t.unlockMissions(), { className: 'small', confirm: true });
    this.button(m, 'JUMP TO JOB…', () => this.show('jobs'), { className: 'small' });
    this.button(m, 'OPENING DONE', () => t.opening(true), { className: 'small' });
    this.button(m, 'RESET OPENING', () => t.opening(false), { className: 'small', confirm: true, sub: 'NEXT PLAY' });
    const s = this.section(pane, 'SAVE', 'test-grid4');
    this.button(s, 'EXPORT', () => this.exportSave(), { className: 'small', sub: 'SHARE OR COPY' });
    this.button(s, 'IMPORT…', () => this.show('import'), { className: 'small' });
    this.button(s, 'RESET SAVE', () => t.resetSave(), { className: 'small', confirm: true, sub: 'EVERYTHING · RELOADS' });
  }

  /** The story jobs by arc and chapter: pick one to make it its arc's next job. */
  private fillJobs(): void {
    const pane = this.jobList;
    for (const el of [...pane.querySelectorAll<HTMLElement>('.test-btn')]) this.nav.remove(el);
    pane.textContent = '';
    const back = this.section(pane, 'JUMP TO JOB');
    this.button(back, '‹ BACK', () => this.show('save'), { className: 'small' });
    let group = '';
    let grid = back;
    for (const j of this.tools.jobs) {
      if (j.group !== group) {
        group = j.group;
        grid = this.section(pane, group, 'test-grid3');
      }
      const sub = j.next ? 'NEXT' : j.passed ? 'PASSED' : '';
      this.button(grid, j.title, () => this.tools.jumpTo(j.id), { className: `small${j.next ? ' on' : ''}`, confirm: true, sub });
    }
  }

  private buildImport(pane: HTMLElement): HTMLTextAreaElement {
    const g = this.section(pane, 'IMPORT A SAVE');
    const box = document.createElement('textarea');
    box.className = 'test-paste';
    box.placeholder = 'Paste an exported save here';
    box.spellcheck = false;
    box.autocapitalize = 'off';
    // Typing is text, not game keys (Input listens on window).
    box.addEventListener('keydown', (e) => e.stopPropagation());
    g.append(box);
    const row = this.section(pane, '', 'test-grid3');
    this.button(row, '‹ BACK', () => this.show('save'), { className: 'small' });
    this.button(
      row,
      'PASTE',
      () => {
        void navigator.clipboard
          ?.readText()
          .then((text) => (box.value = text))
          .catch(() => this.say('PASTE INTO THE BOX'));
        if (!navigator.clipboard) return 'PASTE INTO THE BOX';
      },
      { className: 'small', sub: 'FROM THE CLIPBOARD' },
    );
    this.button(row, 'IMPORT', () => this.tools.importText(box.value) ?? 'IMPORTED · RELOADING', { className: 'small', confirm: true, sub: 'REPLACES THE SAVE' });
    return box;
  }

  /** The share sheet where there is one (a phone), else the clipboard, else the box to copy from. */
  private exportSave(): string {
    const text = this.tools.exportText();
    const nav = navigator as Navigator & { share?: (d: { title?: string; text?: string }) => Promise<void> };
    if (nav.share) {
      nav.share({ title: 'Curbside save', text }).catch(() => this.copy(text));
      return 'SAVE EXPORTED';
    }
    this.copy(text);
    return 'SAVE COPIED';
  }

  private copy(text: string): void {
    const fallback = () => {
      this.show('import');
      this.paste.value = text;
      this.paste.select();
      this.say('COPY IT FROM THE BOX');
    };
    if (!navigator.clipboard) {
      fallback();
      return;
    }
    navigator.clipboard.writeText(text).then(() => this.say('SAVE COPIED TO THE CLIPBOARD'), fallback);
  }
}

/** A mouse (not a touch screen): where the map editor is offered. */
function finePointer(): boolean {
  return globalThis.matchMedia?.('(hover: hover) and (pointer: fine)').matches ?? false;
}

/**
 * TEST in the pause menu's corner while Settings → Test tools is on: the
 * TEST sheet, and the teleport map over it. Returns the sheet.
 */
export function mountTestMenu(
  tools: TestTools,
  frontDoor: FrontDoor,
  audio: GameAudio,
  city: City,
  d: { resume(): void; showFocus(): boolean; at(): { x: number; z: number }; notice(text: string): void; openEditor?(): void },
): TestMenu {
  const menu: TestMenu = new TestMenu(document.body, audio, tools, {
    resume: d.resume,
    notice: d.notice,
    openEditor: d.openEditor,
    openMap: () => {
      frontDoor.openPanel(map);
      map.open(() => frontDoor.closePanel(map), d.showFocus());
    },
  });
  // After the sheet, so it draws over it.
  const map: TeleportMap = new TeleportMap(document.body, audio, city, tools.landmarks, {
    at: d.at,
    teleport: (x, z) => tools.teleport(x, z),
    landmark: (id) => tools.landmark(id),
    say: (text) => menu.say(text),
  });
  const button = frontDoor.pause.addCorner('TEST', 'wrench', () => {
    audio.ui('click');
    frontDoor.openPanel(menu);
    menu.open(() => frontDoor.closePanel(menu), d.showFocus());
  });
  const sync = () => (button.hidden = !settings.testTools);
  sync();
  onSettingsChange(sync);
  return menu;
}

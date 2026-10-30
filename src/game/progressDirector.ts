/**
 * Progression, wired to the game: the career (cash, stats, save), banking
 * chains into cash, the bills for getting WASTED or BUSTED, Pay 'n' Spray
 * prices, the safehouse shop, the CHAOS RUN mode and the free-roam
 * activities (frenzies, packages, races, exports, taxi fares, payphone
 * missions), plus their HUD, cards, radar blips and markers.
 *
 * main.ts creates one and calls: step(dt) every sim step, update(dt) every
 * frame, simScale() on the time it feeds the sim (cards freeze the game, the
 * end of a Chaos Run slows it to a stop), holdControls (a race or run's
 * 3-2-1), blocksInput (a card is up), pinned (cars traffic upkeep must
 * keep), payRespray (HeatDeps.pay), restart() and enterTitle().
 */
import type { ColorRepresentation, Scene } from 'three';
import { createVehicleState, type VehicleArchetype } from '../entities/vehicle';
import type { GlowSprites } from '../render/glowSprites';
import { MARK, ProgressProps, beacon, chevrons, groundRing, nearView } from '../render/progressLook';
import { worldUniforms } from '../render/shaderLib';
import type { Panel } from '../ui/menu';
import { ProgressHud } from '../ui/progressHud';
import { DialogueCard, ResultsCard, ShopSheet, StatsSheet, type StatsModel } from '../ui/progressScreens';
import type { BlipOptions } from '../ui/radar';
import { fmt } from '../ui/scoreHud';
import { formatDuration } from './runStats';
import type { Rect } from '../world/city';
import { ChaosRunMode } from './modes/chaosRunMode';
import { CHAOS_RUN_ID } from './modes/chaosRun';
import type { Mode, ModeCtx, ProgressDeps } from './modes/context';
import { ExportMode } from './modes/exportMode';
import { ORDERS_PER_LIST } from './modes/exports';
import { FRENZIES } from './modes/frenzies';
import { FrenzyMode } from './modes/frenzyMode';
import { MissionMode } from './modes/missionMode';
import { PACKAGE_COUNT } from './modes/packages';
import { PackageMode } from './modes/packageMode';
import { SAFEHOUSE } from './modes/places';
import { RaceMode } from './modes/raceMode';
import { RACES, formatRaceTime } from './modes/races';
import { SHOP_ITEMS, TOUGH_SKIN_HEALTH, canBuy, sprayPrice } from './modes/shop';
import { TaxiMode } from './modes/taxiMode';
import { MAX_HEALTH } from './player';
import type { Vehicle } from './population';
import { Progress, bustFine, hospitalBill } from './progress';
import { ChainBank, chainLive } from './progressBank';
import { TAXI_GOAL, completion } from './progressStats';

/** Stand on the safehouse door this long to open the shop, s. */
const SHOP_HOLD = 0.4;
const SHOP_REACH = 1.7;
/** The pause menu offers the shop this close to the safehouse, m. */
const SHOP_NEAR = 45;

export interface DirectorDeps extends ProgressDeps {
  scene: Scene;
  /** Filled with the cars population upkeep must keep (main.ts passes it to maintain()). */
  pinned: Vehicle[];
}

export class ProgressDirector implements ModeCtx {
  readonly deps: ProgressDeps;
  readonly progress: Progress;
  readonly ui: ProgressHud;
  busy: string | null = null;
  holdControls = false;
  /** Cars population upkeep must not recycle (activities' cars). */
  readonly pinned: Vehicle[];
  readonly chaos: ChaosRunMode;
  readonly frenzies: FrenzyMode;
  readonly packages: PackageMode;
  readonly races: RaceMode;
  readonly exports: ExportMode;
  readonly taxi: TaxiMode;
  readonly missions: MissionMode;
  private readonly modes: Mode[];
  private readonly props = new ProgressProps();
  private readonly bank = new ChainBank();
  private readonly results: ResultsCard;
  private readonly dialogue: DialogueCard;
  private readonly shop: ShopSheet;
  private readonly stats: StatsSheet;
  private readonly shopButton: HTMLButtonElement;
  private readonly titleCash: HTMLElement;
  /** Panels freezing the game right now. */
  private readonly modals: Panel[] = [];
  private shopHeld = 0;
  private shopArmed = true;
  private nearShop = false;
  private sprayShown: unknown = null;
  private homeBlip = false;

  constructor(d: DirectorDeps) {
    this.deps = d;
    this.pinned = d.pinned;
    this.progress = new Progress();
    this.progress.track(d.bus, () => this.live);
    this.ui = new ProgressHud(document.body, d.hud.score.el, d.audio);
    this.ui.setCash(this.progress.cash);
    this.progress.onCash((c) => this.ui.setCash(c.total, c.amount));
    this.results = new ResultsCard(document.body);
    this.dialogue = new DialogueCard(document.body, d.audio);
    this.shop = new ShopSheet(document.body, d.audio, SHOP_ITEMS);
    this.stats = new StatsSheet(document.body, d.audio);
    for (const o of this.props.objects) d.scene.add(o);

    this.chaos = new ChaosRunMode(this, this.results);
    this.frenzies = new FrenzyMode(this);
    this.packages = new PackageMode(this, d.city);
    this.races = new RaceMode(this);
    this.exports = new ExportMode(this, d.city);
    this.taxi = new TaxiMode(this);
    this.missions = new MissionMode(this, this.exports.docks, this.dialogue);
    // Card owners first: a running mode claims the activity card before a passive one.
    this.modes = [this.chaos, this.frenzies, this.races, this.missions, this.taxi, this.exports, this.packages];

    // --- Title and pause ---
    d.frontDoor.title.addMode(this.chaosTitleMode());
    this.titleCash = document.createElement('div');
    this.titleCash.className = 'title-cash';
    this.titleCash.innerHTML = 'CASH <b></b>';
    d.frontDoor.title.addInfo(this.titleCash);
    this.refreshTitle();
    d.frontDoor.pause.addButton('PROGRESS', 'chevron', () => this.openStats());
    this.shopButton = d.frontDoor.pause.addButton('SHOP', 'plusSquare', () => this.openShop());
    this.shopButton.hidden = true;

    // --- Banking, bills, perks ---
    d.bus.on('award', (e) => {
      if (this.live) this.bank.add(e.award.points, d.heat.wanted.level);
    });
    d.bus.on('playerDied', () => this.lifeLost(false));
    d.bus.on('busted', () => this.lifeLost(true));
    d.bus.on('respawn', () => this.applyUpgrades());
    d.bus.on('pause', (e) => {
      if (e.paused) this.progress.flush();
      // Resuming over a card: keep the world quiet.
      else if (this.modals.length) d.audio.setPaused(true);
    });
    document.addEventListener('visibilitychange', () => document.hidden && this.progress.flush());
    window.addEventListener('pagehide', () => this.progress.flush());

    d.look.addGlowSource((g, view) => this.glow(g, view));
    this.applyUpgrades();
  }

  // --- ModeCtx ---

  get live(): boolean {
    const p = this.deps.player;
    return this.deps.playing() && p.alive && !p.arrested;
  }

  get freeRoam(): boolean {
    return this.deps.playing() && !this.chaos.active;
  }

  get focusRing(): boolean {
    return this.deps.input.lastDevice !== 'touch';
  }

  pay(amount: number, reason: string, label: string): number {
    const paid = this.progress.earn(amount, reason);
    if (paid > 0) this.notice(`${label} +$${fmt(paid)}`, 'cash');
    return paid;
  }

  notice(text: string, kind = 'progress'): void {
    this.deps.hud.score.notice(text, kind);
  }

  spawnCar(archetype: VehicleArchetype, paint: ColorRepresentation, x: number, z: number, heading: number): Vehicle {
    const v = this.deps.population.takeVehicle(archetype, paint);
    // Lent by the police pool's helper, but it's an ordinary parked car.
    v.police = false;
    v.ai = null;
    Object.assign(v.sim, createVehicleState(x, z, heading));
    Object.assign(v.prev, v.sim);
    this.pinned.push(v);
    return v;
  }

  unpin(v: Vehicle): void {
    const i = this.pinned.indexOf(v);
    if (i >= 0) this.pinned.splice(i, 1);
  }

  board(v: Vehicle): void {
    const { player, rig } = this.deps;
    if (player.driving) player.exit();
    player.ped.x = v.sim.x;
    player.ped.z = v.sim.z;
    player.enter(v);
    rig.snapTo(v.sim.x, v.sim.z);
  }

  openModal(panel: Panel): void {
    if (this.modals.includes(panel)) return;
    this.modals.push(panel);
    this.deps.frontDoor.openPanel(panel);
    this.deps.input.resetActions();
    this.deps.audio.setPaused(true);
  }

  closeModal(panel: Panel): void {
    const i = this.modals.indexOf(panel);
    if (i < 0) return;
    this.modals.splice(i, 1);
    this.deps.frontDoor.closePanel(panel);
    this.deps.input.resetActions();
    if (this.modals.length === 0) this.deps.audio.setPaused(false);
  }

  blip(id: string, opts: BlipOptions): void {
    this.deps.radar.setBlip(id, opts);
  }

  unblip(id: string): void {
    this.deps.radar.removeBlip(id);
  }

  // --- Hooks for main.ts ---

  /** A card is up: gameplay input is ignored (menus get it). */
  get blocksInput(): boolean {
    return this.modals.length > 0;
  }

  /** Multiplier on the time fed to the sim: 0 under a card, easing to 0 as a Chaos Run ends. */
  simScale(): number {
    if (this.modals.length) return 0;
    return this.chaos.simScale();
  }

  /** One sim step. */
  step(dt: number): void {
    if (!this.deps.playing()) return;
    this.progress.step(dt);
    for (const m of this.modes) m.step(dt);
    this.stepBank();
    this.stepShop(dt);
  }

  /** Per frame (real time, not while paused). */
  update(dt: number): void {
    const ui = this.ui;
    ui.update(dt);
    if (!this.deps.playing()) return;
    let claimed = false;
    for (const m of this.modes) if (!claimed && m.hud(dt)) claimed = true;
    if (!claimed) ui.activity(null);
    let prompt: string | null = null;
    if (!this.blocksInput) {
      if (this.nearShop && this.freeRoam && !this.busy) prompt = 'SAFEHOUSE · STAND ON THE DOOR TO SHOP';
      for (let i = 0; i < this.modes.length && prompt === null; i++) prompt = this.modes[i].prompt();
    }
    ui.prompt(prompt);
    this.sprayNotice();
  }

  /** Pay 'n' Spray (HeatDeps.pay): the respray costs cash; broke means no respray. */
  payRespray(baseCost: number): boolean {
    const price = this.progress.has('spraycard') ? sprayPrice(true) : baseCost;
    if (this.progress.spend(price, 'respray')) {
      this.notice(`PAY 'N' SPRAY −$${fmt(price)}`, 'police');
      return true;
    }
    this.ui.banner('NO CASH, NO SPRAY', 'fail', `A RESPRAY COSTS $${fmt(price)}`);
    this.deps.audio.ui('fail');
    return false;
  }

  /** The pause menu's RESTART: a Chaos Run starts over; true if handled here. */
  restart(): boolean {
    if (this.chaos.active) {
      this.chaos.retry();
      return true;
    }
    this.resetAll();
    return false;
  }

  /** Quit to the title: everything stops, the title shows the career. */
  enterTitle(): void {
    this.resetAll();
    this.refreshTitle();
  }

  /** A fresh run from the title (PLAY or a mode): free roam starts clean. */
  startRun(): void {
    this.resetAll();
  }

  // --- Internals ---

  private resetAll(): void {
    for (const m of this.modes) m.reset();
    for (const p of [...this.modals]) {
      p.hide?.();
      this.closeModal(p);
    }
    this.bank.clear();
    this.busy = null;
    this.holdControls = false;
    this.pinned.length = 0;
    this.deps.radar.clearWaypoint();
    this.ui.activity(null);
    this.ui.prompt(null);
    this.ui.clearBanner();
    this.progress.flush();
  }

  /** Bank the chain once the combo runs out. */
  private stepBank(): void {
    if (!this.bank.open || chainLive(this.deps.score)) return;
    const links = this.bank.links;
    const cash = this.bank.close(this.packages.bankBonus);
    if (cash <= 0) return;
    this.progress.earn(cash, 'chain');
    const s = this.progress.stats;
    s.bestChain = Math.max(s.bestChain, cash);
    this.notice(links > 1 ? `BANKED $${fmt(cash)}` : `+$${fmt(cash)}`, 'cash');
  }

  /** WASTED or BUSTED: the open chain is lost, and the bill comes. */
  private lifeLost(busted: boolean): void {
    if (!this.deps.playing()) return;
    const lost = this.bank.lose();
    if (lost > 0) this.notice(`CHAIN LOST · ${fmt(lost)}`, 'lost');
    const cash = this.progress.cash;
    const due = busted ? bustFine(cash) : hospitalBill(cash);
    const taken = this.progress.charge(due, busted ? 'fine' : 'hospital');
    if (taken > 0) this.notice(busted ? `FINE −$${fmt(taken)}` : `HOSPITAL BILL −$${fmt(taken)}`, 'lost');
    this.progress.flush();
  }

  /** Upgrades that shape every life: TOUGH SKIN's extra health. */
  private applyUpgrades(): void {
    const p = this.deps.player;
    const max = MAX_HEALTH + (this.progress.has('armour') ? TOUGH_SKIN_HEALTH : 0);
    if (p.maxHealth !== max) {
      p.maxHealth = max;
      if (p.alive) p.health = Math.max(p.health, max);
    }
  }

  /** The safehouse door: stand on it to shop; the pause menu offers it nearby. */
  private stepShop(dt: number): void {
    if (this.freeRoam !== this.homeBlip) {
      this.homeBlip = this.freeRoam;
      if (this.homeBlip) this.blip('safehouse', { x: SAFEHOUSE.x, z: SAFEHOUSE.z, kind: 'friend', icon: 'H', size: 6 });
      else this.unblip('safehouse');
    }
    const p = this.deps.player;
    const at = p.position;
    const d = Math.hypot(at.x - SAFEHOUSE.x, at.z - SAFEHOUSE.z);
    this.nearShop = d < 8 && !p.driving;
    const offer = this.freeRoam && !this.busy && d < SHOP_NEAR;
    if (offer === this.shopButton.hidden) this.shopButton.hidden = !offer;
    if (d > 4) this.shopArmed = true;
    if (!this.live || !this.freeRoam || this.busy || p.driving || d > SHOP_REACH || !this.shopArmed || Math.hypot(p.ped.vx, p.ped.vz) > 1.5) {
      this.shopHeld = 0;
      return;
    }
    if ((this.shopHeld += dt) < SHOP_HOLD) return;
    this.shopHeld = 0;
    this.shopArmed = false;
    this.openShop(true);
  }

  private openShop(fromStreet = false): void {
    const progress = this.progress;
    const owned = (id: string) => progress.has(id);
    const item = (id: string) => SHOP_ITEMS.find((i) => i.id === id)!;
    if (fromStreet) this.openModal(this.shop);
    else this.deps.frontDoor.openPanel(this.shop);
    this.deps.audio.ui('confirm');
    this.shop.open(
      {
        state: (id) => canBuy(item(id), progress.cash, owned),
        cash: () => progress.cash,
        buy: (id) => {
          const it = item(id);
          if (canBuy(it, progress.cash, owned) !== 'ok' || !progress.spend(it.price, 'shop')) return false;
          if (it.kind === 'upgrade') {
            progress.unlock(it.id);
            this.applyUpgrades();
          } else if (it.weapon) {
            const a = this.deps.player.arsenal;
            a.pickUp(it.weapon);
            a.current = it.weapon;
          }
          progress.flush();
          return true;
        },
      },
      () => (fromStreet ? this.closeModal(this.shop) : this.deps.frontDoor.closePanel(this.shop)),
      this.focusRing,
    );
  }

  private openStats(): void {
    this.deps.frontDoor.openPanel(this.stats);
    this.deps.audio.ui('click');
    this.stats.open(this.statsModel(), () => this.deps.frontDoor.closePanel(this.stats), this.focusRing);
  }

  /** The PROGRESS page's content. */
  statsModel(): StatsModel {
    const p = this.progress;
    const s = p.data;
    const st = s.stats;
    const n = (v: number) => fmt(Math.round(v));
    const done = completion(s, {
      missions: this.missions.missions.length,
      frenzies: FRENZIES.length,
      packages: PACKAGE_COUNT,
      races: RACES.map((r) => r.id),
      exportOrders: ORDERS_PER_LIST,
    });
    const medalRaces = RACES.filter((r) => p.medal(r.id)).length;
    return {
      completion: done,
      cash: p.cash,
      sections: [
        {
          title: 'STORY & ACTIVITIES',
          rows: [
            { label: 'Payphone jobs', value: `${this.missions.passed}/${this.missions.missions.length}`, bar: this.missions.passed / this.missions.missions.length },
            { label: 'Frenzies beaten', value: `${s.frenzies.length}/${FRENZIES.length}`, bar: s.frenzies.length / FRENZIES.length },
            { label: 'Hidden packages', value: `${s.packages.length}/${PACKAGE_COUNT}`, bar: s.packages.length / PACKAGE_COUNT },
            { label: 'Races with a medal', value: `${medalRaces}/${RACES.length}`, bar: medalRaces / RACES.length },
            { label: 'Taxi fares', value: `${st.fares}`, bar: st.fares / TAXI_GOAL },
            { label: 'Cars exported', value: `${st.exportsDelivered}`, bar: s.exports.lists > 0 ? 1 : s.exports.done.length / ORDERS_PER_LIST },
          ],
          chips: this.exports.orders.map((o) => ({ text: o.label, done: o.done })),
        },
        {
          title: 'BEST',
          rows: [
            { label: 'Chaos Run', value: n(p.best(CHAOS_RUN_ID)), medal: p.medal(CHAOS_RUN_ID) },
            { label: 'Free roam run', value: n(Math.max(p.best('free'), this.deps.score.best)) },
            ...RACES.map((r) => ({ label: r.name, value: s.raceTimes[r.id] !== undefined ? formatRaceTime(s.raceTimes[r.id]) : '—', medal: p.medal(r.id) })),
            { label: 'Best taxi streak', value: `${s.taxi.bestStreak}` },
          ],
        },
        {
          title: 'CAREER',
          rows: [
            { label: 'Time played', value: formatDuration(st.playTime) },
            { label: 'Chaos points', value: n(st.chaosPoints) },
            { label: 'Cash earned', value: `$${n(st.cashEarned)}` },
            { label: 'Cash spent', value: `$${n(st.cashSpent)}` },
            { label: 'Biggest banked chain', value: `$${n(st.bestChain)}` },
            { label: 'Best combo', value: `×${st.bestCombo}` },
            { label: 'Knockouts', value: n(st.knockouts) },
            { label: 'Cars wrecked', value: n(st.carsWrecked) },
            { label: 'Carjacks', value: n(st.carjacks) },
            { label: 'Most wanted', value: `${st.maxStars}★` },
            { label: 'Wasted', value: n(st.wasted) },
            { label: 'Busted', value: n(st.busted) },
          ],
        },
      ],
    };
  }

  private chaosTitleMode() {
    const m = this.chaos.titleMode;
    m.sub = this.chaos.titleSub();
    return m;
  }

  /** The title shows the career: cash, and the Chaos Run's best and medal. */
  private refreshTitle(): void {
    const title = this.deps.frontDoor.title;
    title.addMode(this.chaosTitleMode());
    const cash = this.progress.cash;
    this.titleCash.hidden = cash <= 0;
    this.titleCash.querySelector('b')!.textContent = `$${fmt(cash)}`;
  }

  /** Feed line on driving into a Pay 'n' Spray: what it'll cost. */
  private sprayNotice(): void {
    const shop = this.deps.heat.shop;
    if (shop === this.sprayShown) return;
    this.sprayShown = shop;
    if (!shop) return;
    const price = sprayPrice(this.progress.has('spraycard'));
    this.notice(this.progress.cash >= price ? `RESPRAY $${fmt(price)} · STOP TO SPRAY` : `RESPRAY $${fmt(price)} · NOT ENOUGH CASH`, 'police');
  }

  private glow(g: GlowSprites, view: Rect): void {
    const props = this.props;
    props.begin();
    if (this.deps.playing()) {
      const t = worldUniforms.uTime.value;
      const night = worldUniforms.uNight.value;
      for (const m of this.modes) m.glow(g, props, view, t, night);
      if (this.freeRoam && nearView(SAFEHOUSE.x, SAFEHOUSE.z, view)) {
        const k = 0.65 + 0.3 * Math.sin(t * 2.4);
        groundRing(g, SAFEHOUSE.x, SAFEHOUSE.z, 2.6, MARK.safehouse, k, t * 0.4);
        beacon(g, SAFEHOUSE.x, SAFEHOUSE.z, 0.9, 4.5, MARK.safehouse, 0.4 * k);
        // Chevrons pointing in off the street (the door faces the road to the north).
        chevrons(g, SAFEHOUSE.x, SAFEHOUSE.z, 0, MARK.safehouse, k * 0.8, t, 3.5);
      }
    }
    props.end();
  }
}

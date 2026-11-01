/**
 * CRED: what every life earns toward making the next ones a bit easier. A
 * life's points, time, peak wanted level and cash earned turn into CRED when
 * it ends (WASTED or BUSTED); CRED fills levels, and each level is one pick
 * from three perks, drawn on the death screen. Perks are permanent, small and
 * capped (PERK_RANKS each), and scored modes (the Chaos Run, races) run
 * without them (`NEUTRAL`). Pure logic, unit-tested; the progress director
 * keeps the life's numbers and applies the effects, ui/perkCard.ts draws
 * the pick.
 */

export type PerkId = 'tough' | 'vest' | 'bodywork' | 'nitro' | 'slippery' | 'ghost' | 'hustler' | 'banker';

export interface PerkDef {
  id: PerkId;
  /** Which part of play it helps (shown over the name). */
  group: 'SURVIVE' | 'WHEELS' | 'HEAT' | 'MONEY';
  name: string;
  /** What `rank` ranks add up to, as the card says it ("+30 MAX HEALTH"). */
  says(rank: number): string;
}

/** Ranks per perk. */
export const PERK_RANKS = 4;

/** Per rank: max health, starting armour, and the shares the rest change by. */
export const PER_RANK = {
  tough: 15,
  vest: 25,
  bodywork: 0.1,
  nitro: 0.15,
  slippery: 0.15,
  ghost: 0.08,
  hustler: 0.2,
  banker: 0.1,
} as const satisfies Record<PerkId, number>;

const pct = (share: number) => `${Math.round(share * 100)}%`;

export const PERKS: readonly PerkDef[] = [
  { id: 'tough', group: 'SURVIVE', name: 'TOUGH', says: (r) => `+${PER_RANK.tough * r} MAX HEALTH` },
  { id: 'vest', group: 'SURVIVE', name: 'KEVLAR', says: (r) => `START EVERY LIFE WITH ${PER_RANK.vest * r} ARMOUR` },
  { id: 'bodywork', group: 'WHEELS', name: 'BODYWORK', says: (r) => `YOUR CAR TAKES ${pct(PER_RANK.bodywork * r)} LESS DAMAGE` },
  { id: 'nitro', group: 'WHEELS', name: 'NITRO JUNKIE', says: (r) => `NITRO FILLS ${pct(PER_RANK.nitro * r)} FASTER` },
  { id: 'slippery', group: 'HEAT', name: 'SLIPPERY', says: (r) => `COPS TAKE ${pct(PER_RANK.slippery * r)} LONGER TO CUFF YOU` },
  { id: 'ghost', group: 'HEAT', name: 'GHOST', says: (r) => `STARS FADE ${pct(PER_RANK.ghost * r)} SOONER` },
  { id: 'hustler', group: 'MONEY', name: 'HUSTLER', says: (r) => `HOSPITAL BILLS AND FINES ${pct(PER_RANK.hustler * r)} LESS` },
  { id: 'banker', group: 'MONEY', name: 'BANKER', says: (r) => `BANKED CHAINS PAY ${pct(PER_RANK.banker * r)} MORE` },
];

export const PERK_IDS: readonly PerkId[] = PERKS.map((p) => p.id);

/** Every level once each perk is maxed: there's nothing left to pick, so it pays this instead. */
export const MAXED_LEVEL_CASH = 500;

/** What one life did. */
export interface LifeSummary {
  /** Chaos points scored this life (a bust's fine not taken off). */
  points: number;
  /** Seconds alive. */
  seconds: number;
  /** Highest wanted level reached. */
  peakStars: number;
  /** Cash earned this life (jobs, banked chains, fares...). */
  cash: number;
}

/**
 * CRED for a life: about 250 for a good three minutes (20,000 points, a
 * 3-star chase and a $1,000 job), a dozen for a quick death.
 */
export function credForLife(l: LifeSummary): number {
  const s = Math.max(0, Math.min(5, Math.floor(l.peakStars)));
  const raw = Math.max(0, l.points) / 150 + Math.max(0, l.seconds) / 6 + Math.max(0, l.cash) / 25 + (10 * s * (s + 1)) / 2;
  return Number.isFinite(raw) ? Math.round(raw) : 0;
}

/** CRED from level n − 1 to level n (n ≥ 1): 100, 150, 200... */
export function levelCost(n: number): number {
  return 100 + 50 * (Math.max(1, Math.floor(n)) - 1);
}

/** The level `total` CRED reaches, and how far into the next it is. */
export function levelFor(total: number): { level: number; into: number; need: number } {
  let level = 0;
  let left = Math.max(0, Math.floor(total));
  while (left >= levelCost(level + 1)) {
    left -= levelCost(level + 1);
    level++;
  }
  return { level, into: left, need: levelCost(level + 1) };
}

/** The CRED part of the save. */
export interface CredSave {
  /** Every CRED ever earned. */
  total: number;
  /** Levels already cashed in (a perk picked, or MAXED_LEVEL_CASH paid). */
  picked: number;
  /** Ranks per perk; missing is 0. */
  perks: Partial<Record<PerkId, number>>;
}

export function defaultCred(): CredSave {
  return { total: 0, picked: 0, perks: {} };
}

export function rankOf(c: CredSave, id: PerkId): number {
  return Math.max(0, Math.min(PERK_RANKS, Math.floor(c.perks[id] ?? 0)));
}

/** Levels earned and not yet cashed in. */
export function pendingLevels(c: CredSave): number {
  return Math.max(0, levelFor(c.total).level - c.picked);
}

/** Small seeded generator (mulberry32), so an offer is the same every time it's shown. */
function seeded(seed: number): () => number {
  let s = seed | 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The (up to) three perks offered for the next level. Seeded by that level,
 * so quitting and coming back shows the same three (no rerolling by reload).
 * Empty once every perk is maxed.
 */
export function offerFor(c: CredSave, count = 3): PerkId[] {
  const open = PERK_IDS.filter((id) => rankOf(c, id) < PERK_RANKS);
  const rand = seeded(Math.imul(c.picked + 1, 0x9e3779b1));
  for (let i = open.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [open[i], open[j]] = [open[j], open[i]];
  }
  return open.slice(0, count);
}

/** Take a perk for the next pending level. False if none is pending or it's maxed. */
export function pick(c: CredSave, id: PerkId): boolean {
  if (pendingLevels(c) <= 0 || rankOf(c, id) >= PERK_RANKS || !PERK_IDS.includes(id)) return false;
  c.perks[id] = rankOf(c, id) + 1;
  c.picked++;
  return true;
}

/** Cash in a pending level with nothing left to pick: the cash it pays (0 if it can't). */
export function cashInMaxed(c: CredSave): number {
  if (pendingLevels(c) <= 0 || offerFor(c).length > 0) return 0;
  c.picked++;
  return MAXED_LEVEL_CASH;
}

/** What the perks do, as the systems take it. All 0 / 1 (no change) in NEUTRAL. */
export interface PerkEffects {
  /** Added to max health. */
  maxHealth: number;
  /** Armour to start each life with. */
  armour: number;
  /** Share of damage your car still takes. */
  carDamage: number;
  /** Nitro gains are multiplied by this. */
  nitroFill: number;
  /** Seconds a cop needs to cuff you are multiplied by this. */
  grabTime: number;
  /** Seconds out of sight to lose a star are multiplied by this. */
  evadeTime: number;
  /** Hospital bills and cash fines are multiplied by this. */
  bills: number;
  /** Banked chains are multiplied by this. */
  bank: number;
}

export const NEUTRAL: Readonly<PerkEffects> = Object.freeze({ maxHealth: 0, armour: 0, carDamage: 1, nitroFill: 1, grabTime: 1, evadeTime: 1, bills: 1, bank: 1 });

/** The effects of the save's ranks (written into `out`, which is returned). */
export function perkEffects(c: CredSave, out: PerkEffects = { ...NEUTRAL }): PerkEffects {
  const r = (id: PerkId) => rankOf(c, id);
  out.maxHealth = PER_RANK.tough * r('tough');
  out.armour = PER_RANK.vest * r('vest');
  out.carDamage = 1 - PER_RANK.bodywork * r('bodywork');
  out.nitroFill = 1 + PER_RANK.nitro * r('nitro');
  out.grabTime = 1 + PER_RANK.slippery * r('slippery');
  out.evadeTime = 1 - PER_RANK.ghost * r('ghost');
  out.bills = 1 - PER_RANK.hustler * r('hustler');
  out.bank = 1 + PER_RANK.banker * r('banker');
  return out;
}

/** A save's CRED record made safe: whole, non-negative, known perks within their ranks, picks no more than levels. */
export function sanitiseCred(v: unknown): CredSave {
  const c = defaultCred();
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return c;
  const o = v as Record<string, unknown>;
  const whole = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? Math.floor(x) : 0);
  c.total = whole(o.total);
  const perks = o.perks;
  let ranks = 0;
  if (typeof perks === 'object' && perks !== null && !Array.isArray(perks)) {
    for (const id of PERK_IDS) {
      const r = Math.min(PERK_RANKS, whole((perks as Record<string, unknown>)[id]));
      if (r > 0) c.perks[id] = r;
      ranks += r;
    }
  }
  // Every rank held was a level cashed in; never more picks than levels earned.
  c.picked = Math.min(levelFor(c.total).level, Math.max(ranks, whole(o.picked)));
  return c;
}

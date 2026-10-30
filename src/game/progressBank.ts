/**
 * "Bank your chaos": the points of a combo chain turn into cash when the
 * chain ends, more of it the hotter the police were on you, and getting
 * WASTED or BUSTED before it ends loses the lot. That's the game's central
 * gamble: keep the chain going for a bigger payout, or let it bank while
 * you're still standing. Pure logic, unit-tested.
 */

/** Chain points per dollar. */
export const POINTS_PER_DOLLAR = 10;
/** Each wanted star adds this share to the payout. */
export const STAR_BONUS = 0.5;

/** Cash for a chain worth `points`, banked at `stars` (0..5), times any perk `bonus`. */
export function chainCash(points: number, stars: number, bonus = 1): number {
  if (points <= 0) return 0;
  return Math.floor((points / POINTS_PER_DOLLAR) * (1 + STAR_BONUS * Math.max(0, stars)) * bonus);
}

/**
 * The chain in progress. Feed it every award with the wanted level at the
 * time (the chain remembers the highest), then close() it when the combo
 * runs out, or lose() it on death or arrest.
 */
export class ChainBank {
  /** Points in the open chain. */
  points = 0;
  /** Awards in the open chain. */
  links = 0;
  /** Highest wanted level seen during the chain. */
  peakStars = 0;

  get open(): boolean {
    return this.links > 0;
  }

  add(points: number, stars: number): void {
    this.points += Math.max(0, points);
    this.links++;
    this.peakStars = Math.max(this.peakStars, stars);
  }

  /** The chain ended normally: its cash (0 if none), and the chain is cleared. */
  close(bonus = 1): number {
    const cash = chainCash(this.points, this.peakStars, bonus);
    this.clear();
    return cash;
  }

  /** WASTED / BUSTED mid-chain: the points that were never banked (the chain is cleared). */
  lose(): number {
    const lost = this.points;
    this.clear();
    return lost;
  }

  clear(): void {
    this.points = 0;
    this.links = 0;
    this.peakStars = 0;
  }
}

/**
 * Is the score's chain still running? A combo window still open, or a drift
 * still sliding (its points bank when it stops, at the current multiplier).
 */
export function chainLive(score: { comboTimer: number; driftPoints: number }): boolean {
  return score.comboTimer > 0 || score.driftPoints > 0;
}

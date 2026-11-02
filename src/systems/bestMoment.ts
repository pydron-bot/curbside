/**
 * The life's best moment: of the stamps a life earns (systems/stamps.ts),
 * the heaviest is the one worth a picture on WASTED / BUSTED. A tie keeps
 * the first (it was the surprise; and no second capture). The caption and
 * the shared file's name come from here too. Pure, no three.js or DOM,
 * tested in tests/bestMoment.test.ts; ui/momentCard.ts captures and shows it.
 */
import { clock } from '../core/bugReportData';
import { DISTRICT_NAMES, districtAt } from '../world/districts';
import { STAMPS, type StampId, type StampTone } from './stamps';

/** Does `id` take the picture from `best` (null: nothing yet)? Heavier only; a tie keeps the first. */
export function beats(id: StampId, best: StampId | null): boolean {
  return best === null || STAMPS[id].weight > STAMPS[best].weight;
}

/** One stamped moment: what, where (world x, z) and the game clock's hour then. */
export interface Moment {
  id: StampId;
  x: number;
  z: number;
  hour: number;
}

/** The best of this life so far. offer() each stamp; true means "capture this frame". */
export class BestMoment {
  readonly moment: Moment = { id: 'lastOrders', x: 0, z: 0, hour: 0 };
  has = false;

  offer(id: StampId, x: number, z: number, hour: number): boolean {
    if (!beats(id, this.has ? this.moment.id : null)) return false;
    const m = this.moment;
    m.id = id;
    m.x = x;
    m.z = z;
    m.hour = hour;
    this.has = true;
    return true;
  }

  /** A new life: nothing yet. */
  reset(): void {
    this.has = false;
  }
}

export interface MomentCaption {
  /** The stamp's name, as stamped ("BARBECUE SEASON"). */
  label: string;
  /** What you did, in lower case ("three cars, one match"). */
  line: string;
  /** Where and when ("NEON MILE · 21:07"). */
  where: string;
  tone: StampTone;
  /** All of it on one line, for the share sheet's text. */
  text: string;
}

export function momentCaption(m: Moment): MomentCaption {
  const def = STAMPS[m.id];
  const line = def.sub.toLowerCase();
  const where = `${DISTRICT_NAMES[districtAt(m.x, m.z)]} · ${clock(m.hour)}`;
  return { label: def.label, line, where, tone: def.tone, text: `${def.label} — ${line} (${where}) #Curbside` };
}

/** The shared picture's name: curbside-barbecue-season-<yyyymmdd-hhmmss>.jpg (local time). */
export function momentFileName(id: StampId, at: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const slug = STAMPS[id].label
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `curbside-${slug}-${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}-${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}.jpg`;
}

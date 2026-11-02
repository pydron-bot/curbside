/**
 * The TEST menu's save tools (game/testTools.ts): CRED, missions, the
 * cold open, a full reset, and export / import of the save as text. They work
 * on the live SaveData in place (Progress owns it and writes it), so the
 * game sees the change at once; import goes through the save's own
 * sanitising (migrateSave, pruneSave), so a pasted save is as safe as one
 * loaded from storage. Pure logic, unit-tested.
 */
import { PERK_IDS, PERK_RANKS, levelCost, levelFor, defaultCred, type CredSave } from './cred';
import { defaultSave, migrateSave, pruneSave, type KnownIds, type SaveData } from './progressSave';

/** Every CRED it takes to reach `level`. */
export function credForLevel(level: number): number {
  let total = 0;
  for (let n = 1; n <= level; n++) total += levelCost(n);
  return total;
}

/** A level's worth: enough CRED to reach the next level (a perk to pick on the next death screen). Returns what was added. */
export function addCredLevel(c: CredSave): number {
  const { into, need } = levelFor(c.total);
  const add = need - into;
  c.total += add;
  return add;
}

/** Every perk at its top rank, with the CRED and levels that takes. */
export function maxPerks(c: CredSave): void {
  const levels = PERK_IDS.length * PERK_RANKS;
  for (const id of PERK_IDS) c.perks[id] = PERK_RANKS;
  c.picked = Math.max(c.picked, levels);
  c.total = Math.max(c.total, credForLevel(c.picked));
}

/** No CRED, no levels, no perks. */
export function resetCred(c: CredSave): void {
  Object.assign(c, defaultCred());
}

/** Every story job passed (the phones ring with repeat jobs). Returns how many were new. */
export function unlockAllMissions(save: SaveData, ids: readonly string[]): number {
  let added = 0;
  for (const id of ids) {
    if (save.missions.includes(id)) continue;
    save.missions.push(id);
    added++;
  }
  return added;
}

/**
 * Make `id` the next story job: every job before it in story order passed,
 * it and every one after not. False for an id that isn't a job.
 */
export function jumpToMission(save: SaveData, ids: readonly string[], id: string): boolean {
  const i = ids.indexOf(id);
  if (i < 0) return false;
  const before = ids.slice(0, i);
  // Ids this build doesn't know are left alone (pruneSave drops them at boot anyway).
  save.missions = [...before, ...save.missions.filter((m) => !ids.includes(m))];
  return true;
}

/** The cold open: had (PLAY starts at the spawn corner), or not (the next PLAY has it). */
export function setOpening(save: SaveData, done: boolean): void {
  save.opening = done;
}

/** Put `source`'s fields into `target` (Progress's live record), dropping any `target` has that `source` hasn't. */
export function replaceSave(target: SaveData, source: SaveData): void {
  const t = target as unknown as Record<string, unknown>;
  for (const k of Object.keys(t)) if (!(k in source)) delete t[k];
  Object.assign(target, structuredClone(source));
}

/** Everything back to a brand-new save, in place. */
export function resetSave(save: SaveData): void {
  replaceSave(save, defaultSave());
}

/** The save as text to keep or move to another device (the same JSON the game stores). */
export function exportSave(save: SaveData): string {
  return JSON.stringify(save);
}

export type ImportResult = { ok: true; save: SaveData } | { ok: false; error: string };

/** Fields a save always has: pasted JSON with none of them is something else. */
const SAVE_FIELDS = ['v', 'cash', 'stats', 'missions', 'cred'];

/**
 * Pasted text → a sanitised save, or why not. Anything that parses goes
 * through the loader's own sanitising (a bad field falls back alone) and
 * loses ids this build doesn't have; text that isn't a save is refused.
 */
export function importSave(text: string, known: KnownIds): ImportResult {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: 'NOTHING PASTED' };
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return { ok: false, error: 'NOT A SAVE (BAD JSON)' };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw) || !SAVE_FIELDS.some((k) => k in raw)) {
    return { ok: false, error: 'NOT A CURBSIDE SAVE' };
  }
  const save = migrateSave(raw);
  pruneSave(save, known);
  return { ok: true, save };
}

/**
 * The game's one live look (render/lookTuning.ts): the shipped look.json over
 * the code's values, and the owner's LOOK panel values over that once main
 * calls `lookTuning.load(localStorage)`. Readers read `look` at use time;
 * what's built from it (the sky's keys, the grade's uniform) is rebuilt here
 * when a slider moves.
 */
import raw from './look.json';
import { LookTuning, parseLookFile } from './lookTuning';
import { writeGrade } from './post';
import { setSkyKeys, tuneKeys } from './timeOfDay';

export const lookTuning = new LookTuning(parseLookFile(raw));
/** Live slider values (100% = 1, hues in degrees, shifts −1..1). */
export const look = lookTuning.look;

function rebuild(): void {
  setSkyKeys(tuneKeys(look));
  writeGrade(look);
}
lookTuning.onChange(rebuild);
rebuild();

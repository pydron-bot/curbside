/**
 * The game's one live look (render/lookTuning.ts): the shipped look.json over
 * the code's values, and the owner's LOOK panel values over that once main
 * calls `lookTuning.load(localStorage)`. Readers read `look` at use time;
 * what's built from it (the sky's keys, the grade's and the world shaders'
 * uniforms) is rebuilt here
 * when a slider moves.
 */
import { Color } from 'three';
import raw from './look.json';
import { LookTuning, parseLookFile, writeShaderLook } from './lookTuning';
import { writeGrade } from './post';
import { worldUniforms } from './shaderLib';
import { setSkyKeys, tuneKeys } from './timeOfDay';

export const lookTuning = new LookTuning(parseLookFile(raw));
/** Live slider values (100% = 1, hues in degrees, shifts −1..1). */
export const look = lookTuning.look;

/** The street lamps' colour as written (shaderLib uLampColor), and where STREET LAMP COLOUR takes it either way. */
const LAMP = worldUniforms.uLampColor.value.clone();
const LAMP_WHITE = new Color('#fff1dc');
const LAMP_AMBER = new Color('#ff8a2e');

function rebuild(): void {
  const w = look.lampWhite;
  worldUniforms.uLampColor.value
    .copy(LAMP)
    .lerp(w >= 0 ? LAMP_WHITE : LAMP_AMBER, Math.abs(w))
    .multiplyScalar(look.lamps);
  setSkyKeys(tuneKeys(look));
  writeGrade(look);
  writeShaderLook(look, worldUniforms.uLook.value);
}
lookTuning.onChange(rebuild);
rebuild();

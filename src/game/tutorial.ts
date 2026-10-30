/**
 * The first run's three pointers, so a new player isn't left with "0",
 * "$0" and an unexplained radar: steal a car, chain some chaos until it
 * banks as cash, answer the ringing payphone. One step at a time on the
 * marker prompt (when nothing nearer to hand has one), kept in the save
 * and never shown again once done. Pure logic: the progress director feeds
 * it bus events and puts the text on screen.
 */
import type { InputDevice } from '../core/input';

/** Steps: 0 steal a car, 1 bank a chain, 2 answer the phone; DONE after. */
export const TUTORIAL_DONE = 3;

export type TutorialEvent = 'enterVehicle' | 'banked' | 'mission';

/**
 * The step after `event` at `step`. Each pointer clears on its own event,
 * and answering the phone (the story starting) ends the lot, however the
 * player got there.
 */
export function advanceTutorial(step: number, event: TutorialEvent): number {
  if (step >= TUTORIAL_DONE) return TUTORIAL_DONE;
  if (event === 'mission') return TUTORIAL_DONE;
  if (event === 'enterVehicle' && step === 0) return 1;
  if (event === 'banked' && step === 1) return 2;
  return step;
}

const TEXT: Record<InputDevice, readonly string[]> = {
  keyboard: [
    'STEAL A CAR · WALK UP TO ONE AND PRESS E',
    'DRIFT (SPACE) · NEAR MISS · SMASH · JUMP — CHAINS BANK AS CASH',
    'ANSWER THE RINGING PAYPHONE · M ON THE RADAR',
  ],
  touch: [
    'STEAL A CAR · TAP THE DOOR BUTTON BESIDE ONE',
    'DRIFT · NEAR MISS · SMASH · JUMP — CHAINS BANK AS CASH',
    'ANSWER THE RINGING PAYPHONE · M ON THE RADAR',
  ],
  gamepad: [
    'STEAL A CAR · WALK UP TO ONE AND PRESS Y',
    'DRIFT (A) · NEAR MISS · SMASH · JUMP — CHAINS BANK AS CASH',
    'ANSWER THE RINGING PAYPHONE · M ON THE RADAR',
  ],
};

/** What to say at `step` for the device in use, or null once done. */
export function tutorialText(step: number, device: InputDevice): string | null {
  return step < TUTORIAL_DONE ? (TEXT[device][step] ?? null) : null;
}

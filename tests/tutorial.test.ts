import { describe, expect, it } from 'vitest';
import { POINTER_HIDE_SPEED, POINTER_SHOW_SPEED, TUTORIAL_DONE, advanceTutorial, pointerWaits, tutorialText } from '../src/game/tutorial';

describe('first-run pointers', () => {
  it('steal a car, bank a chain, answer the phone, in that order', () => {
    let step = 0;
    step = advanceTutorial(step, 'banked'); // banking before you've had a car doesn't skip ahead
    expect(step).toBe(0);
    step = advanceTutorial(step, 'enterVehicle');
    expect(step).toBe(1);
    step = advanceTutorial(step, 'enterVehicle');
    expect(step).toBe(1);
    step = advanceTutorial(step, 'banked');
    expect(step).toBe(2);
    step = advanceTutorial(step, 'mission');
    expect(step).toBe(TUTORIAL_DONE);
    expect(advanceTutorial(step, 'enterVehicle')).toBe(TUTORIAL_DONE);
  });

  it('answering a call at any point means they found their way: done', () => {
    expect(advanceTutorial(0, 'mission')).toBe(TUTORIAL_DONE);
  });

  it('speaks the device in use, and says nothing once done', () => {
    expect(tutorialText(0, 'keyboard')).toContain('PRESS E');
    expect(tutorialText(0, 'gamepad')).toContain('PRESS Y');
    expect(tutorialText(0, 'touch')).toContain('DOOR BUTTON');
    expect(tutorialText(1, 'keyboard')).toContain('BANK AS CASH');
    expect(tutorialText(2, 'touch')).toContain('PAYPHONE');
    expect(tutorialText(TUTORIAL_DONE, 'touch')).toBeNull();
  });

  it('waits while the car is moving (it would sit over the car on a phone), with hysteresis', () => {
    expect(pointerWaits(true, null)).toBe(false); // on foot: always shown
    expect(pointerWaits(false, 0)).toBe(false); // stopped: the car sits mid-screen
    expect(pointerWaits(false, POINTER_HIDE_SPEED + 1)).toBe(true);
    // Between the two lines it keeps its last answer: no blinking at a steady speed.
    const mid = (POINTER_HIDE_SPEED + POINTER_SHOW_SPEED) / 2;
    expect(pointerWaits(true, mid)).toBe(true);
    expect(pointerWaits(false, mid)).toBe(false);
    expect(pointerWaits(true, POINTER_SHOW_SPEED - 1)).toBe(false);
  });
});

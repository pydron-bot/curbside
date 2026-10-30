import { describe, expect, it } from 'vitest';
import { TUTORIAL_DONE, advanceTutorial, tutorialText } from '../src/game/tutorial';

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
});

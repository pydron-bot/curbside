import { describe, expect, it } from 'vitest';
import { PEDAL_REACH, chordBetween, pedalsAt, type PedalLayout, type PedalState } from '../src/ui/pedalZones';

// The default (right-handed) pad: HAND top right, GAS below it, BRAKE bottom left.
const hand = { x: 155, y: 33, r: 33 };
const gas = { x: 155, y: 129, r: 49 };
const brake = { x: 40, y: 134, r: 40 };
const layout: PedalLayout = { gas, brake, hand, chord: chordBetween(hand, gas) };

const at = (x: number, y: number): PedalState => {
  const s = { gas: false, brake: false, hand: false };
  pedalsAt(x, y, layout, s);
  return s;
};

describe('pedal pad', () => {
  it('presses the pedal under the finger', () => {
    expect(at(155, 130)).toEqual({ gas: true, brake: false, hand: false });
    expect(at(40, 134)).toEqual({ gas: false, brake: true, hand: false });
    expect(at(155, 25)).toEqual({ gas: false, brake: false, hand: true });
  });

  it('rolls from GAS to BRAKE as the thumb slides across, never pressing both', () => {
    let sawGas = false;
    let sawBrake = false;
    for (let x = 160; x >= 30; x -= 5) {
      const s = at(x, 132);
      expect(s.gas && s.brake).toBe(false);
      sawGas ||= s.gas;
      sawBrake ||= s.brake;
    }
    expect(sawGas && sawBrake).toBe(true);
  });

  it('presses GAS and HAND together in the band between them', () => {
    const mid = (hand.y + hand.r + gas.y - gas.r) / 2;
    expect(at(155, mid)).toEqual({ gas: true, brake: false, hand: true });
    // The band is narrow: well inside either pedal is just that pedal.
    expect(at(155, hand.y)).toEqual({ gas: false, brake: false, hand: true });
    expect(at(155, gas.y)).toEqual({ gas: true, brake: false, hand: false });
  });

  it('the band is big enough for a resting thumb (44 pt), and GAS keeps most of its face', () => {
    const c = layout.chord;
    expect(c.maxY - c.minY).toBeGreaterThanOrEqual(44);
    expect(c.maxX - c.minX).toBeGreaterThanOrEqual(44);
    // A thumb on the upper part of GAS, a third of a radius above its centre, is still just GAS.
    expect(at(155, gas.y - gas.r / 3)).toEqual({ gas: true, brake: false, hand: false });
  });

  it('ignores a finger that has slid well off every pedal', () => {
    expect(at(40, -60)).toEqual({ gas: false, brake: false, hand: false });
    // Just off a pedal's rim still counts (fat thumbs).
    expect(at(brake.x - brake.r * (PEDAL_REACH - 0.1), brake.y)).toMatchObject({ brake: true });
  });

  it('two fingers OR together', () => {
    const s = { gas: false, brake: false, hand: false };
    pedalsAt(155, 130, layout, s);
    pedalsAt(155, 25, layout, s);
    expect(s).toEqual({ gas: true, brake: false, hand: true });
  });
});

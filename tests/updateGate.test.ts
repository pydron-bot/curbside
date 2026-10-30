import { describe, expect, it, vi } from 'vitest';
import { UpdateGate } from '../src/core/updateGate';

describe('app update gate', () => {
  it('does nothing at safe points until an update is waiting', () => {
    const apply = vi.fn();
    const gate = new UpdateGate(apply);
    expect(gate.atSafePoint()).toBe(false);
    expect(apply).not.toHaveBeenCalled();
  });

  it('holds a waiting update until a safe point, then applies it once', () => {
    const apply = vi.fn();
    const onReady = vi.fn();
    const gate = new UpdateGate(apply, onReady);
    gate.markReady();
    gate.markReady();
    expect(onReady).toHaveBeenCalledOnce(); // offered on the pause screen
    expect(apply).not.toHaveBeenCalled(); // never mid-run
    expect(gate.pending).toBe(true);
    expect(gate.atSafePoint()).toBe(true);
    expect(gate.atSafePoint()).toBe(false);
    expect(apply).toHaveBeenCalledOnce();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { LONG_ABSENCE_MS, UpdateGate } from '../src/core/updateGate';

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

describe('app update gate and page visibility', () => {
  it('applies when the title screen is hidden', () => {
    const apply = vi.fn();
    const gate = new UpdateGate(apply);
    gate.markReady();
    expect(gate.pageHidden(0, true)).toBe(true);
    expect(apply).toHaveBeenCalledOnce();
  });

  it('keeps a run through a plain app switch', () => {
    const apply = vi.fn();
    const gate = new UpdateGate(apply);
    gate.markReady();
    expect(gate.pageHidden(1000, false)).toBe(false);
    expect(gate.pageShown(1000 + LONG_ABSENCE_MS - 1)).toBe(false);
    expect(apply).not.toHaveBeenCalled();
    expect(gate.pending).toBe(true);
  });

  it('applies on return after a long absence', () => {
    const apply = vi.fn();
    const gate = new UpdateGate(apply);
    gate.markReady();
    gate.pageHidden(5000, false);
    expect(gate.pageShown(5000 + LONG_ABSENCE_MS)).toBe(true);
    expect(apply).toHaveBeenCalledOnce();
  });

  it('a show without a recorded hide never applies', () => {
    const apply = vi.fn();
    const gate = new UpdateGate(apply);
    gate.markReady();
    expect(gate.pageShown(1e9)).toBe(false);
    // Each absence is measured from its own hide.
    gate.pageHidden(0, false);
    gate.pageShown(10);
    expect(gate.pageShown(LONG_ABSENCE_MS * 2)).toBe(false);
    expect(apply).not.toHaveBeenCalled();
  });
});

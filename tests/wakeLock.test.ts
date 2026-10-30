import { describe, expect, it } from 'vitest';
import { ScreenAwake, type WakeDoc, type WakeSentinel } from '../src/ui/wakeLock';

class FakeSentinel implements WakeSentinel {
  released = false;
  private fns: (() => void)[] = [];
  addEventListener(_type: 'release', fn: () => void) {
    this.fns.push(fn);
  }
  release() {
    if (!this.released) {
      this.released = true;
      for (const fn of this.fns) fn();
    }
    return Promise.resolve();
  }
}

function setup(refuse = false) {
  const issued: FakeSentinel[] = [];
  const host = {
    wakeLock: {
      request: () => {
        if (refuse) return Promise.reject(new Error('NotAllowedError'));
        const s = new FakeSentinel();
        issued.push(s);
        return Promise.resolve(s);
      },
    },
  };
  let onVisibility = () => {};
  const doc: WakeDoc & { visibilityState: DocumentVisibilityState } = {
    visibilityState: 'visible',
    addEventListener: (_type, fn) => {
      onVisibility = fn;
    },
  };
  const awake = new ScreenAwake(host, doc);
  const held = () => issued.filter((s) => !s.released).length;
  const setVisible = (v: boolean) => {
    doc.visibilityState = v ? 'visible' : 'hidden';
    // The browser releases the lock itself when the page is hidden.
    if (!v) for (const s of issued) void s.release();
    onVisibility();
  };
  return { awake, issued, held, setVisible };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('screen wake lock', () => {
  it('held while wanted, let go when not', async () => {
    const { awake, held } = setup();
    awake.set(true);
    await settle();
    expect(awake.active).toBe(true);
    expect(held()).toBe(1);
    awake.set(false);
    expect(awake.active).toBe(false);
    expect(held()).toBe(0);
  });

  it('one sentinel however fast it toggles', async () => {
    const { awake, held, issued } = setup();
    for (let i = 0; i < 5; i++) {
      awake.set(true);
      awake.set(false);
    }
    awake.set(true);
    await settle();
    expect(held()).toBe(1);
    expect(issued.length).toBe(1);
    awake.set(false);
    await settle();
    expect(held()).toBe(0);
  });

  it('asks again when the page comes back, not while hidden', async () => {
    const { awake, held, issued, setVisible } = setup();
    awake.set(true);
    await settle();
    setVisible(false);
    await settle();
    expect(held()).toBe(0);
    expect(issued.length).toBe(1);
    setVisible(true);
    await settle();
    expect(held()).toBe(1);
    expect(awake.active).toBe(true);
  });

  it('a refusal or no API is harmless', async () => {
    const refused = setup(true);
    refused.awake.set(true);
    await settle();
    expect(refused.awake.active).toBe(false);
    expect(refused.awake.lastError).toContain('NotAllowed');
    const none = new ScreenAwake({}, { visibilityState: 'visible', addEventListener: () => {} });
    expect(none.supported).toBe(false);
    none.set(true);
    expect(none.active).toBe(false);
  });
});

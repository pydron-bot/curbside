import { describe, expect, it } from 'vitest';
import { debugHandle, expose, exposeGetter, installDebugHandle } from '../src/core/debugHandle';

describe('debugHandle (__ub)', () => {
  it('collects values and live getters, and goes on the window when installed', () => {
    const thing = { a: 1 };
    expose('thing', thing);
    let n = 1;
    exposeGetter('count', () => n);
    n = 2;
    expect(debugHandle().thing).toBe(thing);
    expect(debugHandle().count).toBe(2);
    installDebugHandle();
    expect((globalThis as unknown as { __ub: Record<string, unknown> }).__ub.count).toBe(2);
    expect(Object.keys(debugHandle())).toEqual(['thing', 'count']);
  });

  it('refuses a name exposed twice', () => {
    expose('once', 1);
    expect(() => expose('once', 2)).toThrow(/once/);
    expect(() => exposeGetter('once', () => 3)).toThrow(/once/);
  });
});

import { describe, expect, it } from 'vitest';
import { DESTRUCTION_MODES } from '../src/core/settings';
import {
  RUBBLE_CAPACITY,
  STYLE,
  chipCount,
  chunkCount,
  destructionFromUrl,
  needsPhysics,
  resolveStyle,
} from '../src/render/destructionStyle';

describe('destruction styles', () => {
  it('auto is desktop on high and medium, scar-only on low; phone and desktop are forced on any tier; off is off', () => {
    const tiers = ['high', 'medium', 'low'] as const;
    const expected = {
      off: ['off', 'off', 'off'],
      // Phones start on 'medium' and get the desktop style (an iPhone 15 Pro held 60 fps with it).
      auto: ['desktop', 'desktop', 'low'],
      phone: ['phone', 'phone', 'phone'],
      desktop: ['desktop', 'desktop', 'desktop'],
    } as const;
    for (const mode of DESTRUCTION_MODES) {
      tiers.forEach((tier, i) => expect(resolveStyle(mode, tier), `${mode} on ${tier}`).toBe(expected[mode][i]));
    }
    // Under auto only a step to or from 'low' changes the style (and restyles the scars); medium ↔ high doesn't.
    expect(resolveStyle('auto', 'medium')).toBe(resolveStyle('auto', 'high'));
    expect(resolveStyle('auto', 'low')).not.toBe(resolveStyle('auto', 'medium'));
    expect(needsPhysics(resolveStyle('auto', 'medium'))).toBe(true);
    expect(needsPhysics(resolveStyle('auto', 'low'))).toBe(false);
  });

  it('only phone and desktop styles need Rapier', () => {
    expect(needsPhysics('desktop')).toBe(true);
    expect(needsPhysics('phone')).toBe(true);
    expect(needsPhysics('low')).toBe(false);
    expect(needsPhysics('off')).toBe(false);
  });

  it('?destruction=<mode> overrides for the session; bare means auto; junk is ignored', () => {
    expect(destructionFromUrl('?destruction=phone')).toBe('phone');
    expect(destructionFromUrl('?destruction=desktop')).toBe('desktop');
    expect(destructionFromUrl('?destruction')).toBe('auto');
    expect(destructionFromUrl('?destruction=')).toBe('auto');
    expect(destructionFromUrl('?destruction=junk')).toBeNull();
    expect(destructionFromUrl('')).toBeNull();
    expect(destructionFromUrl('?debug')).toBeNull();
    expect(destructionFromUrl('?debug&destruction=off')).toBe('off');
  });

  it('budgets: phone throws a few big chunks, desktop tens of small ones, low none', () => {
    expect(chunkCount(STYLE.phone, 0)).toBeGreaterThanOrEqual(3);
    expect(chunkCount(STYLE.phone, 1)).toBeLessThanOrEqual(8);
    expect(chunkCount(STYLE.desktop, 0)).toBeGreaterThanOrEqual(12);
    expect(chunkCount(STYLE.desktop, 1)).toBeLessThanOrEqual(40);
    expect(chunkCount(STYLE.low, 1)).toBe(0);
    expect(chipCount(STYLE.low, 1)).toBeGreaterThan(chipCount(STYLE.low, 0));
    expect(STYLE.phone.halfMin).toBeGreaterThanOrEqual(STYLE.desktop.halfMax);
    expect(STYLE.phone.maxLive).toBeLessThanOrEqual(40);
    expect(STYLE.low.maxLive).toBe(0);
    expect(STYLE.phone.life).toBeLessThan(STYLE.desktop.life);
    expect(STYLE.desktop.sink).toBe(0); // desktop cleans up out of view instead
    expect(STYLE.phone.proxies).toBeLessThanOrEqual(STYLE.desktop.proxies);
    // The shared mesh and physics slots hold desktop's cap plus one more breach sinking.
    expect(RUBBLE_CAPACITY).toBeGreaterThanOrEqual(STYLE.desktop.maxLive + chunkCount(STYLE.desktop, 1));
    expect(STYLE.desktop.scarCap).toBeGreaterThanOrEqual(STYLE.phone.scarCap);
  });
});

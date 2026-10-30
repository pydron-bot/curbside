import { describe, expect, it } from 'vitest';
import { SHOP_ITEMS, SPRAY_PRICE, SPRAY_PRICE_CARD, canBuy, sprayPrice } from '../src/game/modes/shop';

describe('shop', () => {
  it('upgrades are bought once; ammo any number of times', () => {
    const armour = SHOP_ITEMS.find((i) => i.id === 'armour')!;
    const ammo = SHOP_ITEMS.find((i) => i.id === 'ammo-smg')!;
    expect(canBuy(armour, 99999, () => false)).toBe('ok');
    expect(canBuy(armour, 99999, () => true)).toBe('owned');
    expect(canBuy(armour, armour.price - 1, () => false)).toBe('broke');
    expect(canBuy(ammo, 99999, () => true)).toBe('ok');
  });

  it('a vest can be bought again once it is no longer full', () => {
    const vest = SHOP_ITEMS.find((i) => i.kind === 'armour')!;
    expect(canBuy(vest, 99999, () => true)).toBe('owned'); // still full
    expect(canBuy(vest, 99999, () => false)).toBe('ok');
  });

  it('a 20-minute session (~$8k) can afford a couple of upgrades', () => {
    const upgrades = SHOP_ITEMS.filter((i) => i.kind === 'upgrade').map((i) => i.price).sort((a, b) => a - b);
    expect(upgrades[0] + upgrades[1]).toBeLessThanOrEqual(8000);
    expect(upgrades.reduce((a, b) => a + b, 0)).toBeGreaterThan(5000);
  });

  it('the spray card makes resprays cheaper', () => {
    expect(sprayPrice(false)).toBe(SPRAY_PRICE);
    expect(sprayPrice(true)).toBe(SPRAY_PRICE_CARD);
    expect(SPRAY_PRICE_CARD).toBeLessThan(SPRAY_PRICE);
  });
});

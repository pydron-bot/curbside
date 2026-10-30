/**
 * The safehouse shop: what cash buys. Upgrades are permanent (saved as
 * unlocks); ammo is a bundle added to what you carry. Prices are tuned so a
 * 20-minute session (a few banked chains, a frenzy or two, a race, some
 * fares) affords a couple of things. Pure data and rules, unit-tested.
 */
import type { WeaponKind } from '../../systems/weapons';

export type ShopItemKind = 'upgrade' | 'ammo';

export interface ShopItem {
  id: string;
  kind: ShopItemKind;
  name: string;
  blurb: string;
  price: number;
  /** For ammo: which gun. */
  weapon?: WeaponKind;
}

/** Pay 'n' Spray's usual price, and with the spray card. */
export const SPRAY_PRICE = 400;
export const SPRAY_PRICE_CARD = 100;
/** Extra max health from the TOUGH SKIN upgrade (the stand-in for body armour). */
export const TOUGH_SKIN_HEALTH = 50;

export const SHOP_ITEMS: readonly ShopItem[] = [
  {
    id: 'armour',
    kind: 'upgrade',
    name: 'TOUGH SKIN',
    blurb: `+${TOUGH_SKIN_HEALTH} max health, every life`,
    price: 3000,
  },
  {
    id: 'spraycard',
    kind: 'upgrade',
    name: "PAY 'N' SPRAY CARD",
    blurb: `Resprays cost $${SPRAY_PRICE_CARD} instead of $${SPRAY_PRICE}`,
    price: 1500,
  },
  {
    id: 'scanner',
    kind: 'upgrade',
    name: 'PACKAGE SCANNER',
    blurb: 'Hidden packages show on the radar',
    price: 2000,
  },
  { id: 'ammo-pistol', kind: 'ammo', name: 'PISTOL ROUNDS', blurb: '+24 rounds (and the pistol)', price: 150, weapon: 'pistol' },
  { id: 'ammo-smg', kind: 'ammo', name: 'SMG DRUM', blurb: '+90 rounds (and the SMG)', price: 400, weapon: 'smg' },
  { id: 'ammo-shotgun', kind: 'ammo', name: 'SHOTGUN SHELLS', blurb: '+12 shells (and the shotgun)', price: 300, weapon: 'shotgun' },
];

export type BuyCheck = 'ok' | 'owned' | 'broke';

/** Can `item` be bought with `cash`, given the unlocks held? */
export function canBuy(item: ShopItem, cash: number, owned: (id: string) => boolean): BuyCheck {
  if (item.kind === 'upgrade' && owned(item.id)) return 'owned';
  return cash >= item.price ? 'ok' : 'broke';
}

/** The respray price with or without the card (perks can make it free). */
export function sprayPrice(card: boolean): number {
  return card ? SPRAY_PRICE_CARD : SPRAY_PRICE;
}

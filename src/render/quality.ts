/**
 * Quality tiers: the one place render code asks "how much can I draw?" —
 * pixel-ratio range, sun shadow map size, bloom, particle budget, and how big
 * the crowd and traffic are. The tier comes from settings.quality ('auto'
 * picks by device: phones and tablets start at 'medium', desktops at 'high')
 * and DynamicResolution steps it down at runtime when frames run slow.
 *
 * Subscribers to onQualityChange should react without recompiling shaders
 * (e.g. resize the shadow map or skip a pass rather than toggling
 * renderer.shadowMap.enabled mid-play).
 */
import { onSettingsChange, settings, type QualityPreset } from '../core/settings';

export type QualityTierName = 'high' | 'medium' | 'low';

export interface QualityTier {
  readonly name: QualityTierName;
  /** Pixel-ratio cap (the device's own ratio caps it too). */
  readonly maxPixelRatio: number;
  /** Pixel-ratio floor on high-DPI screens (devicePixelRatio >= 2); 1x screens floor at LOW_DPI_FLOOR. */
  readonly minPixelRatio: number;
  /** Sun shadow map size in texels; 0 = no real-time shadows. */
  readonly shadowMapSize: number;
  /** Full-screen bloom pass. */
  readonly bloom: boolean;
  /** Multiplier on particle counts and emission rates. */
  readonly particleScale: number;
  /** Multipliers on Population's CROWD_COUNT / TRAFFIC_COUNT. */
  readonly crowdScale: number;
  readonly trafficScale: number;
}

export const QUALITY_TIERS: Readonly<Record<QualityTierName, QualityTier>> = {
  high: {
    name: 'high',
    maxPixelRatio: 2,
    minPixelRatio: 1,
    shadowMapSize: 2048,
    bloom: true,
    particleScale: 1,
    crowdScale: 1,
    trafficScale: 1,
  },
  // Phones: 1.5x is ~44% fewer pixels than 2x and still sharp at 460 ppi,
  // which leaves GPU headroom for when the A17 Pro throttles.
  medium: {
    name: 'medium',
    maxPixelRatio: 1.5,
    minPixelRatio: 1,
    shadowMapSize: 1024,
    bloom: false,
    particleScale: 0.75,
    crowdScale: 1,
    trafficScale: 1,
  },
  low: {
    name: 'low',
    maxPixelRatio: 1.25,
    minPixelRatio: 1,
    shadowMapSize: 0,
    bloom: false,
    particleScale: 0.5,
    crowdScale: 0.8,
    trafficScale: 0.8,
  },
};

/** Best first. */
export const TIER_ORDER: readonly QualityTierName[] = ['high', 'medium', 'low'];
/** Pixel-ratio floor on screens below 2x: dropping far below native looks bad. */
export const LOW_DPI_FLOOR = 0.85;

export interface DeviceInfo {
  /** Touch-first (phone/tablet): coarse primary pointer or a mobile UA. */
  handheld: boolean;
  pixelRatio: number;
}

/** What kind of device this is, defensively (works outside a browser too). */
export function detectDevice(): DeviceInfo {
  const w = typeof window !== 'undefined' ? window : undefined;
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const coarse = w?.matchMedia?.('(pointer: coarse)').matches ?? false;
  const ua = nav?.userAgent ?? '';
  // iPadOS reports a Mac UA; touch points give it away.
  const mobileUa = /iPhone|iPad|iPod|Android|Mobile/i.test(ua) || (/Macintosh/.test(ua) && (nav?.maxTouchPoints ?? 0) > 1);
  return { handheld: coarse || mobileUa, pixelRatio: w?.devicePixelRatio || 1 };
}

/** The tier a quality preset means on this device. */
export function tierForPreset(preset: QualityPreset, device: DeviceInfo): QualityTierName {
  if (preset !== 'auto') return preset;
  return device.handheld ? 'medium' : 'high';
}

// --- Current tier ---------------------------------------------------------

let device: DeviceInfo = detectDevice();
let current: QualityTier = QUALITY_TIERS[tierForPreset(settings.quality, device)];
const listeners: Array<(tier: QualityTier) => void> = [];

/** The tier in force right now. */
export function getQuality(): QualityTier {
  return current;
}

/** The tier the player's setting asks for on this device (before any runtime step-down). */
export function preferredTier(): QualityTierName {
  return tierForPreset(settings.quality, device);
}

export function getDevice(): DeviceInfo {
  return device;
}

/** Re-read the device (e.g. the window moved to a screen with another pixel ratio). */
export function refreshDevice(): DeviceInfo {
  device = detectDevice();
  return device;
}

/** Switch tier (DynamicResolution does this); listeners hear about real changes only. */
export function setQualityTier(name: QualityTierName): void {
  if (current.name === name) return;
  current = QUALITY_TIERS[name];
  for (const fn of [...listeners]) fn(current);
}

/** Called whenever the tier changes. Returns an unsubscribe function. */
export function onQualityChange(fn: (tier: QualityTier) => void): () => void {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

// A new quality setting takes effect straight away (DynamicResolution also
// rebuilds its ladder from it).
let lastPreset = settings.quality;
onSettingsChange((s) => {
  if (s.quality === lastPreset) return;
  lastPreset = s.quality;
  setQualityTier(preferredTier());
});

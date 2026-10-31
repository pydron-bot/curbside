/**
 * Haptic feedback, driven by game events (crash scaled by impact, explosions
 * by distance, a light tick per shot, getting hurt), on whatever the player is
 * holding:
 *  - a gamepad: dual-rumble through its vibrationActuator (Chrome, Edge, Android);
 *  - an Android phone: navigator.vibrate;
 *  - an iPhone (iOS 18+): Safari has no vibration API, but toggling an
 *    <input type=checkbox switch> plays the system haptic tick. It only works
 *    inside a user gesture, so ticks are delivered from the touch controls'
 *    handlers: their own presses, plus any event that fired just before.
 * All of it respects settings.haptics and fails silently where unsupported.
 */
import type { EventBus } from '../core/events';
import type { Input } from '../core/input';
import { settings } from '../core/settings';

/** An iOS tick waiting for the next touch is dropped after this long, ms. */
const IOS_PENDING_MS = 220;
/** At most one iOS tick per this many ms (they blur together faster). */
const IOS_MIN_GAP_MS = 55;

interface RumbleActuator {
  playEffect(type: string, params: { duration: number; strongMagnitude: number; weakMagnitude: number; startDelay?: number }): Promise<unknown>;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export class Haptics {
  /** Off behind the title: attract-mode crashes and explosions aren't the player's to feel. */
  enabled = true;
  private readonly iosLabel: HTMLLabelElement | null;
  private iosPendingAt = -Infinity;
  private iosLastAt = -Infinity;
  private rumbleUntil = 0;
  /** The switch's 'change' events: proof the toggle ran (Diagnostics probes). */
  switchChanges = 0;

  constructor(
    private readonly input: Input,
    bus: EventBus,
  ) {
    this.iosLabel = isIos() ? makeSwitch() : null;
    this.iosLabel?.querySelector('input')?.addEventListener('change', () => this.switchChanges++);
    bus.on('crash', (e) => {
      if (e.involvesPlayer) this.pulse(clamp01((e.impact - 3) / 18), 40 + Math.min(160, e.impact * 6));
    });
    bus.on('explosion', (e) => {
      const s = e.ownCar ? 1 : clamp01(1 - e.distance / 60);
      if (s > 0.05) this.pulse(s, 180 + s * 220);
    });
    bus.on('shot', (e) => {
      if (e.byPlayer) this.pulse(e.weapon === 'shotgun' ? 0.45 : 0.15, e.weapon === 'shotgun' ? 70 : 30);
    });
    bus.on('playerHurt', (e) => this.pulse(clamp01(0.35 + e.amount / 40), 90));
    bus.on('pedDown', (e) => {
      if (e.byPlayer && !e.isPlayer && e.cause === 'vehicle') this.pulse(0.3, 50);
    });
  }

  /**
   * Call from touch-control pointerdown handlers (a user gesture): delivers
   * an iOS tick queued by a recent event, or one for this press if `press`.
   */
  touch(press = false): void {
    if (!this.iosLabel || !settings.haptics || !this.enabled) return;
    const now = performance.now();
    if (!press && now - this.iosPendingAt > IOS_PENDING_MS) return;
    if (now - this.iosLastAt < IOS_MIN_GAP_MS) return;
    this.iosPendingAt = -Infinity;
    this.iosLastAt = now;
    this.iosLabel.click();
  }

  /**
   * Diagnostics probe: toggle the iOS switch now, past the rate limit and
   * the setting (a switched-off setting mustn't read as no support). False
   * when there's no switch (not iOS).
   */
  probeTick(): boolean {
    if (!this.iosLabel) return false;
    this.iosLabel.click();
    return true;
  }

  /** Diagnostics probe: one rumble on the first pad; resolves to what playEffect said. */
  probeRumble(): Promise<string> {
    const pad = this.input.pad as (Gamepad & { vibrationActuator?: RumbleActuator | null }) | null;
    if (!pad) return Promise.resolve('no gamepad');
    const act = pad.vibrationActuator;
    if (!act?.playEffect) return Promise.resolve('unsupported (no vibrationActuator)');
    try {
      return act.playEffect('dual-rumble', { duration: 400, strongMagnitude: 1, weakMagnitude: 0.6 }).then(
        (r) => `resolved: ${String(r)}`,
        (e: unknown) => `rejected: ${e instanceof Error ? `${e.name} ${e.message}` : String(e)}`,
      );
    } catch (e) {
      return Promise.resolve(`threw: ${e instanceof Error ? `${e.name} ${e.message}` : String(e)}`);
    }
  }

  /** One haptic bump: strength 0..1 for `ms` milliseconds, on the device in use. */
  pulse(strength: number, ms: number): void {
    if (!settings.haptics || !this.enabled || strength <= 0) return;
    const device = this.input.lastDevice;
    if (device === 'gamepad') this.rumble(strength, ms);
    else if (device === 'touch') {
      if (this.iosLabel) this.iosPendingAt = performance.now();
      else vibrate(Math.round(ms * (0.4 + strength * 0.6)));
    }
  }

  private rumble(strength: number, ms: number): void {
    const now = performance.now();
    // A weaker bump doesn't cut a strong one short.
    if (now < this.rumbleUntil && strength < 0.5) return;
    const pad = this.input.pad as (Gamepad & { vibrationActuator?: RumbleActuator | null }) | null;
    const act = pad?.vibrationActuator;
    if (!act?.playEffect) return;
    this.rumbleUntil = now + ms;
    try {
      act
        .playEffect('dual-rumble', { duration: ms, strongMagnitude: strength, weakMagnitude: clamp01(strength * 0.6 + 0.2) })
        .catch(() => {});
    } catch {
      // Effect type not supported by this pad.
    }
  }
}

function vibrate(ms: number): void {
  try {
    navigator.vibrate?.(ms);
  } catch {
    // Blocked (no user activation yet) or unsupported.
  }
}

function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** The hidden switch whose toggle makes iOS 18 play its haptic. */
function makeSwitch(): HTMLLabelElement | null {
  if (typeof document === 'undefined') return null;
  const label = document.createElement('label');
  label.className = 'haptic-switch';
  label.setAttribute('aria-hidden', 'true');
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.setAttribute('switch', '');
  box.tabIndex = -1;
  label.append(box);
  document.body.append(label);
  return label;
}

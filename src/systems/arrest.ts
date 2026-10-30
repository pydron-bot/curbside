/**
 * When the police get their hands on the player. On foot: an officer within
 * grabbing range while the player is slow or lying stunned. In a car: boxed
 * in (all but stopped) with a police car touching it or an officer at the
 * driver's door. Either has to hold for a moment, shown as a filling meter,
 * so a lucky brush past a cop isn't an arrest and the player can break free.
 * Pure logic.
 */
import { bodyOf, carCircles, type Point } from './physics';
import type { VehicleState } from '../entities/vehicle';

export interface ArrestSituation {
  /** Wanted level: nobody arrests a clean player. */
  stars: number;
  /** On foot (else in a car). */
  onFoot: boolean;
  /** Player (or their car's) ground speed, m/s. */
  speed: number;
  /** Lying knocked down. */
  stunned: boolean;
  /** Distance to the nearest officer on foot, m (Infinity if none). */
  copDistance: number;
  /** In a car: a police car is touching it. */
  copCarTouching: boolean;
  /** In a car: an officer is at the driver's door. */
  copAtDoor: boolean;
}

/** An officer this close (centre to centre) can grab someone on foot, m. */
export const GRAB_RANGE = 1.3;
/** Seconds held to cuff someone on their feet... */
export const GRAB_SECONDS = 1;
/** ...or lying on the ground. */
export const STUNNED_GRAB_SECONDS = 0.5;
/** On foot, slower than this (walking, standing) can be grabbed; a sprint (6 m/s) can't. */
export const SLOW_ON_FOOT = 2.8;
/** A car slower than this is boxed in, m/s. */
export const BOXED_SPEED = 1;
/** Seconds boxed in before being dragged out. */
export const BOXED_SECONDS = 2;
/** An officer this close to the driver's door has it open, m. */
export const DOOR_RANGE = 1.6;
/** Progress lost per second while breaking free (as a fraction of the meter). */
const ESCAPE_RATE = 1.2;
/** Extra reach for "touching" between car collision circles (they're pushed apart every step), m. */
const TOUCH_SLOP = 0.35;

export class BustMeter {
  /** 0..1; at 1 the player is busted. */
  progress = 0;

  /** Advance one step; true when the arrest completes (the meter then resets). */
  step(dt: number, s: ArrestSituation): boolean {
    const seconds = this.grabSeconds(s);
    if (seconds <= 0) {
      this.progress = Math.max(0, this.progress - ESCAPE_RATE * dt);
      return false;
    }
    this.progress += dt / seconds;
    if (this.progress < 1) return false;
    this.progress = 0;
    return true;
  }

  reset(): void {
    this.progress = 0;
  }

  /** How long the current hold takes to complete, or 0 if nobody has hold of the player. */
  private grabSeconds(s: ArrestSituation): number {
    if (s.stars <= 0) return 0;
    if (s.onFoot) {
      if (s.copDistance > GRAB_RANGE) return 0;
      if (s.stunned) return STUNNED_GRAB_SECONDS;
      return s.speed < SLOW_ON_FOOT ? GRAB_SECONDS : 0;
    }
    if (s.speed >= BOXED_SPEED) return 0;
    return s.copCarTouching || s.copAtDoor ? BOXED_SECONDS : 0;
  }
}

/** Reused for each car's collision circles (carCircles resizes them to the body). */
const circlesA: Point[] = [];
const circlesB: Point[] = [];

/** Are two cars in contact (their collision circles within a hair of each other)? */
export function carsTouching(a: VehicleState, b: VehicleState): boolean {
  const ba = bodyOf(a);
  const bb = bodyOf(b);
  const far = ba.reach + bb.reach + TOUCH_SLOP;
  if (Math.abs(a.x - b.x) > far || Math.abs(a.z - b.z) > far) return false;
  const reach = ba.radius + bb.radius + TOUCH_SLOP;
  for (const p of carCircles(a, circlesA)) {
    for (const q of carCircles(b, circlesB)) {
      if (Math.hypot(p.x - q.x, p.z - q.z) < reach) return true;
    }
  }
  return false;
}

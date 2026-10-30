import { describe, expect, it } from 'vitest';
import { CAR_BODY, VEHICLE_BODIES } from '../src/entities/vehicle';
import { driveMarker, type DriveMarker } from '../src/render/playerMarker';

const m = (): DriveMarker => ({ ring: 0, ahead: 0, chevron: 0 });

describe('driving marker size', () => {
  it("keeps today's ring and chevron round a sedan", () => {
    const s = driveMarker(CAR_BODY.reach, m());
    expect(s.ring).toBeCloseTo(6.4, 1);
    expect(s.ahead).toBeCloseTo(3.4, 1);
    expect(s.chevron).toBe(1);
  });

  it('shrinks round a scooter but still clears its body', () => {
    const reach = VEHICLE_BODIES.scooter.reach;
    const s = driveMarker(reach, m());
    expect(s.ring).toBeLessThan(3.5);
    expect(s.ring * 0.41).toBeGreaterThan(reach);
    expect(s.ahead).toBeGreaterThan(reach);
    expect(s.chevron).toBeGreaterThanOrEqual(0.6);
    expect(s.chevron).toBeLessThan(1);
  });

  it("doesn't grow past the sedan's round a bus", () => {
    const s = driveMarker(VEHICLE_BODIES.bus.reach, m());
    expect(s.ring).toBe(6.4);
    expect(s.ahead).toBe(3.4);
    expect(s.chevron).toBe(1);
  });
});

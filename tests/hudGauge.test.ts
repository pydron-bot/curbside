import { describe, expect, it } from 'vitest';
import { VEHICLE_SPECS, createVehicleState, forwardSpeed, stepVehicle } from '../src/entities/vehicle';
import { gaugeTopSpeed } from '../src/ui/hud';

describe('speedometer scale', () => {
  it('ends just above the speed each car really reaches flat out', () => {
    for (const [name, spec] of Object.entries(VEHICLE_SPECS)) {
      const car = createVehicleState(0, 0, 0);
      for (let i = 0; i < 60 * 40; i++) stepVehicle(car, { throttle: 1, steer: 0, handbrake: false }, spec, 1 / 60);
      const top = forwardSpeed(car);
      const gauge = gaugeTopSpeed(spec);
      expect(gauge, name).toBeGreaterThanOrEqual(top);
      expect(gauge, name).toBeLessThan(top * 1.12);
    }
  });
});

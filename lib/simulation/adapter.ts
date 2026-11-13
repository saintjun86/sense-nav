import type { SensorFrame } from "./types";
import { validateFrame } from "./data";
/** Example bridge contract, NOT a claim about any specific SDK method or permission. */
export type BridgeTelemetry = {
  timestampMs: number; speedKmh: number; steeringWheelDeg: number;
  acceleratorPercent: number; brakePercent: number; gear: string;
  wheelDistanceM?: number; yawRateDegps?: number;
  gps?: { localX: number; localY: number; headingClockwiseDeg?: number };
};
export function normalizeTelemetry(raw: BridgeTelemetry, steeringSign: 1 | -1 = 1): SensorFrame {
  const gear = raw.gear.toUpperCase();
  return validateFrame({
    timestampMs: raw.timestampMs,
    speedMps: raw.speedKmh / 3.6 * (gear === "R" ? -1 : 1),
    steeringWheelDeg: raw.steeringWheelDeg * steeringSign,
    throttle: raw.acceleratorPercent / 100, brake: raw.brakePercent / 100,
    gear, gpsAvailable: Boolean(raw.gps),
    ...(raw.wheelDistanceM !== undefined ? { wheelDistanceM: raw.wheelDistanceM } : {}),
    ...(raw.yawRateDegps !== undefined ? { yawRateRadps: raw.yawRateDegps * steeringSign * Math.PI / 180 } : {}),
    ...(raw.gps ? { gpsX: raw.gps.localX, gpsY: raw.gps.localY,
      ...(raw.gps.headingClockwiseDeg !== undefined ? { gpsHeadingRad: raw.gps.headingClockwiseDeg * Math.PI / 180 } : {}) } : {}),
  });
}

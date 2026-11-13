import type { Estimate, SensorFrame, Vehicle } from "./types";
import { GRAVITY, MAX_SPEED_MPS, flatForces, roadWheelAngle, turnRate } from "./physics";
import { angleWrap, clamp, START } from "./world";
export function initialEstimate(): Estimate {
  return { ...START, speed: 0, distance: 0, uncertaintyM: 0.35, gradeRad: 0, gradeObservable: false, gpsUsed: false, gyroBiasRadps: 0, gyroUsed: false };
}
/** Only sensor measurements and model parameters enter here; no truth pose, floor or ramp lookup. */
export function stepEstimate(previous: Estimate, frame: SensorFrame, vehicle: Vehicle, dt: number, friction = 0.85, previousFrame?: SensorFrame): Estimate {
  if (dt <= 0 || dt > 1 || !Number.isFinite(dt)) throw new Error("센서 시간 간격이 유효하지 않습니다.");
  const speed = frame.speedMps;
  const travel = frame.wheelDistanceM ?? (previous.speed + speed) / 2 * dt;
  const meanSpeed = travel / dt;
  const steering = previousFrame ? (previousFrame.steeringWheelDeg + frame.steeringWheelDeg) / 2 : frame.steeringWheelDeg;
  const steer = roadWheelAngle(steering, vehicle);
  const stopped = Math.abs(speed) < 0.01 && Math.abs(previous.speed) < 0.01 && Math.abs(travel) < 0.00001;
  const gyroUsed = frame.yawRateRadps !== undefined;
  let gyroBiasRadps = previous.gyroBiasRadps;
  if (stopped && gyroUsed) gyroBiasRadps += (1 - Math.exp(-dt / 2)) * (frame.yawRateRadps! - gyroBiasRadps);
  const modelYaw = turnRate(meanSpeed, steering, vehicle, friction);
  const gyroYaw = (frame.yawRateRadps ?? 0) - gyroBiasRadps;
  // Complementary rate fusion: trust the gyro more when steering predicts a different turn.
  const gyroWeight = Math.abs(gyroYaw - modelYaw) > 0.15 ? 1 : 0.95;
  const yaw = stopped ? 0 : gyroUsed ? gyroWeight * gyroYaw + (1 - gyroWeight) * modelYaw : modelYaw;
  const headingDelta = yaw * dt;
  let heading = angleWrap(previous.heading + headingDelta);

  // Pedals and speed change must describe the SAME time interval. Older logs can
  // approximate its mean commands from adjacent samples; no attitude input exists.
  const controls = { ...frame,
    throttle: frame.intervalThrottle ?? (previousFrame ? (previousFrame.throttle + frame.throttle) / 2 : frame.throttle),
    brake: frame.intervalBrake ?? (previousFrame ? (previousFrame.brake + frame.brake) / 2 : frame.brake),
  };
  const averageSpeed = (previous.speed + speed) / 2;
  const { drive, brake, rolling, aero } = flatForces(averageSpeed, controls, vehicle, friction);
  // Deliberately derive acceleration from speed and elapsed time. The optional
  // acceleration telemetry field is display-only and never supplies road grade.
  const measuredAcceleration = (speed - previous.speed) / dt;
  const flatAcceleration = (drive - Math.sign(averageSpeed) * (brake + rolling) - aero) / vehicle.massKg;
  const gravityResidual = (flatAcceleration - measuredAcceleration) / GRAVITY;
  // Stops, reversals, hard braking, sharp turns and the 30 km/h governor can
  // produce acceleration changes that must not be interpreted as road grade.
  const stablePedals = !previousFrame || Math.abs(frame.throttle - previousFrame.throttle) < 0.08 && Math.abs(frame.brake - previousFrame.brake) < 0.08;
  const sameDirection = previous.speed * speed > 0;
  const stableGear = frame.gear !== "P" && (!previousFrame || previousFrame.gear === frame.gear);
  const gradeObservable = sameDirection && stableGear && stablePedals
    && Math.min(Math.abs(previous.speed), Math.abs(speed)) > 0.7
    && Math.max(Math.abs(previous.speed), Math.abs(speed)) < MAX_SPEED_MPS - 0.7
    && Math.max(frame.brake, controls.brake, previousFrame?.brake ?? 0) < 0.45
    && Math.abs(averageSpeed * yaw) < 2.5 && Math.abs(measuredAcceleration) < 5
    && Math.abs(gravityResidual) <= Math.sin(0.35);
  // Filter the force residual to suppress differentiation noise. This is a
  // model estimate with lag, not a measurement of the simulated ramp's angle.
  const filteredResidual = Math.sin(previous.gradeRad) + (1 - Math.exp(-dt / 0.65)) * (gravityResidual - Math.sin(previous.gradeRad));
  const gradeRad = gradeObservable ? Math.asin(clamp(filteredResidual, -Math.sin(0.35), Math.sin(0.35))) : previous.gradeRad;
  const halfTurn = headingDelta / 2;
  const arcScale = Math.abs(halfTurn) < 1e-8 ? 1 : Math.sin(halfTurn) / halfTurn;
  let x = previous.x + travel * Math.cos(gradeRad) * arcScale * Math.cos(previous.heading + halfTurn);
  let y = previous.y + travel * Math.cos(gradeRad) * arcScale * Math.sin(previous.heading + halfTurn);
  let uncertaintyM = previous.uncertaintyM + Math.abs(travel) * (gyroUsed ? 0.003 : 0.012 + Math.abs(steer) * 0.07) + dt * 0.002;
  const gpsUsed = frame.gpsAvailable && frame.gpsX !== undefined && frame.gpsY !== undefined;
  if (gpsUsed) {
    const gain = 1 - Math.exp(-dt / 0.7);
    x += gain * (frame.gpsX! - x); y += gain * (frame.gpsY! - y);
    if (frame.gpsHeadingRad !== undefined) heading = angleWrap(heading + gain * angleWrap(frame.gpsHeadingRad - heading));
    uncertaintyM += gain * (0.5 - uncertaintyM);
  }
  return { x, y, heading, z: previous.z + travel * Math.sin(gradeRad), speed, distance: previous.distance + Math.abs(travel), gradeRad, gradeObservable, uncertaintyM, gpsUsed, gyroBiasRadps, gyroUsed };
}

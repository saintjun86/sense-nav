import type { Config, Controls, PhysicsState, Vehicle } from "./types";
import { angleWrap, clamp, collisionObstacles, rampEntryBlocked, resolveSurface, scenarioStart, surfaceGrade } from "./world";
export const GRAVITY = 9.80665;
export const FIXED_DT = 1 / 120;
export const MAX_SPEED_KMH = 30;
export const MAX_SPEED_MPS = MAX_SPEED_KMH / 3.6;
export const VEHICLES: Vehicle[] = [
  { id: "compact", name: "컴팩트 EV", massKg: 1650, wheelbaseM: 2.7, lengthM: 4.3, widthM: 1.8, steeringRatio: 15, maxDriveForceN: 6500, maxBrakeForceN: 15000, dragAreaM2: 0.65, rollingCoefficient: 0.012 },
  { id: "sedan", name: "미드사이즈 세단", massKg: 1850, wheelbaseM: 2.9, lengthM: 4.8, widthM: 1.86, steeringRatio: 16, maxDriveForceN: 7500, maxBrakeForceN: 17000, dragAreaM2: 0.62, rollingCoefficient: 0.012 },
  { id: "suv", name: "패밀리 SUV", massKg: 2200, wheelbaseM: 3, lengthM: 4.95, widthM: 1.95, steeringRatio: 17, maxDriveForceN: 8500, maxBrakeForceN: 20000, dragAreaM2: 0.86, rollingCoefficient: 0.014 },
];
export const SENSOR_PRESETS = {
  basic: { speedBiasPct: 0, steeringBiasDeg: 0, gyroBiasDegps: 0, noise: 0 },
  experiment: { speedBiasPct: 0.6, steeringBiasDeg: 0.5, gyroBiasDegps: 0.05, noise: 0.35 },
};
export const hasSensorErrors = (config: Config) => [config.speedBiasPct, config.steeringBiasDeg, config.gyroBiasDegps, config.noise].some(value => value !== 0);
export const DEFAULT_CONFIG: Config = { vehicle: VEHICLES[0], friction: 0.85, ...SENSOR_PRESETS.basic, useGyro: true, gpsMode: "auto", scenario: "garage" };
export const roadWheelAngle = (steeringWheelDeg: number, vehicle: Vehicle) => clamp(steeringWheelDeg / vehicle.steeringRatio * Math.PI / 180, -0.6, 0.6);
/** Shared low-speed turn model. The estimator uses sensor speed, never the true pose. */
export function turnRate(speed: number, steeringWheelDeg: number, vehicle: Vehicle, friction: number) {
  const desired = speed / vehicle.wheelbaseM * Math.tan(roadWheelAngle(steeringWheelDeg, vehicle));
  const limit = friction * GRAVITY / Math.max(Math.abs(speed), 0.2);
  return clamp(desired, -limit, limit);
}
export function initialPhysics(scenario: Config["scenario"] = "garage"): PhysicsState {
  return { ...scenarioStart(scenario), speed: 0, acceleration: 0, distance: 0, collisions: 0, collided: false, gradeRad: 0 };
}
export function flatForces(speed: number, controls: Controls, vehicle: Vehicle, friction = 1) {
  const direction = controls.gear === "R" ? -1 : controls.gear === "D" ? 1 : 0;
  const limit = friction * vehicle.massKg * GRAVITY;
  const drive = direction * Math.min(clamp(controls.throttle, 0, 1) * vehicle.maxDriveForceN, limit);
  const brake = Math.min(clamp(controls.brake, 0, 1) * vehicle.maxBrakeForceN, limit);
  const rolling = vehicle.rollingCoefficient * vehicle.massKg * GRAVITY;
  const aero = 0.5 * 1.225 * vehicle.dragAreaM2 * speed * Math.abs(speed);
  return { drive, brake, rolling, aero };
}
// Oriented vehicle footprint vs axis-aligned world obstacles, using separating axes.
export function intersectsObstacle(state: PhysicsState, vehicle: Vehicle) {
  const f = { x: Math.cos(state.heading), y: Math.sin(state.heading) };
  const l = { x: -f.y, y: f.x };
  const reach = Math.hypot(vehicle.lengthM, vehicle.widthM) / 2;
  return collisionObstacles(state, { x: state.x, y: state.y, radius: reach }).some(o => {
    if (state.x + reach < o.x || state.x - reach > o.x + o.w || state.y + reach < o.y || state.y - reach > o.y + o.h) return false;
    const dx = o.x + o.w / 2 - state.x, dy = o.y + o.h / 2 - state.y;
    return [f, l, { x: 1, y: 0 }, { x: 0, y: 1 }].every(a => {
      const bodyRadius = vehicle.lengthM / 2 * Math.abs(a.x * f.x + a.y * f.y) + vehicle.widthM / 2 * Math.abs(a.x * l.x + a.y * l.y);
      const obstacleRadius = o.w / 2 * Math.abs(a.x) + o.h / 2 * Math.abs(a.y);
      return Math.abs(dx * a.x + dy * a.y) < bodyRadius + obstacleRadius;
    });
  });
}
export function stepPhysics(previous: PhysicsState, controls: Controls, config: Config, dt = FIXED_DT): PhysicsState {
  if (!Number.isFinite(dt) || dt <= 0 || dt > 0.1) throw new Error("물리 시간 간격은 0~0.1초여야 합니다.");
  const v = config.vehicle;
  const gradeRad = surfaceGrade(previous);
  const { drive, brake, rolling, aero } = flatForces(previous.speed, controls, v, config.friction);
  const gravityForce = -v.massKg * GRAVITY * Math.sin(gradeRad);
  const freeForce = drive + gravityForce - aero;
  const resist = brake + rolling;
  const sign = Math.abs(previous.speed) > 0.001 ? Math.sign(previous.speed) : Math.sign(freeForce);
  const force = Math.abs(previous.speed) < 0.001 && Math.abs(freeForce) <= resist ? 0 : freeForce - sign * resist;
  let speed = previous.speed + force / v.massKg * dt;
  if (previous.speed * speed < 0 && Math.abs(freeForce) <= resist) speed = 0;
  if (controls.gear === "P") speed = 0;
  // The service speed limit also applies to reverse, neutral coasting and downhill motion.
  speed = clamp(speed, -MAX_SPEED_MPS, MAX_SPEED_MPS);
  const meanSpeed = (previous.speed + speed) / 2;
  const yaw = turnRate(meanSpeed, controls.steeringWheelDeg, v, config.friction);
  const heading = angleWrap(previous.heading + yaw * dt);
  const midHeading = previous.heading + yaw * dt / 2;
  const next: PhysicsState = {
    ...previous, speed, heading, gradeRad, collided: false,
    x: previous.x + meanSpeed * Math.cos(gradeRad) * Math.cos(midHeading) * dt,
    y: previous.y + meanSpeed * Math.cos(gradeRad) * Math.sin(midHeading) * dt,
    z: previous.z + meanSpeed * Math.sin(gradeRad) * dt,
    distance: previous.distance + Math.abs(meanSpeed) * dt,
    acceleration: (speed - previous.speed) / dt,
  };
  Object.assign(next, resolveSurface(previous, next));
  if (rampEntryBlocked(previous, next) || intersectsObstacle(next, v)) {
    return { ...previous, speed: 0, acceleration: -previous.speed / dt, collided: true, gradeRad, collisions: previous.collisions + (previous.collided ? 0 : 1) };
  }
  return next;
}

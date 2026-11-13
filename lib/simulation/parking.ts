import type { Config, Controls, PhysicsState, Pose } from "./types";
import { GRAVITY } from "./physics";
import { angleWrap, clamp, distance, type RoutePoint } from "./world";

export const PARKING_APPROACH_M = 18;
const HEADING_TOLERANCE = Math.PI / 180;
const CENTER_TOLERANCE_M = .08;
type ReferencePoint = { x: number; y: number; heading: number; curvature: number; remaining: number };

/** Automatic-driver control only. All motion still passes through stepPhysics and sensors. */
export class ParkingController {
  engaged = false;
  private phase: "approach" | "dock" | "reverse" | "parked" = "approach";
  private reference: ReferencePoint[];

  constructor(route: RoutePoint[], private target: Pose) {
    let start = route.length - 1, length = 0;
    while (start > 0 && length < PARKING_APPROACH_M) { length += distance(route[start], route[start - 1]); start--; }
    const points = route.slice(start).filter((p, i, all) => i === 0 || distance(p, all[i - 1]) > .001);
    const segments = points.slice(1).map((p, i) => ({ heading: Math.atan2(p.y - points[i].y, p.x - points[i].x), length: distance(p, points[i]) }));
    let remaining = segments.reduce((total, segment) => total + segment.length, 0);
    this.reference = points.map((p, i) => {
      const before = segments[Math.max(0, i - 1)], after = segments[Math.min(i, segments.length - 1)];
      const turn = angleWrap(after.heading - before.heading);
      const point = { ...p, heading: angleWrap(before.heading + turn / 2), curvature: turn / ((before.length + after.length) / 2), remaining };
      if (i < segments.length) remaining -= segments[i].length;
      return point;
    });
  }

  private closestReference(p: PhysicsState): ReferencePoint {
    let best = this.reference[0], bestDistance = Infinity;
    for (let i = 0; i < this.reference.length - 1; i++) {
      const a = this.reference[i], b = this.reference[i + 1], dx = b.x - a.x, dy = b.y - a.y;
      const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy), 0, 1);
      const x = a.x + dx * t, y = a.y + dy * t, d = Math.hypot(p.x - x, p.y - y);
      if (d >= bestDistance) continue;
      bestDistance = d;
      best = { x, y, heading: angleWrap(a.heading + angleWrap(b.heading - a.heading) * t), curvature: a.curvature + (b.curvature - a.curvature) * t, remaining: a.remaining + (b.remaining - a.remaining) * t };
    }
    return best;
  }

  step(p: PhysicsState, config: Config): Controls {
    this.engaged = true;
    const f = { x: Math.cos(this.target.heading), y: Math.sin(this.target.heading) };
    const dx = p.x - this.target.x, dy = p.y - this.target.y;
    const remaining = -(dx * f.x + dy * f.y);
    const crossTrack = -dx * f.y + dy * f.x;
    const headingError = angleWrap(p.heading - this.target.heading);
    const aligned = Math.abs(headingError) <= HEADING_TOLERANCE && Math.abs(crossTrack) <= CENTER_TOLERANCE_M;
    if (this.phase === "parked") return { throttle: 0, brake: 1, steeringWheelDeg: 0, gear: "P" };

    let curvature: number, speed: number, direction: 1 | -1 = 1;
    if (this.phase === "approach") {
      const reference = this.closestReference(p);
      if (reference.remaining > 2) {
        const lateral = -(p.x - reference.x) * Math.sin(reference.heading) + (p.y - reference.y) * Math.cos(reference.heading);
        // Follow both the path tangent and its curvature instead of aiming only at a point.
        curvature = reference.curvature - 1.5 * angleWrap(p.heading - reference.heading) - .6 * lateral;
        speed = Math.abs(reference.curvature) > .04 ? .65 : 1.2;
        return this.controls(p, config, speed, curvature, 1);
      }
      this.phase = "dock";
    }

    if (this.phase === "dock") {
      if (aligned && remaining >= -.05 && remaining <= .2 && Math.abs(p.speed) < .08) {
        this.phase = "parked";
        return { throttle: 0, brake: 1, steeringWheelDeg: 0, gear: "P" };
      }
      // Leave room to straighten the car; do not accept a diagonal final pose.
      if (remaining < -.05 || remaining <= .35 && !aligned) this.phase = "reverse";
    }
    if (this.phase === "reverse") {
      if (remaining >= 3.5) this.phase = "dock";
      else direction = -1;
    }
    // Reversing changes yaw response. Keep the same bay centerline but invert heading feedback.
    curvature = -.6 * crossTrack - direction * 1.5 * headingError;
    speed = direction === -1 ? Math.min(.55, Math.max(.12, (3.5 - remaining) * .7)) : Math.min(.65, Math.max(0, remaining - .05) * .6);
    return this.controls(p, config, speed, curvature, direction);
  }

  private controls(p: PhysicsState, config: Config, targetSpeed: number, curvature: number, direction: 1 | -1): Controls {
    const vehicle = config.vehicle;
    const steeringLimit = Math.min(720, vehicle.steeringRatio * .6 * 180 / Math.PI);
    const steeringWheelDeg = clamp(Math.atan(vehicle.wheelbaseM * curvature) * vehicle.steeringRatio * 180 / Math.PI, -steeringLimit, steeringLimit);
    // Come to rest before changing between forward and reverse.
    if (direction * p.speed < -.025) return { throttle: 0, brake: 1, steeringWheelDeg: 0, gear: p.speed > 0 ? "D" : "R" };
    const gear = direction === 1 ? "D" : "R";
    if (targetSpeed === 0) return { throttle: 0, brake: .8, steeringWheelDeg, gear };
    // This controller parks on the level garage floor; it needs no grade measurement.
    const feedForward = vehicle.rollingCoefficient * GRAVITY;
    const force = vehicle.massKg * (2.5 * (targetSpeed - direction * p.speed) + feedForward);
    return { throttle: clamp(force / vehicle.maxDriveForceN, 0, .45), brake: clamp(-force / vehicle.maxBrakeForceN, 0, .65), steeringWheelDeg, gear };
  }
}

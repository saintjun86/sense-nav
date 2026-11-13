import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Simulation } from "../lib/simulation/engine";
import { DEFAULT_CONFIG, initialPhysics, intersectsObstacle, stepPhysics, VEHICLES } from "../lib/simulation/physics";
import { initialEstimate, stepEstimate } from "../lib/simulation/estimator";
import { parseSensorFile, sensorCSV, validateFrame, validateVehicle } from "../lib/simulation/data";
import { RAMPS, START, WORLD, resolveSurface, surfaceGrade } from "../lib/simulation/world";
import type { Config, Controls } from "../lib/simulation/types";
const controls: Controls = { throttle: 0, brake: 0, steeringWheelDeg: 0, gear: "D" };
const flat: Config = { ...DEFAULT_CONFIG, scenario: "flat" };
function complete(config = DEFAULT_CONFIG) {
  const sim = new Simulation(config);
  for (let n = 0; n < 120 * 600 && !sim.state.complete; n++) sim.step();
  return sim;
}
describe("longitudinal physics", () => {
  it("remains stationary with no input on a level road", () => {
    let s = initialPhysics();
    for (let n = 0; n < 600; n++) s = stepPhysics(s, controls, flat);
    assert.equal(s.speed, 0); assert.equal(s.distance, 0);
  });
  it("accelerates under drive force and braking stops without reversing", () => {
    let s = initialPhysics();
    for (let n = 0; n < 120; n++) s = stepPhysics(s, { ...controls, throttle: 0.5 }, flat);
    assert.ok(s.speed > 1.5 && s.speed < 2.1);
    for (let n = 0; n < 120; n++) s = stepPhysics(s, { ...controls, brake: 0.8 }, flat);
    assert.equal(s.speed, 0);
  });
  it("identical throttle produces uphill < flat < downhill acceleration", () => {
    const p = { ...initialPhysics(), y: 280, z: -1.6, rampId: "R1", speed: 2 };
    const c = { ...controls, throttle: 0.3 };
    const downhill = stepPhysics(p, c, DEFAULT_CONFIG);
    const level = stepPhysics({ ...p, x: 100, rampId: null }, c, flat);
    const uphill = stepPhysics({ ...p, heading: Math.PI / 2 }, c, flat);
    assert.ok(uphill.acceleration < level.acceleration && level.acceleration < downhill.acceleration);
  });
  it("neutral rolls downhill but parking lock holds", () => {
    const p = { ...initialPhysics(), y: 280, z: -1.6, rampId: "R1" };
    assert.ok(stepPhysics(p, { ...controls, gear: "N" }, DEFAULT_CONFIG).speed > 0);
    assert.equal(stepPhysics(p, { ...controls, gear: "P" }, DEFAULT_CONFIG).speed, 0);
  });
  it("reversing changes steering yaw direction", () => {
    const p = { ...initialPhysics(), y: 60, speed: -2 };
    const next = stepPhysics(p, { ...controls, gear: "R", steeringWheelDeg: 200 }, flat);
    assert.ok(next.heading < p.heading);
  });
  it("stops the complete vehicle footprint before penetrating a wall", () => {
    let p = { ...initialPhysics(), x: 308, y: 20, heading: 0, speed: 6 };
    for (let i = 0; i < 240; i++) p = stepPhysics(p, { ...controls, throttle: 0.5 }, flat);
    assert.equal(p.speed, 0); assert.ok(p.collisions > 0); assert.ok(p.x < 312);
    assert.equal(intersectsObstacle(p, flat.vehicle), false);
  });
  it("rejects unstable integration steps", () => assert.throws(() => stepPhysics(initialPhysics(), controls, flat, 1)));
});
describe("sensor-only navigation and scenarios", () => {
  it("dead reckons a known straight trajectory with GPS absent", () => {
    let estimate = { ...initialEstimate(), heading: 0, speed: 2 };
    for (let i = 1; i <= 200; i++) estimate = stepEstimate(estimate, { ...controls, timestampMs: i * 50, speedMps: 2, gpsAvailable: false, throttle: flat.vehicle.rollingCoefficient * flat.vehicle.massKg * 9.80665 / flat.vehicle.maxDriveForceN }, flat.vehicle, 0.05);
    assert.ok(Math.abs(estimate.x - (START.x + 20)) < 0.01); assert.ok(Math.abs(estimate.y - START.y) < 0.001);
  });
  it("finishes entry, GPS loss, all three basement descents and 2 second P parking without collisions", () => {
    const s = complete().state;
    assert.equal(s.complete, true); assert.equal(s.physics.collisions, 0); assert.ok(s.parked);
    assert.ok(Math.abs(s.physics.z + 9.6) < 1e-9); assert.ok(s.estimate.z < -9 && s.estimate.z > -10.4);
    assert.ok(s.physics.distance > 1600 && s.physics.distance < 1700);
    assert.ok(s.events.some(e => e.text.includes("GPS 수신 중단")));
  });
  it("is repeatable for the same configuration and seed", () => {
    const first = complete(), second = complete();
    assert.deepEqual(first.state.physics, second.state.physics); assert.deepEqual(first.state.estimate, second.state.estimate);
  });
  it("runs every supplied vehicle and slope scenario to completion", () => {
    for (const vehicle of VEHICLES) for (const scenario of ["garage", "flat", "uphill"] as const) {
      const s = complete({ ...DEFAULT_CONFIG, vehicle, scenario }).state;
      assert.equal(s.complete, true, `${vehicle.id}/${scenario}`); assert.equal(s.physics.collisions, 0);
      if (scenario === "flat") assert.equal(s.physics.z, -3.2);
      if (scenario === "uphill") assert.equal(s.physics.z, 0);
    }
  });
  it("visible error grows with steering bias and shrinks with continuous GPS", () => {
    const biased = complete({ ...DEFAULT_CONFIG, steeringBiasDeg: 4, gpsMode: "off" }).state;
    const corrected = complete({ ...DEFAULT_CONFIG, steeringBiasDeg: 4, gpsMode: "on" }).state;
    assert.ok(biased.rmse! > corrected.rmse! * 2);
  });
  it("replays exported sensors without fabricating ground-truth metrics", () => {
    const original = complete(); const replay = new Simulation(DEFAULT_CONFIG, "replay");
    for (const f of parseSensorFile(sensorCSV(original.samples))) replay.ingest(f);
    assert.equal(replay.state.error, null); assert.equal(replay.state.rmse, null); assert.equal(replay.state.truth.length, 0);
    assert.ok(replay.state.parked); assert.ok(replay.state.estimate.distance > 200);
  });
  it("refuses time reversal and gaps rather than integrating stale data", () => {
    const s = new Simulation(DEFAULT_CONFIG, "stream");
    const frame = { ...controls, speedMps: 1, timestampMs: 0, gpsAvailable: false };
    s.ingest(frame); assert.throws(() => s.ingest(frame)); assert.throws(() => s.ingest({ ...frame, timestampMs: 1001 }));
    s.ingest({ ...frame, timestampMs: 50 }); assert.ok(s.state.time > 0);
  });
});
describe("data boundary", () => {
  const valid = { ...controls, timestampMs: 0, speedMps: 0, gpsAvailable: false };
  it("rejects NaN, out-of-range pedals, unknown gear, and GPS without coordinates", () => {
    for (const invalid of [{ speedMps: "NaN" }, { throttle: 2 }, { gear: "X" }, { gpsAvailable: true }, { timestampMs: null }, { brake: true }]) assert.throws(() => validateFrame({ ...valid, ...invalid }));
  });
  it("accepts quoted CSV/BOM and JSON and rejects duplicate time", () => {
    const frames = [valid, { ...valid, timestampMs: 50 }];
    assert.equal(parseSensorFile("\uFEFF" + sensorCSV(frames)).length, 2);
    assert.deepEqual(parseSensorFile(JSON.stringify({ frames })), frames);
    assert.throws(() => parseSensorFile(JSON.stringify([valid, valid])));
  });
  it("checks vehicle geometry and values", () => {
    assert.equal(validateVehicle(VEHICLES[0]).massKg, 1650);
    assert.throws(() => validateVehicle({ ...VEHICLES[0], massKg: -1 }));
    assert.throws(() => validateVehicle({ ...VEHICLES[0], lengthM: 2.5, wheelbaseM: 3 }));
  });
});

import { normalizeTelemetry } from "../lib/simulation/adapter";
describe("bridge normalization", () => {
  it("normalizes speed, pedal scale, steering sign and reverse gear", () => {
    const f = normalizeTelemetry({ timestampMs: 100, speedKmh: 18, steeringWheelDeg: -30, acceleratorPercent: 20, brakePercent: 10, gear: "r" }, -1);
    assert.equal(f.speedMps, -5); assert.equal(f.throttle, 0.2); assert.equal(f.brake, 0.1); assert.equal(f.steeringWheelDeg, 30); assert.equal(f.gear, "R");
  });
  it("normalizes clockwise heading degrees and retains local coordinates", () => {
    const f = normalizeTelemetry({ timestampMs: 100, speedKmh: 0, steeringWheelDeg: 0, acceleratorPercent: 0, brakePercent: 0, gear: "p", gps: { localX: 10, localY: 20, headingClockwiseDeg: 90 } });
    assert.equal(f.gpsX, 10); assert.equal(f.gpsY, 20); assert.equal(f.gpsHeadingRad, Math.PI / 2);
  });
});

describe("multi-floor surfaces", () => {
  it("expands each floor to ten times the original area", () => {
    assert.equal(WORLD.width * WORLD.height, 120 * 88 * 10);
    assert.equal(WORLD.undergroundFloors, 2);
  });
  it("drives down and reverses back up every ramp with continuous height", () => {
    for (const r of RAMPS) {
      const direction = Math.sign(r.end.y - r.start.y);
      let p = { ...initialPhysics(), x: r.start.x, y: r.start.y - direction * 4, heading: direction * Math.PI / 2, level: r.from, z: -r.from * 3.2 };
      let lastZ = p.z;
      for (let n = 0; n < 120 * 30 && p.level === r.from; n++) {
        const c = { ...controls, throttle: p.speed < 3 ? 0.3 : 0, brake: p.speed > 3.1 ? 0.2 : 0 };
        p = stepPhysics(p, c, DEFAULT_CONFIG);
        assert.ok(Math.abs(p.z - lastZ) < .01); lastZ = p.z;
      }
      assert.equal(p.level, r.to, r.id); assert.equal(p.rampId, null); assert.equal(p.collisions, 0);
      assert.ok(Math.abs(p.z + r.to * 3.2) < 1e-9);
      // Stop on the exit apron, then back up the same slope in R.
      p = { ...p, speed: 0, y: r.end.y + direction * 4 };
      for (let n = 0; n < 120 * 40 && p.level === r.to; n++) {
        p = stepPhysics(p, { ...controls, gear: "R", throttle: p.speed > -3 ? .5 : .25, brake: p.speed < -3.1 ? .3 : 0 }, DEFAULT_CONFIG);
        assert.ok(Math.abs(p.z - lastZ) < .01); lastZ = p.z;
      }
      assert.equal(p.level, r.from, `${r.id} reverse ascent`); assert.equal(p.rampId, null); assert.equal(p.collisions, 0);
      assert.ok(Math.abs(p.z + r.from * 3.2) < 1e-9);
    }
  });
  it("does not change floor at unrelated XY positions or a disconnected ramp", () => {
    const p = { x: 24, y: 212, z: -3.2, level: 1 as const, rampId: null };
    assert.deepEqual(resolveSurface(p, { x: 24, y: 208 }), { z: -3.2, level: 1, rampId: null });
    assert.equal(resolveSurface({ ...p, level: 2, z: -6.4 }, { x: 25, y: 211 }).level, 2);
  });
  it("blocks wrong-end entry and sideways escape from a ramp", () => {
    let p = { ...initialPhysics(), x: 24, y: 250, heading: Math.PI / 2, speed: 3 };
    for (let n = 0; n < 120 * 8; n++) p = stepPhysics(p, { ...controls, throttle: .3 }, DEFAULT_CONFIG);
    assert.equal(p.level, 0); assert.equal(p.rampId, null); assert.ok(p.collisions > 0);
    p = { ...initialPhysics(), x: 24, y: 280, z: -1.6, rampId: "R1", heading: 0, speed: 3 };
    for (let n = 0; n < 120 * 8; n++) p = stepPhysics(p, { ...controls, throttle: .3 }, DEFAULT_CONFIG);
    assert.equal(p.rampId, "R1"); assert.ok(p.x < 30); assert.ok(p.collisions > 0); assert.equal(p.z, -1.6);
    assert.equal(intersectsObstacle(p, DEFAULT_CONFIG.vehicle), false);
  });
  it("isolates parked-car collisions to their floor", () => {
    const p = { ...initialPhysics(), x: 50, y: 59, heading: 0 };
    assert.equal(intersectsObstacle(p, DEFAULT_CONFIG.vehicle), false);
    assert.equal(intersectsObstacle({ ...p, level: 1, z: -3.2 }, DEFAULT_CONFIG.vehicle), true);
  });
  it("uses the ramp direction, including cross-slope and ascent, for gravity", () => {
    const p = { ...initialPhysics(), rampId: "R1", y: 280 };
    assert.ok(surfaceGrade(p) < 0);
    assert.ok(surfaceGrade({ ...p, heading: Math.PI / 2 }) > 0);
    assert.ok(Math.abs(surfaceGrade({ ...p, heading: 0 })) < 1e-10);
  });
  it("turns GPS off underground and restores it only after exiting at ground", () => {
    const s = complete({ ...DEFAULT_CONFIG, scenario: "uphill" }).state;
    assert.equal(s.frame.gpsAvailable, true); assert.equal(s.physics.level, 0);
    assert.ok(s.rows.filter(r => r.z < -0.1).every(r => !r.gps));
    assert.ok(s.events.some(e => e.text.includes("GPS 재수신")));
  });
});

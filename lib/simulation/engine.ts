import type { Config, Controls, SensorFrame, Snapshot, SimEvent, Point } from "./types";
import { DEFAULT_CONFIG, FIXED_DT, initialPhysics, stepPhysics } from "./physics";
import { initialEstimate, stepEstimate } from "./estimator";
import { angleWrap, clamp, distance, floorLabel, levelFromZ, levelName, PARKING_TARGET, scenarioRoute, WORLD } from "./world";
import { PARKING_APPROACH_M, ParkingController } from "./parking";
import { validateFrame } from "./data";
import type { RoutePoint } from "./world";
const MAX_SAMPLES = 18000;
export class Simulation {
  config: Config;
  state: Snapshot;
  samples: SensorFrame[] = [];
  private ticks = 0;
  private seed = 42;
  private routeIndex = 1;
  private route: RoutePoint[];
  private remainingRoute: number[];
  private parking: ParkingController | null;
  get routeLength() { return this.route.reduce((total, p, i) => total + (i ? distance(p, this.route[i - 1]) : 0), 0); }
  private parkedTime = 0;
  private squaredError = 0;
  private errorCount = 0;
  private lastTimestamp: number | null = null;
  private firstTimestamp = 0;
  private wheelTravel = 0;
  private turnTravel = 0;
  private absoluteTravel = 0;
  private throttleIntegral = 0;
  private brakeIntegral = 0;
  constructor(config = DEFAULT_CONFIG, source: Snapshot["source"] = "simulation") {
    this.config = structuredClone(config);
    this.route = scenarioRoute(config.scenario);
    this.remainingRoute = new Array(this.route.length).fill(0);
    for (let i = this.route.length - 2; i >= 0; i--) this.remainingRoute[i] = this.remainingRoute[i + 1] + distance(this.route[i], this.route[i + 1]);
    this.parking = config.scenario === "garage" ? new ParkingController(this.route, PARKING_TARGET) : null;
    const physics = initialPhysics(config.scenario);
    const estimate = { ...initialEstimate(), x: physics.x, y: physics.y, z: physics.z, heading: physics.heading };
    const controls: Controls = { throttle: 0, brake: 0, steeringWheelDeg: 0, gear: "D" };
    this.state = { time: 0, physics, estimate, controls,
      frame: { ...controls, timestampMs: 0, speedMps: 0, wheelDistanceM: 0, yawRateRadps: 0,
        gpsAvailable: source === "simulation" && (config.gpsMode === "on" || config.gpsMode === "auto" && physics.level === 0),
        ...(source === "simulation" && (config.gpsMode === "on" || config.gpsMode === "auto" && physics.level === 0) ? { gpsX: physics.x, gpsY: physics.y, gpsHeadingRad: physics.heading } : {}) },
      truth: [], trace: [], rows: [], events: [{ time: 0, text: source === "simulation" ? "시작 위치·층 기준점 설정 · 합성 센서 준비" : "외부 센서 입력 · 정답 위치 없음", kind: "info" }],
      parked: null, complete: false, error: source === "simulation" ? 0 : null, rmse: null, maxError: null, source };
    if (source === "simulation") this.samples.push({ ...this.state.frame });
  }
  private random() { this.seed = (Math.imul(1664525, this.seed) + 1013904223) >>> 0; return this.seed / 4294967296 * 2 - 1; }
  event(text: string, kind: SimEvent["kind"] = "info") {
    this.state.events.push({ time: this.state.time, text, kind });
    if (this.state.events.length > 80) this.state.events.shift();
  }
  private driver(): Controls {
    const p = this.state.physics;
    let nearest = this.routeIndex;
    for (let i = this.routeIndex; i < Math.min(this.route.length, this.routeIndex + 25); i++) {
      const score = (q: RoutePoint) => distance(p, q) + Math.abs(p.z - q.z) * 4;
      if (score(this.route[i]) < score(this.route[nearest])) nearest = i;
    }
    this.routeIndex = nearest;
    if (this.parking && (this.parking.engaged || this.remainingRoute[nearest] <= PARKING_APPROACH_M && p.level === PARKING_TARGET.level && !p.rampId)) {
      return this.parking.step(p, this.config);
    }
    let targetIndex = nearest, ahead = 0;
    const lookAhead = clamp(Math.abs(p.speed) * 0.7 + 2, 2.8, 5);
    while (targetIndex < this.route.length - 1 && ahead < lookAhead) { ahead += distance(this.route[targetIndex], this.route[targetIndex + 1]); targetIndex++; }
    const target: Point = this.route[targetIndex];
    const d = distance(p, target);
    const headingError = angleWrap(Math.atan2(target.y - p.y, target.x - p.x) - p.heading);
    const steeringLimit = Math.min(720, this.config.vehicle.steeringRatio * 0.6 * 180 / Math.PI);
    const steering = clamp(Math.atan2(2 * this.config.vehicle.wheelbaseM * Math.sin(headingError), Math.max(d, 2)) * 180 / Math.PI * this.config.vehicle.steeringRatio, -steeringLimit, steeringLimit);
    const final = targetIndex === this.route.length - 1;
    if (final && d < 0.45 && Math.abs(p.speed) < 0.12) return { throttle: 0, brake: 1, steeringWheelDeg: 0, gear: "P" };
    const targetSpeed = final ? Math.min(3, Math.sqrt(Math.max(0, d - 0.2) * 1.6)) : Math.abs(headingError) > 0.25 ? 2.2 : p.rampId ? 3 : 4.2;
    const delta = targetSpeed - p.speed;
    // The driver may use the navigation estimate, never a virtual attitude sensor.
    const feedForward = this.config.vehicle.rollingCoefficient * 9.80665 + 9.80665 * Math.sin(this.state.estimate.gradeRad);
    const force = this.config.vehicle.massKg * (delta * 1.5 + feedForward);
    return { throttle: clamp(force / this.config.vehicle.maxDriveForceN, 0, 0.7), brake: clamp(-force / this.config.vehicle.maxBrakeForceN, 0, 0.65), steeringWheelDeg: steering, gear: "D" };
  }
  step() {
    if (this.state.complete || this.state.source !== "simulation") return;
    this.state.controls = this.driver();
    const previousPhysics = this.state.physics;
    const wasCollided = this.state.physics.collided;
    const previousLevel = this.state.physics.level, previousRamp = this.state.physics.rampId;
    this.state.physics = stepPhysics(this.state.physics, this.state.controls, this.config);
    const nextPhysics = this.state.physics;
    // Virtual wheel encoder and body gyro. Collisions reject the physical step, so no travel is measured.
    const travel = nextPhysics.collided ? 0 : (previousPhysics.speed + nextPhysics.speed) / 2 * FIXED_DT;
    this.wheelTravel += travel;
    this.absoluteTravel += Math.abs(travel);
    // Average driver inputs only; never pass ramp geometry or true grade to navigation.
    this.throttleIntegral += this.state.controls.throttle * FIXED_DT;
    this.brakeIntegral += this.state.controls.brake * FIXED_DT;
    this.turnTravel += angleWrap(nextPhysics.heading - previousPhysics.heading);
    if (this.state.physics.rampId && !previousRamp) this.event(`${this.state.physics.rampId} 슬로프 진입 · 높이 변화 중`);
    if (previousLevel !== this.state.physics.level) this.event(`${levelName(this.state.physics.level)} 도착 · 물리 모델 층 전환`, "success");
    this.ticks++; this.state.time = this.ticks * FIXED_DT;
    if (this.state.physics.collided && !wasCollided) this.event("장애물 접촉 · 차량 정지", "warning");
    if (this.ticks % 6) return;
    const p = this.state.physics, n = this.config.noise;
    const gpsAvailable = this.config.gpsMode === "on" || this.config.gpsMode === "auto" && p.level === 0 && !p.rampId;
    const speedMps = Math.abs(p.speed) < 0.01 ? 0 : p.speed * (1 + this.config.speedBiasPct / 100) + this.random() * n * 0.025;
    const frame: SensorFrame = {
      ...this.state.controls, timestampMs: Math.round(this.state.time * 1000),
      speedMps,
      steeringWheelDeg: this.state.controls.steeringWheelDeg + this.config.steeringBiasDeg + this.random() * n * 0.3,
      wheelDistanceM: this.wheelTravel * (1 + this.config.speedBiasPct / 100) + (this.absoluteTravel > 0 ? this.random() * n * 0.0005 : 0),
      yawRateRadps: this.turnTravel / 0.05 + (this.config.gyroBiasDegps + this.random() * n * 0.08) * Math.PI / 180,
      intervalThrottle: this.throttleIntegral / 0.05,
      intervalBrake: this.brakeIntegral / 0.05,
      accelerationMps2: (speedMps - this.state.frame.speedMps) / 0.05,
      gpsAvailable, ...(gpsAvailable ? { gpsX: p.x + this.random() * n * 0.5, gpsY: p.y + this.random() * n * 0.5, gpsHeadingRad: p.heading + this.random() * n * 0.005 } : {}),
    };
    this.wheelTravel = 0; this.turnTravel = 0; this.absoluteTravel = 0; this.throttleIntegral = 0; this.brakeIntegral = 0;
    this.consume(frame, 0.05);
    if (this.state.parked) { this.state.complete = true; this.event("자동 시연 완료 · 주차 위치를 기록했습니다", "success"); }
    if (this.state.time >= 3600) { this.state.complete = true; this.event("최대 실험 시간 60분 도달", "warning"); }
  }
  ingest(value: unknown) {
    const frame = validateFrame(value);
    if (this.lastTimestamp !== null && (frame.timestampMs <= this.lastTimestamp || frame.timestampMs - this.lastTimestamp > 1000)) throw new Error("시간 역전·중복 또는 1초 초과 데이터 공백입니다. 새 세션으로 연결하세요.");
    if (this.lastTimestamp === null) {
      this.firstTimestamp = frame.timestampMs;
      if (frame.gpsAvailable) {
        this.state.estimate.x = frame.gpsX!; this.state.estimate.y = frame.gpsY!;
        this.state.estimate.heading = frame.gpsHeadingRad ?? this.state.estimate.heading;
        this.state.physics = { ...this.state.physics, x: frame.gpsX!, y: frame.gpsY!, heading: this.state.estimate.heading };
      } else this.event("첫 GPS 없음 · 데모 입구를 상대좌표 원점으로 사용", "warning");
      this.state.estimate.speed = frame.speedMps;
      this.state.physics.speed = frame.speedMps;
      this.state.frame = frame; this.state.controls = frame;
      this.lastTimestamp = frame.timestampMs; this.samples.push(frame); return;
    }
    const dt = (frame.timestampMs - this.lastTimestamp) / 1000;
    this.lastTimestamp = frame.timestampMs;
    this.state.time = (frame.timestampMs - this.firstTimestamp) / 1000;
    // External mode displays only sensor-integrated position, not a made-up reference truth.
    this.state.controls = frame;
    this.consume(frame, dt);
    this.state.physics = { ...this.state.physics, ...this.state.estimate, level: levelFromZ(this.state.estimate.z), rampId: null, acceleration: frame.accelerationMps2 ?? 0, gradeRad: this.state.estimate.gradeRad };
  }
  private consume(frame: SensorFrame, dt: number) {
    const s = this.state;
    if (frame.gpsAvailable !== s.frame.gpsAvailable) this.event(frame.gpsAvailable ? "GPS 재수신 · 위치 보정 시작" : "GPS 수신 중단 · 차량 센서로 경로 기록", frame.gpsAvailable ? "success" : "warning");
    const previousFrame = s.frame;
    s.frame = frame;
    const oldFloor = floorLabel(s.estimate.z);
    s.estimate = stepEstimate(s.estimate, this.config.useGyro ? frame : { ...frame, yawRateRadps: undefined }, this.config.vehicle, dt, this.config.friction, previousFrame);
    if (oldFloor !== floorLabel(s.estimate.z)) this.event(`${floorLabel(s.estimate.z)} 이동 추정 · 층고 3.2m 가정`);
    if (Math.abs(frame.speedMps) < 0.1 && frame.gear === "P") this.parkedTime += dt;
    else { this.parkedTime = 0; s.parked = null; }
    if (this.parkedTime >= 2 && !s.parked) { s.parked = { ...s.estimate }; this.event("P 기어 + 2초 정차 · 주차 위치 기록", "success"); }
    const p = s.physics, e = s.estimate;
    if (s.source === "simulation") {
      s.error = distance(p, e); this.squaredError += s.error ** 2; this.errorCount++;
      s.rmse = Math.sqrt(this.squaredError / this.errorCount); s.maxError = Math.max(s.maxError ?? 0, s.error);
      s.truth.push({ ...p, time: s.time });
    }
    s.trace.push({ ...e, time: s.time });
    this.samples.push(frame);
    s.rows.push({ time: s.time, speed: frame.speedMps, steering: frame.steeringWheelDeg, acceleration: (frame.speedMps - previousFrame.speedMps) / dt, throttle: frame.throttle, brake: frame.brake, gear: frame.gear, gps: frame.gpsAvailable,
      x: s.source === "simulation" ? p.x : NaN, y: s.source === "simulation" ? p.y : NaN, estimatedX: e.x, estimatedY: e.y,
      z: s.source === "simulation" ? p.z : NaN, estimatedZ: e.z, trueGrade: s.source === "simulation" ? p.gradeRad * 180 / Math.PI : NaN, estimatedGrade: e.gradeRad * 180 / Math.PI, error: s.error, uncertainty: e.uncertaintyM,
      headingErrorDeg: s.source === "simulation" ? Math.abs(angleWrap(e.heading - p.heading)) * 180 / Math.PI : null,
      heightErrorM: s.source === "simulation" ? Math.abs(e.z - p.z) : null,
      floorError: s.source === "simulation" ? Math.abs(Math.round(-e.z / WORLD.floorHeight) - Math.round(-p.z / WORLD.floorHeight)) : null });
    for (const array of [s.truth, s.trace, s.rows, this.samples]) if (array.length > MAX_SAMPLES) array.shift();
  }
}

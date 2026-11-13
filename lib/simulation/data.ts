import type { SensorFrame, Vehicle, Snapshot, Config } from "./types";
import { WORLD, RAMPS } from "./world";
import { MAX_SPEED_KMH } from "./physics";
const numeric = (value: unknown, name: string, min: number, max: number) => {
  if (value === "" || value === null || value === undefined || typeof value === "boolean") throw new Error(`${name}: 숫자가 필요합니다.`);
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${name}: ${min}~${max} 범위여야 합니다.`);
  return n;
};
export function validateFrame(value: unknown): SensorFrame {
  if (!value || typeof value !== "object") throw new Error("센서 데이터는 객체여야 합니다.");
  const v = value as Record<string, unknown>;
  const gear = String(v.gear).toUpperCase();
  if (!["P", "R", "N", "D"].includes(gear)) throw new Error("gear: P, R, N, D 중 하나여야 합니다.");
  if (![true, false, "true", "false", 0, 1, "0", "1"].includes(v.gpsAvailable as never)) throw new Error("gpsAvailable: true 또는 false가 필요합니다.");
  const gpsAvailable = [true, "true", 1, "1"].includes(v.gpsAvailable as never);
  const frame: SensorFrame = {
    timestampMs: numeric(v.timestampMs, "timestampMs", 0, Number.MAX_SAFE_INTEGER),
    speedMps: numeric(v.speedMps, "speedMps", -30, 60),
    steeringWheelDeg: numeric(v.steeringWheelDeg, "steeringWheelDeg", -720, 720),
    throttle: numeric(v.throttle, "throttle", 0, 1), brake: numeric(v.brake, "brake", 0, 1),
    gear: gear as SensorFrame["gear"], gpsAvailable,
  };
  if (v.accelerationMps2 !== undefined && v.accelerationMps2 !== "") frame.accelerationMps2 = numeric(v.accelerationMps2, "accelerationMps2", -500, 500);
  if (v.wheelDistanceM !== undefined && v.wheelDistanceM !== "") frame.wheelDistanceM = numeric(v.wheelDistanceM, "wheelDistanceM", -60, 60);
  if (v.yawRateRadps !== undefined && v.yawRateRadps !== "") frame.yawRateRadps = numeric(v.yawRateRadps, "yawRateRadps", -10, 10);
  if (v.intervalThrottle !== undefined && v.intervalThrottle !== "") frame.intervalThrottle = numeric(v.intervalThrottle, "intervalThrottle", 0, 1);
  if (v.intervalBrake !== undefined && v.intervalBrake !== "") frame.intervalBrake = numeric(v.intervalBrake, "intervalBrake", 0, 1);
  if (gpsAvailable || v.gpsX !== undefined && v.gpsX !== "") frame.gpsX = numeric(v.gpsX, "gpsX", -1e6, 1e6);
  if (gpsAvailable || v.gpsY !== undefined && v.gpsY !== "") frame.gpsY = numeric(v.gpsY, "gpsY", -1e6, 1e6);
  if (v.gpsHeadingRad !== undefined && v.gpsHeadingRad !== "") frame.gpsHeadingRad = numeric(v.gpsHeadingRad, "gpsHeadingRad", -Math.PI * 2, Math.PI * 2);
  return frame;
}
export function parseSensorFile(text: string): SensorFrame[] {
  if (text.length > 15_000_000) throw new Error("파일은 15MB 이하로 올려주세요.");
  let values: unknown[];
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const value = JSON.parse(trimmed);
    values = Array.isArray(value) ? value : value.frames;
  } else {
    const lines = trimmed.split(/\r?\n/).filter(l => l.trim());
    const split = (line: string) => line.split(",").map(v => v.trim().replace(/^"(.*)"$/, "$1"));
    const headers = split(lines[0]);
    if (new Set(headers).size !== headers.length) throw new Error("CSV 열 이름이 중복되었습니다.");
    values = lines.slice(1).map(line => {
      const cells = split(line);
      if (cells.length !== headers.length) throw new Error("CSV 열 개수가 일치하지 않습니다.");
      return Object.fromEntries(headers.map((h, i) => [h, cells[i]]));
    });
  }
  if (!Array.isArray(values) || values.length < 2 || values.length > 72000) throw new Error("2~72,000개의 센서 프레임이 필요합니다.");
  const frames = values.map((v, i) => {
    try { return validateFrame(v); } catch (e) { throw new Error(`${i + 1}번째 프레임: ${(e as Error).message}`); }
  });
  frames.forEach((f, i) => {
    if (i && (f.timestampMs <= frames[i - 1].timestampMs || f.timestampMs - frames[i - 1].timestampMs > 1000)) throw new Error(`${i + 1}번째 프레임: 시간은 증가해야 하며 간격은 1초 이하여야 합니다.`);
  });
  return frames;
}
export function validateVehicle(value: unknown): Vehicle {
  if (!value || typeof value !== "object") throw new Error("차량 제원 JSON 객체가 필요합니다.");
  const v = value as Record<string, unknown>;
  if (typeof v.name !== "string" || !v.name.trim() || v.name.length > 40) throw new Error("차량 이름은 1~40자여야 합니다.");
  const vehicle: Vehicle = {
    id: "custom", name: v.name,
    massKg: numeric(v.massKg, "massKg", 700, 5000),
    wheelbaseM: numeric(v.wheelbaseM, "wheelbaseM", 1.8, 4),
    lengthM: numeric(v.lengthM, "lengthM", 2.5, 7), widthM: numeric(v.widthM, "widthM", 1.3, 2.6),
    steeringRatio: numeric(v.steeringRatio, "steeringRatio", 8, 25),
    maxDriveForceN: numeric(v.maxDriveForceN, "maxDriveForceN", 1000, 25000),
    maxBrakeForceN: numeric(v.maxBrakeForceN, "maxBrakeForceN", 3000, 50000),
    dragAreaM2: numeric(v.dragAreaM2, "dragAreaM2", 0.2, 2),
    rollingCoefficient: numeric(v.rollingCoefficient, "rollingCoefficient", 0.005, 0.04),
  };
  if (vehicle.wheelbaseM >= vehicle.lengthM) throw new Error("축거는 전장보다 짧아야 합니다.");
  return vehicle;
}
export const SENSOR_HEADERS = ["timestampMs", "speedMps", "steeringWheelDeg", "throttle", "brake", "gear", "gpsAvailable", "gpsX", "gpsY", "gpsHeadingRad", "wheelDistanceM", "yawRateRadps", "intervalThrottle", "intervalBrake", "accelerationMps2"] as const;
export function sensorCSV(frames: SensorFrame[]) { return [SENSOR_HEADERS.join(","), ...frames.map(f => SENSOR_HEADERS.map(h => f[h] ?? "").join(","))].join("\n"); }
export function resultCSV(s: Snapshot) {
  const columns = ["time", "speed", "steering", "acceleration", "throttle", "brake", "gear", "gps", "x", "y", "estimatedX", "estimatedY", "z", "estimatedZ", "trueGrade", "estimatedGrade", "error", "headingErrorDeg", "heightErrorM", "floorError", "uncertainty"] as const;
  return [columns.join(","), ...s.rows.map(r => columns.map(c => typeof r[c] === "number" && !Number.isFinite(r[c]) ? "" : r[c] ?? "").join(","))].join("\n");
}
export function experimentReport(s: Snapshot, config: Config) {
  return { schemaVersion: 4, product: "SENSE NAV", exportedAt: new Date().toISOString(), source: s.source,
    world: WORLD, ramps: RAMPS, finalActualLevel: s.source === "simulation" ? s.physics.level : null,
    seed: 42, physicsHz: 120, sensorHz: s.source === "simulation" ? 20 : "source timestamps", simulationSpeedLimitKmh: MAX_SPEED_KMH, config,
    durationSeconds: s.time, actualDistanceM: s.source === "simulation" ? s.physics.distance : null, distanceM: s.estimate.distance, horizontalRmseM: s.rmse, maxHorizontalErrorM: s.maxError,
    collisions: s.source === "simulation" ? s.physics.collisions : null, parkingEstimate: s.parked,
    limits: ["합성 데이터의 성능은 실차 검증 결과가 아닙니다.", "이상적 기준은 편향·노이즈가 없는 합성 센서 조건입니다.", "경사는 차량 질량·구동력·제동력·주행 저항 모델과 속도 변화로 추정하며 층고는 3.2m를 가정합니다.", "경사 관측이 어려운 구간에서는 이전 추정값을 유지하므로 고도 오차가 누적될 수 있습니다.", "불확실성 반경은 경험적 지표이며 통계적 신뢰구간이 아닙니다.", "외부 데이터에는 정답 좌표가 없어 위치 오차를 산출하지 않습니다.", "기록은 최근 18,000개 샘플까지 보관합니다."],
    events: s.events, rows: s.rows };
}

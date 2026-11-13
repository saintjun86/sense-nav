export type Gear = "P" | "R" | "N" | "D";
export type Level = 0 | 1 | 2;
export type Point = { x: number; y: number };
export type Pose = Point & { heading: number; z: number };
export type Vehicle = {
  id: string; name: string; massKg: number; wheelbaseM: number;
  lengthM: number; widthM: number; steeringRatio: number;
  maxDriveForceN: number; maxBrakeForceN: number; dragAreaM2: number;
  rollingCoefficient: number;
};
export type Controls = { throttle: number; brake: number; steeringWheelDeg: number; gear: Gear };
export type PhysicsState = Pose & { level: Level; rampId: string | null; speed: number; acceleration: number; distance: number; collisions: number; collided: boolean; gradeRad: number };
export type SensorFrame = Controls & {
  timestampMs: number; speedMps: number; accelerationMps2?: number;
  /** Signed wheel travel and mean yaw rate over the preceding sample interval. */
  wheelDistanceM?: number; yawRateRadps?: number;
  /** Time-averaged pedal commands over the same interval as the speed change. */
  intervalThrottle?: number; intervalBrake?: number;
  gpsAvailable: boolean; gpsX?: number; gpsY?: number; gpsHeadingRad?: number;
};
export type Estimate = Pose & { speed: number; distance: number; uncertaintyM: number; gradeRad: number; gradeObservable: boolean; gpsUsed: boolean; gyroBiasRadps: number; gyroUsed: boolean };
export type Config = {
  vehicle: Vehicle; friction: number; speedBiasPct: number; steeringBiasDeg: number;
  noise: number; gpsMode: "auto" | "on" | "off"; scenario: "garage" | "flat" | "uphill";
  gyroBiasDegps: number; useGyro: boolean;
};
export type TracePoint = Pose & { time: number };
export type LogRow = {
  time: number; speed: number; steering: number; acceleration: number;
  throttle: number; brake: number; gear: Gear; gps: boolean;
  x: number; y: number; estimatedX: number; estimatedY: number;
  z: number; estimatedZ: number; trueGrade: number; estimatedGrade: number;
  error: number | null; uncertainty: number;
  headingErrorDeg: number | null; heightErrorM: number | null; floorError: number | null;
};
export type SimEvent = { time: number; text: string; kind: "info" | "warning" | "success" };
export type Snapshot = {
  time: number; physics: PhysicsState; estimate: Estimate; controls: Controls;
  frame: SensorFrame; truth: TracePoint[]; trace: TracePoint[]; rows: LogRow[];
  events: SimEvent[]; parked: Pose | null; complete: boolean; error: number | null;
  rmse: number | null; maxError: number | null; source: "simulation" | "replay" | "stream";
};

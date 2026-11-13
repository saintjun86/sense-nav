import type { Config, Level, Point, Pose } from "./types";

export const WORLD = { width: 230, height: 115, floorHeight: 3.2, undergroundFloors: 2, version: 6 };
export const LEVELS: Level[] = [0, 1, 2];
export const levelName = (level: number) => level === 0 ? "1F" : `B${level}`;
export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const angleWrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
export const levelFromZ = (z: number) => clamp(Math.round(-z / WORLD.floorHeight), 0, WORLD.undergroundFloors) as Level;
export function floorLabel(z: number) {
  if (z > 1.6) return `지상 ${Math.round(z / WORLD.floorHeight) + 1}F`;
  const undergroundLevel = Math.max(0, Math.round(-z / WORLD.floorHeight));
  return undergroundLevel > WORLD.undergroundFloors ? `B${WORLD.undergroundFloors} 아래` : levelName(undergroundLevel);
}
export const TAU = Math.PI * 2;
export const AISLE_WIDTH = 7;
export const LANE_WIDTH = AISLE_WIDTH / 2;
export const BAY_WIDTH = 2.75;
export const BAY_DEPTH = 5;
export const ROW_PITCH = 17.5;
export const AISLE_Y = Array.from({ length: 6 }, (_, i) => 14 + i * ROW_PITCH);
export const MAIN_AISLE_X = [32, 116, 200];
export const START = { x: 70, y: 12.25, z: 0, heading: Math.PI };
export type Surface = { z: number; level: Level; rampId: string | null };
export type RampCorridor = { shape: "straight"; side: "west" | "east"; name: string; width: number; start: Point; end: Point };
export type Ramp = RampCorridor & { id: string; from: Level; to: Level };
export const RAMP_CORRIDORS: RampCorridor[] = [
  { shape: "straight", side: "west", name: "서측 하행", width: 6.5, start: { x: 16, y: 35 }, end: { x: 16, y: 75 } },
  { shape: "straight", side: "east", name: "동측 상행", width: 6.5, start: { x: 214, y: 75 }, end: { x: 214, y: 35 } },
];
export const RAMPS: Ramp[] = [
  ...LEVELS.slice(0, -1).map(from => ({ ...RAMP_CORRIDORS[0], id: `WD${from + 1}`, from: from as Level, to: (from + 1) as Level })),
  ...LEVELS.slice(1).map(from => ({ ...RAMP_CORRIDORS[1], id: `EU${from}`, from: from as Level, to: (from - 1) as Level })),
];
export const rampLength = (r: RampCorridor) => distance(r.start, r.end);
const rampPosition = (p: Point, r: RampCorridor) => {
  const length = rampLength(r), dx = (r.end.x - r.start.x) / length, dy = (r.end.y - r.start.y) / length;
  return { along: (p.x - r.start.x) * dx + (p.y - r.start.y) * dy, lateral: -(p.x - r.start.x) * dy + (p.y - r.start.y) * dx };
};
export const rampPoint = (r: RampCorridor, t: number): Point => ({ x: r.start.x + (r.end.x - r.start.x) * t, y: r.start.y + (r.end.y - r.start.y) * t });
export const rampProgress = (p: Point, r: RampCorridor) => clamp(rampPosition(p, r).along / rampLength(r), 0, 1);
const flatSurface = (level: Level): Surface => ({ level, rampId: null, z: -level * WORLD.floorHeight || 0 });
const crossesRampGate = (previous: Point, next: Point, r: RampCorridor, at: number, forward: boolean) => {
  const a = rampPosition(previous, r), b = rampPosition(next, r);
  if (!(forward ? a.along <= at && b.along > at : a.along >= at && b.along < at)) return false;
  const t = (at - a.along) / (b.along - a.along);
  return Math.abs(a.lateral + (b.lateral - a.lateral) * t) <= r.width / 2;
};
/** Enter through the start gate, interpolate height along the straight slope, then exit on the destination floor. */
export function resolveSurface(previous: Point & Surface, next: Point): Surface {
  let ramp = RAMPS.find(r => r.id === previous.rampId);
  if (ramp) {
    const along = rampPosition(next, ramp).along;
    if (along <= 0) return flatSurface(ramp.from);
    if (along >= rampLength(ramp)) return flatSurface(ramp.to);
  } else {
    ramp = RAMPS.find(r => r.from === previous.level && crossesRampGate(previous, next, r, 0, true));
    if (!ramp) return flatSurface(previous.level);
  }
  const t = rampProgress(next, ramp);
  return { level: ramp.from, rampId: ramp.id, z: -(ramp.from + (ramp.to - ramp.from) * t) * WORLD.floorHeight };
}
export function surfaceGrade(p: Point & Surface & { heading: number }) {
  const r = RAMPS.find(r => r.id === p.rampId); if (!r) return 0;
  const length = rampLength(r);
  const tangent = ((r.end.x - r.start.x) * Math.cos(p.heading) + (r.end.y - r.start.y) * Math.sin(p.heading)) / length;
  return Math.atan(-(r.to - r.from) * WORLD.floorHeight / length * tangent);
}
/** No reverse entry through an exit, and no entry beyond B2/1F. An active vehicle may back out to its starting floor. */
export function rampEntryBlocked(previous: Point & Surface, next: Point) {
  if (previous.rampId) return false;
  return RAMP_CORRIDORS.some(r => crossesRampGate(previous, next, r, rampLength(r), false)
    || crossesRampGate(previous, next, r, 0, true) && !RAMPS.some(link => link.side === r.side && link.from === previous.level));
}

export type Obstacle = { x: number; y: number; w: number; h: number; kind: "wall" | "island" | "car" | "core" | "building"; flatOnly?: boolean };
export const GROUND_BUILDING: Obstacle = { x: 35.5, y: 17.5, w: 161, h: 80.5, kind: "building" };
// These end walls belong to the ground plane. A vehicle below that plane on a ramp must not hit them.
export const GROUND_RAMP_CAPS: Obstacle[] = RAMP_CORRIDORS.map(r => ({ x: r.start.x - r.width / 2 - 0.6, y: Math.max(r.start.y, r.end.y), w: r.width + 1.2, h: 0.6, kind: "wall", flatOnly: true }));
export type ParkingBlock = { x: number; y: number; w: number; h: number; zone: string; row: number; side: string };
export const PARKING_BLOCKS: ParkingBlock[] = Array.from({ length: 5 }, (_, row) => {
  const y = AISLE_Y[row] + AISLE_WIDTH / 2;
  return [{ x: 35.5, w: 77, side: "A" }, { x: 119.5, w: 77, side: "B" }]
    .map(b => ({ ...b, y, h: 10.5, row, zone: `${b.side}${String(row + 1).padStart(2, "0")}` }));
}).flat();
export type Aisle = { a: Point; b: Point; width: number; oneWay?: boolean };
export const AISLES: Aisle[] = [
  ...AISLE_Y.map(y => ({ a: { x: y < 35 || y > 75 ? 9 : 28.5, y }, b: { x: y < 35 || y > 75 ? 221 : 203.5, y }, width: AISLE_WIDTH })),
  ...MAIN_AISLE_X.map(x => ({ a: { x, y: 10.5 }, b: { x, y: 105 }, width: AISLE_WIDTH })),
  { a: { x: 16, y: 14 }, b: { x: 16, y: 101.5 }, width: 6.5, oneWay: true },
  { a: { x: 214, y: 101.5 }, b: { x: 214, y: 14 }, width: 6.5, oneWay: true },
];
export const GROUND_AISLES: Aisle[] = [
  { a: { x: 9, y: 14 }, b: { x: 221, y: 14 }, width: AISLE_WIDTH },
  { a: { x: 28.5, y: 101.5 }, b: { x: 203.5, y: 101.5 }, width: AISLE_WIDTH },
  ...[32, 200].map(x => ({ a: { x, y: 14 }, b: { x, y: 101.5 }, width: AISLE_WIDTH })),
  { a: { x: 16, y: 14 }, b: { x: 16, y: 35 }, width: 6.5, oneWay: true },
  { a: { x: 214, y: 35 }, b: { x: 214, y: 14 }, width: 6.5, oneWay: true },
];
export const aislesForLevel = (level: Level) => level === 0 ? GROUND_AISLES : AISLES;
export const CORES: Obstacle[] = PARKING_BLOCKS.filter(b => b.row === 2).map(b => ({ x: b.x + 12 * BAY_WIDTH, y: b.y, w: 3 * BAY_WIDTH, h: b.h, kind: "core" }));
export const isCoreBay = (b: ParkingBlock, slot: number) => b.row === 2 && slot >= 12 && slot < 15;
// A single bay-width apron at each row end gives turning vehicles clearance at the two-lane junctions.
export const isTurningBay = (b: ParkingBlock, slot: number) => slot === 0 || slot === Math.round(b.w / BAY_WIDTH) - 1;
export const isParkingBay = (b: ParkingBlock, slot: number) => !isCoreBay(b, slot) && !isTurningBay(b, slot);
export const PARKING_CAPACITY = PARKING_BLOCKS.reduce((sum, b) => sum + Array.from({ length: Math.round(b.w / BAY_WIDTH) }, (_, slot) => isParkingBay(b, slot) ? 2 : 0).reduce<number>((a, n) => a + n, 0), 0);
const walls: Obstacle[] = [
  { x: 4, y: 4, w: WORLD.width - 8, h: 2, kind: "wall" }, { x: 4, y: 4, w: 2, h: WORLD.height - 8, kind: "wall" },
  { x: WORLD.width - 6, y: 4, w: 2, h: WORLD.height - 8, kind: "wall" }, { x: 4, y: WORLD.height - 6, w: WORLD.width - 8, h: 2, kind: "wall" },
  // Full vehicle SAT collision with the two straight sidewalls; the ends stay open for the floor landings.
  ...RAMP_CORRIDORS.flatMap(r => [-1, 1].map(side => ({ x: r.start.x + side * r.width / 2 - (side < 0 ? 0.6 : 0), y: Math.min(r.start.y, r.end.y), w: 0.6, h: rampLength(r), kind: "wall" as const }))),
];
export const obstaclesForLevel = (level: Level): Obstacle[] => [
  ...walls,
  ...(level === 0 ? [GROUND_BUILDING, ...GROUND_RAMP_CAPS] : [
    ...CORES,
    ...PARKING_BLOCKS.flatMap((b, blockIndex): Obstacle[] => [
      { x: b.x, y: b.y + BAY_DEPTH, w: b.w, h: 0.5, kind: "island" },
      ...Array.from({ length: Math.round(b.w / BAY_WIDTH) }, (_, slot) => [0, 1].flatMap(row => {
        // Keep three adjacent bays clear around the B2 demonstration parking destination.
        const reserved = b.side === "A" && b.row === 4 && slot >= 7 && slot <= 9 && row === 1;
        if (reserved || !isParkingBay(b, slot) || (slot * 7 + row * 3 + blockIndex * 5 + level) % 5 >= 2) return [];
        return [{ x: b.x + slot * BAY_WIDTH + (BAY_WIDTH - 1.9) / 2, y: b.y + (row ? 5.5 : 0) + 0.2, w: 1.9, h: 4.6, kind: "car" as const }];
      })).flat(),
    ]),
  ]),
];
export const FLOOR_OBSTACLES = LEVELS.map(obstaclesForLevel);
// Broad phase avoids scanning thousands of parked cars on every physics tick.
const CELL_SIZE = 20;
const OBSTACLE_GRID = FLOOR_OBSTACLES.map(obstacles => {
  const grid = new Map<string, Obstacle[]>();
  for (const o of obstacles) for (let x = Math.floor(o.x / CELL_SIZE); x <= Math.floor((o.x + o.w) / CELL_SIZE); x++) for (let y = Math.floor(o.y / CELL_SIZE); y <= Math.floor((o.y + o.h) / CELL_SIZE); y++) {
    const key = `${x},${y}`; const cell = grid.get(key) ?? []; cell.push(o); grid.set(key, cell);
  }
  return grid;
});
export function collisionObstacles(p: Surface, near?: Point & { radius: number }): Obstacle[] {
  const onSurface = (o: Obstacle) => !p.rampId || !o.flatOnly;
  if (!near) return FLOOR_OBSTACLES[p.level].filter(onSurface);
  const found = new Set<Obstacle>(), grid = OBSTACLE_GRID[p.level];
  for (let x = Math.floor((near.x - near.radius) / CELL_SIZE); x <= Math.floor((near.x + near.radius) / CELL_SIZE); x++) for (let y = Math.floor((near.y - near.radius) / CELL_SIZE); y <= Math.floor((near.y + near.radius) / CELL_SIZE); y++) {
    for (const obstacle of grid.get(`${x},${y}`) ?? []) if (onSurface(obstacle)) found.add(obstacle);
  }
  return [...found];
}

export type RoutePoint = Point & Surface;
/** Circular corner fillets, resampled by distance so the automatic driver has consistent look-ahead. */
function roundedRoute(corners: Point[], radius = 5.5): Point[] {
  const points: Point[] = [corners[0]];
  const line = (a: Point, b: Point) => {
    const n = Math.max(1, Math.ceil(distance(a, b) / 0.65));
    for (let i = 1; i <= n; i++) points.push({ x: a.x + (b.x - a.x) * i / n, y: a.y + (b.y - a.y) * i / n });
  };
  let last = corners[0];
  for (let i = 1; i < corners.length - 1; i++) {
    const a = corners[i - 1], b = corners[i], c = corners[i + 1];
    const incoming = { x: (b.x - a.x) / distance(a, b), y: (b.y - a.y) / distance(a, b) };
    const outgoing = { x: (c.x - b.x) / distance(b, c), y: (c.y - b.y) / distance(b, c) };
    const turn = angleWrap(Math.atan2(outgoing.y, outgoing.x) - Math.atan2(incoming.y, incoming.x));
    if (Math.abs(turn) < 0.001) { line(last, b); last = b; continue; }
    const cut = Math.min(radius * Math.tan(Math.abs(turn) / 2), distance(a, b) * (i === 1 ? 0.95 : 0.45), distance(b, c) * (i === corners.length - 2 ? 0.95 : 0.45));
    const r = cut / Math.tan(Math.abs(turn) / 2), sign = Math.sign(turn);
    const start = { x: b.x - incoming.x * cut, y: b.y - incoming.y * cut };
    const end = { x: b.x + outgoing.x * cut, y: b.y + outgoing.y * cut };
    const center = { x: start.x - incoming.y * sign * r, y: start.y + incoming.x * sign * r };
    line(last, start);
    const angle = Math.atan2(start.y - center.y, start.x - center.x), n = Math.ceil(Math.abs(turn) * r / 0.65);
    for (let k = 1; k <= n; k++) points.push({ x: center.x + r * Math.cos(angle + turn * k / n), y: center.y + r * Math.sin(angle + turn * k / n) });
    last = end;
  }
  line(last, corners.at(-1)!); return points;
}
const floorRoute = (corners: Point[], level: Level): RoutePoint[] => roundedRoute(corners).map(p => ({ ...p, ...flatSurface(level) }));
const slopeRoute = (r: Ramp): RoutePoint[] => {
  const n = Math.ceil(rampLength(r) / 0.65);
  return Array.from({ length: n + 1 }, (_, i) => ({ ...rampPoint(r, i / n), level: i === n ? r.to : r.from, rampId: i === n ? null : r.id, z: -(r.from + (r.to - r.from) * i / n) * WORLD.floorHeight }));
};
const parkingDestination = { x: 35.5 + 8.5 * BAY_WIDTH, y: 95.5 };
export const PARKING_TARGET: Pose & Surface = { ...parkingDestination, heading: -Math.PI / 2, ...flatSurface(LEVELS.at(-1)!) };
const downRoute: RoutePoint[] = floorRoute([START, { x: 16, y: 12.25 }, { x: 16, y: 35 }], 0);
for (const r of RAMPS.filter(r => r.side === "west")) {
  downRoute.push(...slopeRoute(r));
  downRoute.push(...floorRoute(r.to < WORLD.undergroundFloors
    ? [r.end, { x: 16, y: 103.25 }, { x: 33.75, y: 103.25 }, { x: 33.75, y: 12.25 }, { x: 16, y: 12.25 }, r.start]
    : [r.end, { x: 16, y: 103.25 }, { x: parkingDestination.x, y: 103.25 }, parkingDestination], r.to));
}
const DEEPEST_LEVEL = LEVELS.at(-1)!;
const UP_START = { x: 160, y: 103.25, heading: 0, z: -WORLD.undergroundFloors * WORLD.floorHeight };
const upRoute: RoutePoint[] = floorRoute([UP_START, { x: 214, y: 103.25 }, { x: 214, y: 75 }], DEEPEST_LEVEL);
for (const r of RAMPS.filter(r => r.side === "east").reverse()) {
  upRoute.push(...slopeRoute(r));
  upRoute.push(...floorRoute(r.to > 0
    ? [r.end, { x: 214, y: 12.25 }, { x: 198.25, y: 12.25 }, { x: 198.25, y: 103.25 }, { x: 214, y: 103.25 }, r.start]
    : [r.end, { x: 214, y: 12.25 }, { x: 160, y: 12.25 }], r.to));
}
const flatRoute = floorRoute([{ x: 70, y: 68.25 }, { x: 114.25, y: 68.25 }, { x: 114.25, y: 103.25 }, { x: 201.75, y: 103.25 }, { x: 201.75, y: 12.25 }, { x: 30.25, y: 12.25 }, { x: 30.25, y: 68.25 }, { x: 75, y: 68.25 }], 1);
export const ROUTE = downRoute;
export function scenarioRoute(scenario: Config["scenario"]): RoutePoint[] { return scenario === "uphill" ? upRoute : scenario === "flat" ? flatRoute : downRoute; }
export function scenarioStart(scenario: Config["scenario"]): Pose & Surface {
  if (scenario === "uphill") return { ...UP_START, ...flatSurface(DEEPEST_LEVEL) };
  if (scenario === "flat") return { x: 70, y: 68.25, heading: 0, ...flatSurface(1) };
  return { ...START, ...flatSurface(0) };
}

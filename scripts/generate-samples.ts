import { mkdirSync, writeFileSync } from "node:fs";
import { Simulation } from "../lib/simulation/engine";
import { DEFAULT_CONFIG } from "../lib/simulation/physics";
import { experimentReport, sensorCSV } from "../lib/simulation/data";
mkdirSync("public/data", { recursive: true });
const baseline = new Simulation(); for (let i = 0; i < 900 * 120 && !baseline.state.complete; i++) baseline.step();
if (!baseline.state.complete) throw new Error("Baseline did not complete");
writeFileSync("public/data/sample-sensors.csv", sensorCSV(baseline.samples));
writeFileSync("public/data/vehicle-profile.json", JSON.stringify(DEFAULT_CONFIG.vehicle, null, 2));
const experiments = [
  { name: "baseline", patch: {} },
  { name: "gps-on", patch: { gpsMode: "on" as const } },
  { name: "high-bias", patch: { gpsMode: "off" as const, speedBiasPct: 3, steeringBiasDeg: 4 } },
  { name: "uphill", patch: { scenario: "uphill" as const } },
  { name: "flat", patch: { scenario: "flat" as const } },
].map(({ name, patch }) => {
  const config = { ...DEFAULT_CONFIG, ...patch }; const sim = new Simulation(config);
  for (let i = 0; i < 900 * 120 && !sim.state.complete; i++) sim.step();
  const report = experimentReport(sim.state, config);
  const summary = { ...report, rows: undefined };
  return { name, ...summary, finalHorizontalErrorM: sim.state.error, actualElevationM: sim.state.physics.z, estimatedElevationM: sim.state.estimate.z, complete: sim.state.complete };
});
writeFileSync("public/data/benchmark.json", JSON.stringify(experiments, null, 2));
console.log(JSON.stringify(experiments.map(e => ({ scenario: e.name, durationSeconds: e.durationSeconds, rmseM: e.horizontalRmseM, finalErrorM: e.finalHorizontalErrorM, collisions: e.collisions, complete: e.complete })), null, 2));

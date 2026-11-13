import { createRequire } from "node:module";
import { Simulation } from "../lib/simulation/engine";
const require = createRequire(import.meta.url);
const { WebSocketServer, WebSocket } = require("ws");
const sim = new Simulation();
for (let i = 0; i < 900 * 120 && !sim.state.complete; i++) sim.step();
if (!sim.state.complete) throw new Error("Synthetic drive did not complete");
// Loopback only. This server emits synthetic data; it never connects to a real vehicle.
const server = new WebSocketServer({ host: "127.0.0.1", port: 8788 });
server.on("listening", () => console.log("합성 센서 브리지: ws://127.0.0.1:8788 · 웹의 데이터 연결에서 연결하세요."));
server.on("connection", (socket: { readyState: number; send: (s: string) => void; close: () => void; on: (event: string, cb: () => void) => void }) => {
  let index = 0;
  const timer = setInterval(() => {
    if (socket.readyState !== WebSocket.OPEN) { clearInterval(timer); return; }
    if (index >= sim.samples.length) { clearInterval(timer); socket.close(); return; }
    socket.send(JSON.stringify(sim.samples[index++]));
  }, 50);
  socket.on("close", () => clearInterval(timer));
});
server.on("error", (e: Error) => { console.error(e.message); process.exitCode = 1; });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { server.clients.forEach((client: { terminate: () => void }) => client.terminate()); server.close(() => process.exit(0)); });

"use client";
import { useEffect, useRef } from "react";
import type { Config, Level, Point, Snapshot } from "@/lib/simulation/types";
import { aislesForLevel, BAY_DEPTH, BAY_WIDTH, FLOOR_OBSTACLES, GROUND_BUILDING, GROUND_RAMP_CAPS, isParkingBay, levelFromZ, levelName, PARKING_BLOCKS, PARKING_CAPACITY, RAMPS, RAMP_CORRIDORS, rampLength, rampPoint, rampProgress, scenarioRoute, scenarioStart, TAU, WORLD } from "@/lib/simulation/world";

export type MapView = "driving" | "overview";

export default function MapCanvas({ state, showPlan, zoom, view, level, scenario, vehicleLength, vehicleWidth }: {
  state: Snapshot; showPlan: boolean; zoom: number; view: MapView; level: Level;
  scenario: Config["scenario"]; vehicleLength: number; vehicleWidth: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    const draw = () => {
      const { width, height } = canvas.getBoundingClientRect();
      if (!width || !height) return;
      const style = getComputedStyle(canvas), color = (name: string) => style.getPropertyValue(name).trim();
      const palette = { brand: color("--brand"), active: color("--active-blue"), sky: color("--sky-blue"), background: color("--map-bg"), surface: color("--map-surface"), border: color("--map-border"), text: color("--on-dark") };
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      ctx.scale(dpr, dpr); ctx.fillStyle = palette.background; ctx.fillRect(0, 0, width, height);
      const car = state.source === "simulation" ? state.physics : state.estimate;
      const driving = view === "driving";
      const scale = Math.max(.1, driving ? Math.min(width / 65, height / 70) : Math.min((width - 40) / WORLD.width, (height - 165) / WORLD.height)) * zoom;
      const cx = driving ? car.x : WORLD.width / 2, cy = driving ? car.y : WORLD.height / 2;
      const anchorX = width / 2, anchorY = driving ? height * .78 : height / 2 + 36;
      // World headings use +x as forward. This rotation keeps the car facing screen-up.
      const rotation = driving ? -Math.PI / 2 - car.heading : 0;
      const cos = Math.cos(rotation), sin = Math.sin(rotation);
      const screenToWorld = (x: number, y: number) => ({
        x: cx + (cos * (x - anchorX) + sin * (y - anchorY)) / scale,
        y: cy + (-sin * (x - anchorX) + cos * (y - anchorY)) / scale,
      });
      const viewport = [screenToWorld(0, 0), screenToWorld(width, 0), screenToWorld(width, height), screenToWorld(0, height)];
      const bounds = { left: Math.min(...viewport.map(p => p.x)), right: Math.max(...viewport.map(p => p.x)), top: Math.min(...viewport.map(p => p.y)), bottom: Math.max(...viewport.map(p => p.y)) };
      const visible = (x: number, y: number, w: number, h: number) => x + w > bounds.left && x < bounds.right && y + h > bounds.top && y < bounds.bottom;
      ctx.save(); ctx.translate(anchorX, anchorY); ctx.rotate(rotation); ctx.scale(scale, scale); ctx.translate(-cx, -cy);
      const text = (label: string, x: number, y: number, size = 3, fill = palette.sky, align: CanvasTextAlign = "left") => {
        // Keep map labels upright while the roads rotate around the vehicle.
        ctx.save(); ctx.translate(x, y); ctx.rotate(-rotation);
        ctx.fillStyle = fill; ctx.font = `500 ${driving ? Math.min(size, 18 / scale) : size}px -apple-system, BlinkMacSystemFont, sans-serif`; ctx.textAlign = align; ctx.fillText(label, 0, 0); ctx.restore();
      };
      const arrow = (x: number, y: number, heading: number, size = 1.2, fill = palette.sky) => {
        ctx.save(); ctx.translate(x, y); ctx.rotate(heading); ctx.strokeStyle = fill; ctx.lineWidth = 0.25;
        ctx.beginPath(); ctx.moveTo(-size, 0); ctx.lineTo(size, 0); ctx.moveTo(0, -size * .65); ctx.lineTo(size, 0); ctx.lineTo(0, size * .65); ctx.stroke(); ctx.restore();
      };
      ctx.fillStyle = palette.surface; ctx.fillRect(6, 6, WORLD.width - 12, WORLD.height - 12);
      // Ground roads run around the building; underground floors keep their parking aisles.
      const aisles = aislesForLevel(level);
      for (const aisle of aisles) {
        ctx.beginPath(); ctx.moveTo(aisle.a.x, aisle.a.y); ctx.lineTo(aisle.b.x, aisle.b.y); ctx.strokeStyle = "#102F53"; ctx.lineWidth = aisle.width; ctx.lineCap = "butt"; ctx.stroke();
      }
      for (const aisle of aisles) {
        const horizontal = aisle.a.y === aisle.b.y;
        const length = Math.hypot(aisle.b.x - aisle.a.x, aisle.b.y - aisle.a.y);
        if (!aisle.oneWay) {
          ctx.strokeStyle = "#AACAE6AA"; ctx.lineWidth = 0.18; ctx.setLineDash([1.6, 1.7]); ctx.beginPath(); ctx.moveTo(aisle.a.x, aisle.a.y); ctx.lineTo(aisle.b.x, aisle.b.y); ctx.stroke(); ctx.setLineDash([]);
          for (let d = 18; d < length - 7; d += 42) {
            if (horizontal) { arrow(aisle.a.x + d, aisle.a.y + 1.75, 0); arrow(aisle.a.x + d + 5, aisle.a.y - 1.75, Math.PI); }
            else { arrow(aisle.a.x - 1.75, aisle.a.y + d, Math.PI / 2); arrow(aisle.a.x + 1.75, aisle.a.y + d + 5, -Math.PI / 2); }
          }
        }
      }
      if (level > 0) {
        for (const block of PARKING_BLOCKS) {
          const { x, y, w, h, zone } = block; if (!visible(x, y, w, h)) continue;
          ctx.fillStyle = block.side === "A" ? "#093B68" : block.side === "B" ? "#173C68" : "#12375F"; ctx.fillRect(x, y, w, h);
          ctx.fillStyle = "#102F53"; ctx.fillRect(x, y, BAY_WIDTH, h); ctx.fillRect(x + w - BAY_WIDTH, y, BAY_WIDTH, h);
          ctx.strokeStyle = "#688FB5"; ctx.lineWidth = 0.15;
          for (let slot = 0; slot < Math.round(w / BAY_WIDTH); slot++) {
            if (!isParkingBay(block, slot)) continue;
            for (const row of [0, 1]) {
              const py = y + (row ? 5.5 : 0), px = x + slot * BAY_WIDTH;
              ctx.strokeRect(px, py, BAY_WIDTH, BAY_DEPTH);
            }
          }
        }
      }
      for (const o of FLOOR_OBSTACLES[level]) {
        if (!visible(o.x, o.y, o.w, o.h)) continue;
        if (o.kind === "building") {
          ctx.fillStyle = "#173C68"; ctx.fillRect(o.x, o.y, o.w, o.h);
          ctx.strokeStyle = palette.sky; ctx.lineWidth = .5; ctx.strokeRect(o.x, o.y, o.w, o.h);
          ctx.strokeStyle = "#42658C"; ctx.lineWidth = .3; ctx.strokeRect(o.x + 3, o.y + 3, o.w - 6, o.h - 6);
          text("지상 건물", o.x + o.w / 2, o.y + o.h / 2 - 1, 7, palette.sky, "center");
          text("1F · 외곽도로로 통행", o.x + o.w / 2, o.y + o.h / 2 + 7, 3.2, palette.sky, "center");
          continue;
        }
        ctx.fillStyle = o.kind === "wall" ? "#6988AA" : o.kind === "island" ? "#31597F" : o.kind === "core" ? "#6285AA" : "#527AA5";
        ctx.beginPath(); ctx.roundRect(o.x, o.y, o.w, o.h, o.kind === "car" ? 0.35 : 0.1); ctx.fill();
        if (o.kind === "car" && scale > 1.1) { ctx.fillStyle = palette.background; ctx.fillRect(o.x + .2, o.y + 1, o.w - .4, .7); ctx.fillRect(o.x + .2, o.y + 3.2, o.w - .4, .5); }
        if (o.kind === "core") text("LIFT", o.x + o.w / 2, o.y + o.h / 2 + .8, 2, palette.text, "center");
      }
      if (level > 0) for (const b of PARKING_BLOCKS) {
        if (!visible(b.x, b.y, b.w, b.h)) continue;
        ctx.fillStyle = "#002C5FDD"; ctx.fillRect(b.x + b.w / 2 - 5, b.y + 3.75, 10, 3);
        text(b.zone, b.x + b.w / 2, b.y + 6, 2.2, palette.sky, "center");
      }
      const activeRamp = RAMPS.find(r => r.id === state.physics.rampId);
      for (const ramp of RAMP_CORRIDORS) {
        const outgoing = RAMPS.find(r => r.side === ramp.side && r.from === level);
        const active = activeRamp?.side === ramp.side && (activeRamp.from === level || activeRamp.to === level);
        const rampColor = ramp.side === "west" ? palette.sky : palette.active;
        const length = rampLength(ramp), heading = Math.atan2(ramp.end.y - ramp.start.y, ramp.end.x - ramp.start.x);
        ctx.save(); ctx.translate(ramp.start.x, ramp.start.y); ctx.rotate(heading);
        ctx.fillStyle = "#214C76"; ctx.fillRect(0, -ramp.width / 2, length, ramp.width);
        ctx.strokeStyle = rampColor; ctx.lineWidth = .35; ctx.beginPath(); ctx.moveTo(0, -ramp.width / 2); ctx.lineTo(length, -ramp.width / 2); ctx.moveTo(0, ramp.width / 2); ctx.lineTo(length, ramp.width / 2); ctx.stroke();
        ctx.strokeStyle = "#AACAE64D"; ctx.lineWidth = .18;
        for (let d = 4; d < length; d += 4) { ctx.beginPath(); ctx.moveTo(d, -ramp.width / 2); ctx.lineTo(d - 1.4, ramp.width / 2); ctx.stroke(); }
        if (active && activeRamp) { ctx.strokeStyle = palette.text; ctx.lineWidth = .65; ctx.beginPath(); ctx.moveTo(0, -ramp.width / 2 + .7); ctx.lineTo(length * rampProgress(state.physics, activeRamp), -ramp.width / 2 + .7); ctx.stroke(); }
        if (!outgoing || level === 0) {
          const cap = level === 0 && ramp.side === "west" ? length : 0;
          ctx.strokeStyle = palette.sky; ctx.lineWidth = .7; ctx.beginPath(); ctx.moveTo(cap, -ramp.width / 2); ctx.lineTo(cap, ramp.width / 2); ctx.stroke();
        }
        ctx.restore();
        for (const t of [.2, .5, .8]) { const p = rampPoint(ramp, t); arrow(p.x, p.y, heading, 1.7, rampColor); }
        const west = ramp.side === "west", labelY = west || level === 0 ? 23 : 91;
        text(ramp.name, ramp.start.x, labelY, 3.1, rampColor, "center");
        text(level === 0 && !west ? "B1 → 1F 출구" : outgoing ? `${levelName(outgoing.from)} → ${levelName(outgoing.to)}` : "진입 금지", ramp.start.x, labelY + 4.5, 2.6, palette.text, "center");
        if (level === 0) text("1F 연결 없음", ramp.start.x, 82, 2.3, palette.sky, "center");
        else text(`${length} m / 8%`, ramp.end.x, west ? 87 : 30, 2.3, palette.sky, "center");
      }
      const path = (points: (Point & { z?: number })[], fill: string, strokeWidth: number, dashed = false) => {
        ctx.beginPath(); ctx.strokeStyle = fill; ctx.lineWidth = strokeWidth / scale; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.setLineDash(dashed ? [4 / scale, 4 / scale] : []);
        let started = false; const stride = Math.max(1, Math.floor(points.length / 3000));
        for (let i = 0; i < points.length; i += stride) { const p = points[i]; if (p.z !== undefined && levelFromZ(p.z) !== level) { started = false; continue; } if (started) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); started = true; }
        ctx.stroke(); ctx.setLineDash([]);
      };
      if (showPlan) path(scenarioRoute(scenario), "#AACAE655", 1, true);
      path(state.trace, palette.active, 2.3);
      const start = scenarioStart(scenario);
      if (start.level === level) { ctx.beginPath(); ctx.arc(start.x, start.y, 3 / scale, 0, TAU); ctx.fillStyle = palette.text; ctx.fill(); }
      const e = state.estimate;
      if (levelFromZ(e.z) === level) { ctx.beginPath(); ctx.arc(e.x, e.y, Math.min(e.uncertaintyM + 2, 35), 0, TAU); ctx.fillStyle = "#00AAD214"; ctx.fill(); ctx.strokeStyle = "#00AAD250"; ctx.lineWidth = .7 / scale; ctx.stroke(); ctx.beginPath(); ctx.arc(e.x, e.y, 3 / scale, 0, TAU); ctx.fillStyle = palette.active; ctx.fill(); }
      const carVisible = state.source === "simulation" ? state.physics.level === level || !!activeRamp && (activeRamp.from === level || activeRamp.to === level) : levelFromZ(e.z) === level;
      if (carVisible) {
        ctx.save(); ctx.translate(car.x, car.y); ctx.rotate(car.heading);
        const length = Math.max(vehicleLength, (driving ? 28 : 12) / scale), bodyWidth = Math.max(vehicleWidth, (driving ? 13 : 6) / scale);
        ctx.shadowColor = palette.sky; ctx.shadowBlur = 8; ctx.fillStyle = palette.text; ctx.beginPath(); ctx.roundRect(-length / 2, -bodyWidth / 2, length, bodyWidth, 1 / scale); ctx.fill(); ctx.shadowBlur = 0;
        ctx.fillStyle = palette.brand; ctx.fillRect(length * .05, -bodyWidth * .37, length * .19, bodyWidth * .74); ctx.fillRect(-length * .3, -bodyWidth * .37, length * .12, bodyWidth * .74);
        ctx.beginPath(); ctx.moveTo(length / 2 + 6 / scale, 0); ctx.lineTo(length / 2 + 2 / scale, -3 / scale); ctx.lineTo(length / 2 + 2 / scale, 3 / scale); ctx.closePath(); ctx.fillStyle = palette.text; ctx.fill(); ctx.restore();
      }
      if (state.parked && levelFromZ(state.parked.z) === level) text("P · 주차 기록", state.parked.x, state.parked.y - 6, 11 / scale, palette.sky, "center");
      ctx.restore();
      const insetWidth = Math.min(132, width * .32), insetHeight = insetWidth * WORLD.height / WORLD.width;
      const mx = width - insetWidth - 20, my = height - insetHeight - 67, ms = insetWidth / WORLD.width;
      ctx.fillStyle = "#001A38E8"; ctx.strokeStyle = palette.border; ctx.lineWidth = 1; ctx.beginPath(); ctx.roundRect(mx - 7, my - 19, insetWidth + 14, insetHeight + 26, 5); ctx.fill(); ctx.stroke();
      ctx.font = "9px -apple-system, sans-serif"; ctx.textAlign = "left"; ctx.fillStyle = palette.sky; ctx.fillText(`${levelName(level)} · W↓ / E↑`, mx, my - 6); ctx.strokeRect(mx, my, insetWidth, insetHeight);
      for (const aisle of aisles) { ctx.strokeStyle = "#214C76"; ctx.lineWidth = Math.max(1, aisle.width * ms); ctx.beginPath(); ctx.moveTo(mx + aisle.a.x * ms, my + aisle.a.y * ms); ctx.lineTo(mx + aisle.b.x * ms, my + aisle.b.y * ms); ctx.stroke(); }
      if (level > 0) { ctx.fillStyle = "#315C88"; for (const b of PARKING_BLOCKS) ctx.fillRect(mx + b.x * ms, my + b.y * ms, b.w * ms, b.h * ms); }
      else { const b = GROUND_BUILDING; ctx.fillStyle = "#315C88"; ctx.fillRect(mx + b.x * ms, my + b.y * ms, b.w * ms, b.h * ms); ctx.strokeStyle = palette.sky; ctx.lineWidth = .7; ctx.strokeRect(mx + b.x * ms, my + b.y * ms, b.w * ms, b.h * ms); }
      for (const ramp of RAMP_CORRIDORS) { ctx.strokeStyle = ramp.side === "west" ? palette.sky : palette.active; ctx.lineWidth = Math.max(1.5, ramp.width * ms); ctx.beginPath(); ctx.moveTo(mx + ramp.start.x * ms, my + ramp.start.y * ms); ctx.lineTo(mx + ramp.end.x * ms, my + ramp.end.y * ms); ctx.stroke(); }
      if (level === 0) { ctx.fillStyle = palette.sky; for (const cap of GROUND_RAMP_CAPS) ctx.fillRect(mx + cap.x * ms, my + cap.y * ms, cap.w * ms, Math.max(1, cap.h * ms)); }
      if (driving || zoom !== 1) {
        ctx.save(); ctx.beginPath(); ctx.rect(mx, my, insetWidth, insetHeight); ctx.clip();
        ctx.strokeStyle = palette.active; ctx.lineWidth = 1; ctx.beginPath();
        viewport.forEach((p, i) => { if (i === 0) ctx.moveTo(mx + p.x * ms, my + p.y * ms); else ctx.lineTo(mx + p.x * ms, my + p.y * ms); });
        ctx.closePath(); ctx.stroke(); ctx.restore();
      }
      if (carVisible) {
        ctx.save(); ctx.translate(mx + car.x * ms, my + car.y * ms); ctx.rotate(car.heading);
        ctx.fillStyle = palette.text; ctx.beginPath(); ctx.moveTo(5, 0); ctx.lineTo(-3, -3); ctx.lineTo(-2, 0); ctx.lineTo(-3, 3); ctx.closePath(); ctx.fill(); ctx.restore();
      }
      // The compass follows the camera rotation; the inset stays north-up.
      ctx.save(); ctx.translate(width - 33, 230); ctx.rotate(rotation);
      ctx.strokeStyle = palette.sky; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(0, 8); ctx.lineTo(0, -8); ctx.moveTo(-4, -3); ctx.lineTo(0, -8); ctx.lineTo(4, -3); ctx.stroke(); ctx.restore();
      ctx.fillStyle = palette.sky; ctx.font = "9px -apple-system, sans-serif"; ctx.textAlign = "center"; ctx.fillText("N", width - 33, 252);
      ctx.textAlign = "left";
      const metres = [50, 20, 10, 5, 2, 1].find(m => m * scale <= Math.min(110, width * .3)) ?? 1;
      ctx.fillText(`${metres} m`, 20, height - 55); ctx.fillRect(20, height - 50, metres * scale, 1);
    };
    draw(); const observer = new ResizeObserver(draw); observer.observe(canvas);
    return () => observer.disconnect();
  }, [state, showPlan, zoom, view, level, scenario, vehicleLength, vehicleWidth]);
  return <canvas ref={ref} className="garage-canvas" role="img" aria-label={`${view === "driving" ? "1인칭 주행 뷰. 차량은 하단 중앙, 전면 방향은 위쪽." : "전체 지도 뷰. 북쪽은 위쪽."} ${levelName(level)} 주차장 지도. ${WORLD.width} × ${WORLD.height}m, 가로 세로 2:1, 지하층당 ${PARKING_CAPACITY}면. 서측 직선 하행, 동측 직선 상행. ${level === 0 ? "중앙 건물과 외곽도로. 슬로프 남쪽 끝은 1층 도로에 연결되지 않음." : "내부 왕복 2차선."}`}/>;
}

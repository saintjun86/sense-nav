"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, CarFront, Crosshair, Flag, Gauge, Layers, Minus, Navigation, Pause, Play, Plus, RotateCcw, Route, Satellite, ShieldCheck, SlidersHorizontal, WifiOff, X } from "lucide-react";
import { Simulation } from "@/lib/simulation/engine";
import { DEFAULT_CONFIG, FIXED_DT, MAX_SPEED_KMH, SENSOR_PRESETS, VEHICLES, hasSensorErrors } from "@/lib/simulation/physics";
import { clamp, floorLabel, LEVELS, levelName, PARKING_CAPACITY, RAMPS, rampLength, rampProgress, WORLD } from "@/lib/simulation/world";
import type { Config, Gear, Level, Snapshot } from "@/lib/simulation/types";
import MapCanvas, { type MapView } from "./MapCanvas";
import VehicleInclination from "./VehicleInclination";

const time = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
const deg = (rad: number) => rad * 180 / Math.PI;
function Dialog({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; d?.showModal(); return () => d?.close(); }, []);
  return <dialog ref={ref} className="dialog" onClose={close} aria-label={title}><div className="dialog-heading"><h2>{title}</h2><button className="icon-btn" onClick={close} aria-label="닫기"><X size={19}/></button></div>{children}</dialog>;
}
function Range({ label, value, min, max, step = 1, unit, onChange, disabled = false }: { label: string; value: number; min: number; max: number; step?: number; unit: string; onChange: (n: number) => void; disabled?: boolean }) {
  return <label className="range-field"><span>{label}<strong>{value.toFixed(step < 1 ? step < 0.1 ? 2 : 1 : 0)}<small>{unit}</small></strong></span><input type="range" aria-label={label} min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} disabled={disabled}/></label>;
}
function ControlReading({ label, value, min, max, unit }: { label: string; value: number; min: number; max: number; unit: string }) {
  const position = (clamp(value, min, max) - min) / (max - min) * 100;
  const zero = min < 0 ? -min / (max - min) * 100 : 0;
  return <div className="control-reading"><div><span>{label}</span><strong>{value.toFixed(0)}<small>{unit}</small></strong></div><div className="reading-track" role="meter" aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={clamp(value, min, max)} aria-valuetext={`${value.toFixed(0)} ${unit}`}><i style={{ left: `${Math.min(zero, position)}%`, width: `${Math.abs(position - zero)}%` }}/>{min < 0 && <b className="reading-zero"/>}</div></div>;
}
export default function Simulator() {
  const [initialEngine] = useState(() => new Simulation());
  const engine = useRef(initialEngine);
  const [state, setState] = useState<Snapshot>(() => ({ ...initialEngine.state }));
  const [progress, setProgress] = useState(0);
  const [config, setConfig] = useState<Config>(structuredClone(DEFAULT_CONFIG));
  const [running, setRunning] = useState(false);
  const [rate, setRate] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [mapView, setMapView] = useState<MapView>("driving");
  const [viewFloor, setViewFloor] = useState<Level | "auto">(0);
  const [dialog, setDialog] = useState<"settings" | null>(null);
  const publish = useCallback(() => {
    const sim = engine.current;
    setState({ ...sim.state, physics: { ...sim.state.physics }, estimate: { ...sim.state.estimate }, controls: { ...sim.state.controls } });
    setProgress(Math.min(100, sim.state.physics.distance / sim.routeLength * 100));
  }, []);
  useEffect(() => {
    if (!running) return;
    let id = 0, previous = performance.now(), accumulator = 0, lastPaint = 0;
    const loop = (now: number) => {
      const elapsed = Math.min((now - previous) / 1000, 0.1) * rate; previous = now;
      accumulator += elapsed;
      while (accumulator >= FIXED_DT) { engine.current.step(); accumulator -= FIXED_DT; }
      if (now - lastPaint >= 50 || engine.current.state.complete) { publish(); lastPaint = now; }
      if (engine.current.state.complete) { setRunning(false); return; }
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [running, rate, publish]);
  useEffect(() => {
    const hide = () => { if (document.hidden) setRunning(false); };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, []);
  const reset = (next = config) => {
    setRunning(false);
    engine.current = new Simulation(next);
    publish();
  };
  const updateConfig = (patch: Partial<Config>) => { const next = { ...config, ...patch }; setConfig(next); reset(next); };
  const speed = Math.abs(state.physics.speed) * 3.6;
  const sensorExperiment = hasSensorErrors(config);
  const elevation = Math.abs(state.estimate.z) < 0.005 ? 0 : state.estimate.z;
  const grade = deg(state.estimate.gradeRad);
  const status = state.complete ? "완료" : running ? "실행 중" : state.time > 0 ? "일시정지" : "준비됨";
  const currentFloor = state.physics.level;
  const shownFloor = mapView === "driving" || viewFloor === "auto" ? currentFloor : viewFloor;
  const selectMapView = (view: MapView) => {
    setMapView(view); setZoom(1);
    setViewFloor(view === "driving" ? "auto" : shownFloor);
  };
  const activeRamp = RAMPS.find(r => r.id === state.physics.rampId);
  return <div className="app-shell">
    <header className="topbar"><div className="brand" aria-label="SENSE NAV"><span className="brand-symbol"><Route size={22}/></span><strong>SENSE <span>NAV</span></strong></div></header>
    <main>
      <div className="page-heading"><div><div className="eyebrow">BEYOND THE GPS SIGNAL</div><h1>SENSE NAV — 차량 센서 기반 GPS 비의존 내비게이션</h1><p>차량 중량과 가속·제동 입력, 속도 변화로 지하의 경사와 이동 경로를 추정합니다.</p></div></div>
        <section className="scenario-bar" aria-label="시나리오 설정"><div className="scenario-label"><span className="small-icon"><Layers size={19}/></span><div><small>주행 환경</small><select aria-label="주행 환경" value={config.scenario} disabled={running} onChange={e => updateConfig({ scenario: e.target.value as Config["scenario"] })}><option value="garage">서측 직선 입차 · 1F → B2</option><option value="flat">B1 순환 주행 · 기준 실험</option><option value="uphill">동측 직선 출차 · B2 → 1F</option></select></div></div>
          <div className="scenario-label"><CarFront size={19}/><div><small>차량 프로필 · 예시 제원</small><select aria-label="차량 프로필" value={config.vehicle.id} disabled={running} onChange={e => updateConfig({ vehicle: VEHICLES.find(v => v.id === e.target.value)! })}>{VEHICLES.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}{config.vehicle.id === "custom" && <option value="custom">{config.vehicle.name}</option>}</select></div></div>
          <div className="scenario-spacer"/><span className="source-badge"><i/>합성 센서{sensorExperiment ? " · 센서 오차 실험" : " · 이상적 기준"}</span><button className="text-btn" onClick={() => setDialog("settings")}><SlidersHorizontal size={16}/> 실험 설정</button>
        </section>
        <div className="split-layout">
          <section className="navigation-panel" aria-label="지하 내비게이션 화면">
            <div className="panel-heading dark"><div><Navigation size={17}/><h2>지하 내비게이션</h2></div><span className={state.frame.gpsAvailable ? "gps-tag" : "gps-tag offline"}>{state.frame.gpsAvailable ? <Satellite size={13}/> : <WifiOff size={13}/>}GPS {state.frame.gpsAvailable ? "수신 중" : "미수신"}</span></div>
            <div className="map-viewbar">
              <div className="view-switch" role="group" aria-label="내비게이션 뷰 선택">
                <button aria-pressed={mapView === "driving"} className={mapView === "driving" ? "active" : ""} onClick={() => selectMapView("driving")}><Navigation size={14}/>1인칭 뷰</button>
                <button aria-pressed={mapView === "overview"} className={mapView === "overview" ? "active" : ""} onClick={() => selectMapView("overview")}><Layers size={14}/>전체 지도</button>
              </div>
              <span>{mapView === "driving" ? "차량 고정 · 진행 방향 ↑" : "북쪽 고정 · 층별 보기"}</span>
            </div>
            <div className="map-area">
              <MapCanvas level={shownFloor} view={mapView} scenario={config.scenario} state={state} showPlan={true} zoom={zoom} vehicleLength={config.vehicle.lengthM} vehicleWidth={config.vehicle.widthM}/>
              <div className="map-top"><div className="guidance-icon">{activeRamp ? state.physics.speed * Math.sin(state.physics.gradeRad) > 0 ? <ArrowUp size={24}/> : <ArrowDown size={24}/> : state.parked ? <Flag size={24}/> : <Route size={24}/>}</div><div><strong>{activeRamp ? `${activeRamp.name} · ${levelName(activeRamp.from)} → ${levelName(activeRamp.to)}` : shownFloor !== currentFloor ? `${levelName(shownFloor)} ${shownFloor === 0 ? "지상 공간" : "주차장"} 둘러보기` : state.parked ? "주차 위치를 기록했어요" : "서측으로 내려가고, 동측으로 올라와요"}</strong><span>{activeRamp ? `직선 슬로프 ${Math.round(rampProgress(state.physics, activeRamp) * rampLength(activeRamp))} / ${rampLength(activeRamp)} m · 높이 ${state.physics.z.toFixed(2)} m` : shownFloor === 0 ? `${WORLD.width} × ${WORLD.height} m · 중앙 건물 · 외곽 왕복 2차선` : `${WORLD.width} × ${WORLD.height} m · 지하층당 ${PARKING_CAPACITY.toLocaleString()}면 · 왕복 2차선 / 폭 7 m`}</span></div></div>
              <div className="floor-selector" aria-label="표시할 층"><span>지도</span>{LEVELS.map(level => <button key={level} aria-label={`${levelName(level)} 전체 지도`} title={`${levelName(level)} 전체 지도 보기`} aria-pressed={shownFloor === level} className={shownFloor === level ? "active" : ""} onClick={() => { setMapView("overview"); setViewFloor(level); setZoom(1); }}>{levelName(level)}{level === currentFloor && <i/>}</button>)}<button className={mapView === "driving" ? "tracking" : ""} aria-pressed={mapView === "driving"} aria-label="내 차량으로 돌아가기 · 1인칭 뷰" title="내 차량으로 돌아가기" onClick={() => selectMapView("driving")}><Crosshair size={13}/></button></div>
              <div className="map-tools"><button aria-label="지도 확대" disabled={zoom >= (mapView === "driving" ? 2.5 : 6)} onClick={() => setZoom(z => clamp(z + 0.4, 0.8, mapView === "driving" ? 2.5 : 6))}><Plus size={17}/></button><button aria-label="지도 축소" disabled={zoom <= 0.8} onClick={() => setZoom(z => clamp(z - 0.4, 0.8, mapView === "driving" ? 2.5 : 6))}><Minus size={17}/></button><button aria-label="확대 배율 초기화" title="확대 배율 초기화" onClick={() => setZoom(1)}><RotateCcw size={17}/></button></div>
              <div className="map-bottom"><div className="map-legend"><span><i className="legend-car"/>내 차량</span><span><i className="legend-line blue"/>추정 경로</span><span><i className="legend-line plan"/>시연 예정 경로</span></div></div>
            </div>
            <div className="floor-status"><span><Layers size={13}/>현재 <b>{activeRamp ? `${levelName(activeRamp.from)} → ${levelName(activeRamp.to)}` : levelName(currentFloor)}</b></span><span>센서 추정 <b>{floorLabel(state.estimate.z)}</b></span><span>실제 높이 <b>{state.physics.z.toFixed(1)} m</b></span>
            </div>
            <div className="map-metrics">
              <div><small>누적 주행 거리</small><strong>{state.estimate.distance.toFixed(1)} <span>m</span></strong></div>
              <div><small>기록 시간</small><strong>{time(state.time)}</strong></div>
              <div><small>추정 경사</small><strong className={Math.abs(grade) > 2 ? "accent" : ""}>{grade > 0 ? "+" : ""}{grade.toFixed(1)}<span> °</span></strong></div>
              <div title="1F를 0m로 한 센서 추정 고도. 지하는 음수로 표시합니다."><small>누적 고도 · 1F 0m</small><strong aria-label={`누적 추정 고도 ${elevation.toFixed(2)} 미터`}>{elevation > 0 ? "+" : ""}{elevation.toFixed(2)} <span>m</span></strong></div>
            </div>
          </section>
          <section className="control-panel" aria-label="차량 상태 및 시연 화면">
            <div className="panel-heading"><div><Gauge size={17}/><h2>차량 상태 · 시연</h2></div><span className={`status-tag ${running ? "live" : ""}`}><i/>{status}</span></div>
            <div className="playback-section" role="group" aria-label="시뮬레이션 재생 조작">
            <div className="playback"><button className="primary-btn" disabled={state.complete} onClick={() => { if (!running) setViewFloor("auto"); setRunning(!running); }}>{running ? <Pause size={17} fill="currentColor"/> : <Play size={17} fill="currentColor"/>}{running ? "일시정지" : state.time > 0 ? "계속하기" : "시뮬레이션 시작"}</button><button className="reset-btn" aria-label="시뮬레이션 초기화" onClick={() => reset(config)}><RotateCcw size={18}/></button><select aria-label="재생 배속" value={rate} onChange={e => setRate(Number(e.target.value))}><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select></div>
            <div className="progress-track"><div style={{ width: `${progress}%` }}/></div>
            <div className="control-foot"><span>120 Hz 물리 연산</span><span>{state.parked ? "주차 기록 완료" : "저속 주행 모델"}</span></div>
            </div>
            <div className="instrument-cluster"><div className="speed-gauge"><svg viewBox="0 0 240 145" aria-hidden="true"><path d="M 26 124 A 96 96 0 1 1 214 124" fill="none" stroke="var(--soft)" strokeWidth="9" strokeLinecap="round"/><path d="M 26 124 A 96 96 0 1 1 214 124" fill="none" stroke="var(--brand)" strokeWidth="9" strokeLinecap="round" pathLength="100" strokeDasharray={`${Math.min(100, speed / MAX_SPEED_KMH * 100)} 100`}/><text x="17" y="143">0</text><text x="109" y="22">15</text><text x="208" y="143">{MAX_SPEED_KMH}</text></svg><div className="speed-number"><strong>{speed.toFixed(0)}</strong><span>km/h</span></div></div><div className="gear-column"><span>GEAR</span>{(["P", "R", "N", "D"] as Gear[]).map(g => <span key={g} aria-label={`${g} 기어${state.controls.gear === g ? ", 현재 기어" : ""}`} className={`gear-value ${state.controls.gear === g ? "active" : ""}`}>{g}</span>)}</div></div>
            <div className="driving-status"><span className="speed-limit"><b>{MAX_SPEED_KMH}</b>{speed >= MAX_SPEED_KMH - 0.05 ? "km/h · 속도 제한 중" : "km/h · 최고 속도"}</span><span>{sensorExperiment ? "센서 오차 실험" : "이상적 기준 · 편향·노이즈 없음"}</span></div>
            <div className="vehicle-values"><div><span>속도 기반 가속도</span><strong>{(state.rows.at(-1)?.acceleration ?? 0).toFixed(2)} <small>m/s²</small></strong></div><div><span>핸들 조향각</span><strong>{state.controls.steeringWheelDeg.toFixed(1)}<small> °</small></strong></div></div>
            <div className="controls">
              <ControlReading label="가속 페달" value={state.controls.throttle * 100} min={0} max={100} unit="%"/>
              <ControlReading label="브레이크" value={state.controls.brake * 100} min={0} max={100} unit="%"/>
              <ControlReading label="핸들 조향" value={state.controls.steeringWheelDeg} min={-720} max={720} unit="°"/>
              <div className="playback-hint"><ShieldCheck size={14}/>자동 시연 · 최고 30 km/h · 4× 배속 지원</div>
            </div>
            <VehicleInclination gradeRad={state.estimate.gradeRad} observable={state.estimate.gradeObservable}/>
          </section>
        </div>
      <footer><span><span className="footer-dot"/> SENSE NAV <b>/</b> GPS가 끊겨도, 차량 센서로 길을 잇다.</span><span>물리 기반 검증 · 합성 시연 / 실차 미연동</span></footer>
    </main>
    {dialog === "settings" && <Dialog title="실험 설정" close={() => setDialog(null)}>
      <p className="dialog-description">조건을 바꾸면 새 실험이 시작됩니다. 진행 중에는 먼저 일시정지해주세요. 시뮬레이션 최고 속도는 30 km/h입니다.</p>
      <div className="sensor-presets" role="group" aria-label="센서 모드"><button aria-pressed={!sensorExperiment} className={!sensorExperiment ? "active" : ""} disabled={running} onClick={() => updateConfig({ ...SENSOR_PRESETS.basic, useGyro: true })}><strong>이상적 기준</strong><span>편향·노이즈 없음</span></button><button aria-pressed={sensorExperiment} className={sensorExperiment ? "active" : ""} disabled={running} onClick={() => updateConfig(SENSOR_PRESETS.experiment)}><strong>센서 오차 실험</strong><span>누적 오차 비교</span></button></div>
      <div className="settings-fields"><label className="select-field">GPS 수신 조건<select aria-label="GPS 수신 조건" disabled={running} value={config.gpsMode} onChange={e => updateConfig({ gpsMode: e.target.value as Config["gpsMode"] })}><option value="auto">자동 · 램프 진입 시 수신 중단</option><option value="off">항상 꺼짐 · 기준점부터 추정</option><option value="on">항상 켜짐 · 비교 실험</option></select></label>
        <label className="sensor-toggle"><input type="checkbox" checked={config.useGyro} disabled={running} onChange={e => updateConfig({ useGyro: e.target.checked })}/><span>회전 센서로 방향 보정<small>입력이 없으면 속도·조향으로 추정합니다.</small></span></label>
        {sensorExperiment && <><Range label="속도 센서 편향" value={config.speedBiasPct} min={-5} max={5} step={0.1} unit="%" disabled={running} onChange={n => updateConfig({ speedBiasPct: n })}/><Range label="핸들 센서 편향" value={config.steeringBiasDeg} min={-5} max={5} step={0.1} unit="°" disabled={running} onChange={n => updateConfig({ steeringBiasDeg: n })}/><Range label="회전 센서 편향" value={config.gyroBiasDegps} min={-0.5} max={0.5} step={0.01} unit="°/s" disabled={running} onChange={n => updateConfig({ gyroBiasDegps: n })}/><Range label="센서 노이즈 강도" value={config.noise} min={0} max={2} step={0.05} unit="" disabled={running} onChange={n => updateConfig({ noise: n })}/></>}
        <Range label="노면 마찰계수" value={config.friction} min={0.2} max={1} step={0.05} unit="μ" disabled={running} onChange={n => updateConfig({ friction: n })}/><Range label="차량 질량" value={config.vehicle.massKg} min={700} max={3500} step={50} unit="kg" disabled={running} onChange={n => updateConfig({ vehicle: { ...config.vehicle, id: "custom", name: "사용자 차량", massKg: n } })}/>
      </div><div className="settings-note"><strong>경로와 층 추정</strong><p>차량 질량과 페달 사용량으로 평지에서의 가속도를 예상하고, 실제 속도 변화에서 구한 가속도와 비교해 경사를 추정합니다. 구동력·제동력·공기저항·구름저항을 함께 고려하며, 추정 경사와 이동 거리로 고도와 층을 계산합니다. 정차·급제동·급조작·큰 회전·속도 제한 부근에서는 경사 추정값을 유지합니다. 차량별 힘 모델은 예시 값이며 실차 적용에는 보정이 필요합니다.</p></div><button className="primary-btn full" onClick={() => setDialog(null)}>설정 완료</button>
    </Dialog>}
  </div>;
}

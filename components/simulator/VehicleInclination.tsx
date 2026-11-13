/** Side view of the force-based road-grade estimate, never an attitude measurement. */
export default function VehicleInclination({ gradeRad, observable }: { gradeRad: number; observable: boolean }) {
  const degrees = gradeRad * 180 / Math.PI;
  const displayedDegrees = Math.abs(degrees) < .05 ? 0 : degrees;
  const angleLabel = `${displayedDegrees > 0 ? "+" : ""}${displayedDegrees.toFixed(1)}°`;

  return <section className="vehicle-inclination" aria-label="추정 경사에 따른 차량 기울기">
    <div className="inclination-heading"><h3>추정 경사 · 차량 기울기</h3><strong>{angleLabel}</strong></div>
    <p className="inclination-method">차량 중량·페달 사용량·속도 변화로 추정</p>
    <svg className="inclination-image" viewBox="0 0 320 160" role="img" aria-label={`차량 옆모습. 앞쪽은 오른쪽. 수평 기준 추정 경사 ${angleLabel}`}>
      <title>수평선을 기준으로 추정 경사만큼 기울어진 차량</title>
      <line className="inclination-horizon" x1="18" y1="108" x2="302" y2="108"/>
      {/* SVG y grows downwards: negative rotation raises the right-facing nose. */}
      <g transform={`rotate(${-degrees} 160 108)`}>
        <path className="inclination-body" d="M 61 94 L 60 75 Q 60 68 70 66 L 89 63 L 111 45 Q 116 41 126 41 L 177 41 Q 187 41 194 48 L 215 65 L 245 70 Q 258 72 260 82 L 260 94 Q 260 98 253 98 L 69 98 Q 61 98 61 94 Z"/>
        <path className="inclination-window" d="M 100 64 L 118 49 L 144 49 L 144 64 Z M 150 49 L 176 49 Q 181 49 186 53 L 200 64 L 150 64 Z"/>
        <path className="inclination-detail" d="M 149 68 L 149 91 M 195 68 L 200 91 M 74 87 L 247 87"/>
        <path className="inclination-handle" d="M 134 73 L 142 73 M 182 73 L 190 73"/>
        <path className="inclination-light" d="M 246 76 L 256 79 L 258 84 L 246 83 Z"/>
        <rect className="inclination-rear-light" x="61" y="72" width="5" height="9" rx="1"/>
        {[101, 220].map(x => <g key={x}>
          <circle className="inclination-tire" cx={x} cy="94" r="14"/>
          <circle className="inclination-rim" cx={x} cy="94" r="7"/>
          <circle className="inclination-hub" cx={x} cy="94" r="2"/>
        </g>)}
      </g>
      <text x="18" y="150" className="inclination-label">수평 기준 0°</text>
      <text x="302" y="150" textAnchor="end" className="inclination-label">차량 앞쪽 →</text>
    </svg>
    <p className="inclination-status">{observable ? "주행 데이터로 경사 추정 중" : "관측 대기 · 경사 추정값 유지"}</p>
  </section>;
}

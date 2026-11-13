# 데이터 계약 및 Pleos 연결 설계

## 센서 프레임 (기존 v1 + 선택 센서 필드)

CSV 헤더 또는 JSON 배열/`{"frames":[...]}` 사용. WebSocket은 메시지 하나당 JSON 프레임 하나. CSV는 쉼표 구분, 단순 숫자·boolean·기어 값만 허용한다. 텍스트 필드의 쉼표나 여러 줄을 허용하는 범용 CSV 파서는 아니다.

| 필드 | 필수 | 단위·규칙 |
|---|---|---|
| timestampMs | 예 | 밀리초, 단조 증가, 프레임 간격 0초 초과~1초 이하 |
| speedMps | 예 | m/s, 전진 양수·후진 음수, -30~60 |
| steeringWheelDeg | 예 | **핸들** 각도 degree, 우회전 양수, -720~720 |
| throttle | 예 | 0~1, 가속 페달 |
| brake | 예 | 0~1, 제동 페달 |
| gear | 예 | P, R, N, D |
| gpsAvailable | 예 | true/false 또는 1/0 |
| gpsX, gpsY | GPS 수신 시 필수 | 공통 원점의 로컬 미터 좌표, x 오른쪽·y 아래 |
| gpsHeadingRad | 선택 | 로컬 지도 기준 시계방향 rad, 오른쪽=0 |
| accelerationMps2 | 선택 | m/s², -500~500. 참고 텔레메트리만 수용. 경사와 주행 기록의 가속도는 speedMps의 시간 차분으로 계산 |
| wheelDistanceM | 선택 | 직전 timestamp부터 현재까지의 부호 있는 휠 이동량(m). 누적 총거리가 아님. 전진 양수·후진 음수 |
| yawRateRadps | 선택 | 같은 구간의 평균 차체 회전속도(rad/s), 지도 기준 시계방향 양수, -10~10 |
| intervalThrottle | 선택 | 직전 timestamp부터 현재까지 가속 페달 입력의 시간 평균, 0~1 |
| intervalBrake | 선택 | 같은 구간의 제동 페달 입력 시간 평균, 0~1 |

센서 프레임이 역전·중복되거나 1초 초과 누락되면 계속 적분하지 않고 오류를 알린다. 로그는 2~72,000프레임, 파일 15MB 이하. 20 Hz를 권장하지만 1 Hz 이상 불규칙 간격도 실제 timestamp로 적분한다. 아주 낮은 입력 빈도는 회전과 가속도를 놓칠 수 있다.

```json
{
  "timestampMs": 50,
  "speedMps": 3.2,
  "steeringWheelDeg": 15,
  "throttle": 0.25,
  "brake": 0,
  "gear": "D",
  "gpsAvailable": false
}
```

GPS 시작 좌표가 없으면 데모 입구를 상대좌표 기준점으로 사용하고 경고한다. GPS 좌표는 위도/경도가 아니다. 실제 WGS84 입력은 선택한 기준점의 지역 투영(예: ENU)으로 변환한 뒤 y와 heading 축을 통일해야 한다. 외부 데이터 궤적 아래의 주차장 도형은 가상 참고 배경이며 실제 시설 도면이 아니다.

## 차량 제원

`public/data/vehicle-profile.json`은 제원 예제다. 현재 홈페이지에는 업로드 UI가 없으며 후속 브리지에서 검증 후 적용하도록 설계한다. 필드: name, massKg, wheelbaseM, lengthM, widthM, steeringRatio, maxDriveForceN, maxBrakeForceN, dragAreaM2, rollingCoefficient. 구동력·제동력은 상수 최대값에 페달 비율을 곱하는 근사이므로 실제 엔진/모터 토크 맵·기어비·회생제동 맵과 다르다. 판매 차량 카탈로그 치수만으로는 충분하지 않다.

## SDK / API 구분

[Vehicle SDK](https://document.pleos.ai/en/docs/pleos-only/connect-sdk-pleos/Vehicle/intro)는 AAOS 차량 서비스와의 연결, capability 검사, 비동기 콜백 구조를 설명한다. [클라우드 Vehicle Data API](https://document.pleos.ai/en/api-reference/vehicle-data-api/intro)는 차종별 지원과 동의·접근 조건이 다르다. 클라우드에서 보이는 필드를 Android SDK에서 동일하게 구독할 수 있다고 가정하면 안 된다.

[차량 운행 데이터 공식 문서](https://document.pleos.ai/api-reference/vehicle-data-api/vehicle-data-api/common/get-vehicle-operation-data)는 조향휠 각도 degree, 종방향 가속도 g, yaw degree/s, 기어 필드를 설명한다. 반환 배열의 실제 시간축·샘플 빈도·동기화를 먼저 확인해야 한다. `tripLength`를 배열 길이로 나누어 센서 시간으로 임의 환산하지 않는다. 가속도를 사용할 때 g 값에 9.80665를 곱한다. yaw rate로 방위를 적분할 때는 degree/s를 rad/s로 바꾸고 센서 축 부호를 검증한다. 현재 추정기는 선택 `yawRateRadps` 입력을 조향 모델과 결합한다. 입력은 단순 heading 각도가 아닌 회전속도여야 한다. 경사는 별도 자세 센서 없이 차량 질량·페달·속도 변화와 힘 모델로 계산한다. 가속도 원시값을 기울기 측정값으로 해석하지 않는다.

## 권장 브리지

```text
Pleos/AAOS 또는 차량 데이터 API
  → 권한 및 capability 확인
  → 필요한 프레임의 시간 동기화
  → 단위/부호/좌표 변환
  → v1 프레임 검증
  → WebSocket(wss://)
  → 브라우저 추측항법 및 화면
```

`adapter.ts`의 BridgeTelemetry는 우리 브리지용 예제 타입이며 Pleos의 응답 타입이 아니다. km/h→m/s, %→0~1, 소문자 기어→대문자, 조향·yaw 부호 변환, 선택 `yawRateDegps`의 rad/s 변환을 제공한다. `wheelDistanceM`은 이미 부호가 있는 구간 이동량으로 전달해야 한다. 후진 방향 변환은 원본 speedKmh가 절댓값이고 R일 때 음수로 만들도록 정의했다. N에서의 뒤로 구르는 상황은 원천 센서의 signed speed가 필요하며 이 단순 예제에서 처리하지 않는다.

API 토큰은 서버/Android 안전 저장소에 두고 브라우저에는 보내지 않는다. 재생 버튼은 **로컬 시뮬레이션만 제어**하고 페달·기어 계기는 상태만 표시한다. 차량으로 제동·조향·가속 명령을 전송하는 경로는 없다. 현재 홈페이지에는 WebSocket 연결 UI가 없으며 외부 연결을 시작하지 않는다.

## v2.6 시작 기준점과 결과

기존 필수 필드는 v1과 호환되며 선택 센서 필드를 추가했다. GPS에는 고도가 없으므로 재생 전 실제 로그의 시작 기준점에 맞는 주행 환경을 선택한다. 기본 진입은 (70,12.25,0), B1 평지는 (70,68.25,-3.2), B2 출차는 (160,103.25,-6.4)이며 heading은 각각 π, 0, 0이다. 첫 GPS가 있으면 x/y/heading만 보정하고 높이는 이 알려진 기준점을 유지한다. 외부 로그가 다른 시작 위치·층을 쓰면 브리지/설정에서 기준점을 맞춰야 한다. 화면의 합성 샘플은 선택한 환경·차량 설정으로 생성된다. 번들 sample-sensors.csv는 과거 v2.0 공간에서 생성한 기록으로 현재 지도와 맞지 않는다. 현재 공간의 샘플은 화면에서 사용자가 생성할 수 있다.

world.version=6은 230×115m 공간의 1F/B1/B2만 제공하며 지하층 수는 2다. B3와 WD3/EU3 링크를 제거했다. 1층 중앙 건물·외곽도로·지상 슬로프 막음면은 유지한다. ramps에는 shape="straight", start/end, width, from/to를 포함하며 중심선 투영 거리로 높이를 계산한다. 기존 원형 램프의 center/radius/startAngle과 물리 상태의 rampTravel은 사용하지 않는다. 보고서 schemaVersion=3은 기존 world, ramps, actualDistanceM, finalActualLevel을 유지하고 simulationSpeedLimitKmh와 행별 headingErrorDeg, heightErrorM, floorError를 포함한다. 실제 값은 합성 모드에만 존재하며 외부 데이터에서는 null이다. 기존 결과 CSV의 z/estimatedZ는 실제 높이와 추정 높이를 계속 구분한다.


30 km/h 제한은 합성 차량의 실제 물리 속도에 적용한다. 외부 로그/스트림의 측정 속도나 오차 실험의 센서 측정값은 잘라내지 않는다. 계기판은 합성 모드에서 실제 차량 속도, 외부 모드에서 원본 센서 속도를 표시하며 텔레메트리 속도 그래프는 센서 측정값이다.

내비게이션 누적 고도는 `estimatedZ`와 같은 1F 기준 상대 고도(m)이다. 지도 하단 오차 수치를 숨겨도 결과 CSV/JSON의 error·headingErrorDeg·heightErrorM·floorError 필드는 유지한다.

## v2.11 힘 기반 경사 추정

기울기 측정 필드와 브리지 변환을 제거했다. 이전 형식의 기울기 필드는 알려지지 않은 추가 속성으로 무시되며 추정기에 전달되지 않는다. `intervalThrottle`·`intervalBrake`는 실제 페달 명령의 시간 평균이며 경사·중력·정답 좌표를 포함하지 않는다. 없으면 인접 샘플의 페달 평균을 사용한다. 페달과 속도의 시간 동기화가 필수이며 실차에서는 차량 질량·구동/제동 응답·저항 계수 보정이 필요하다. 보고서 schemaVersion=4는 힘 기반 경사 모델과 관측 보류에 따른 한계를 기록한다. 기존 샘플·벤치마크를 새 모델의 성능 근거로 사용하지 않는다. 현재 UI에는 데이터 연결·차트·내보내기가 없으며 개발용 생성 스크립트는 사용자가 별도 실행할 수 있다.

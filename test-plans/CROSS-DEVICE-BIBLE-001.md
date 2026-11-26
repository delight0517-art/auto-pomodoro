# CROSS-DEVICE-BIBLE-001 — iPhone Selah에서 컴퓨터로 묵상 읽기

이 시나리오는 **Selah**의 iPhone/모바일 앱 흐름이다. Mac·Windows 공통 상시 회귀 테스트로, `CROSS_PLATFORM_PARITY.md`의 출시 전 필수 확인 항목이다. 잠금/원격 명령/Selah 묵상 연결 경로 변경 때마다 양쪽에서 실행한다.

## 기대 동작

두 시간 차단 중 사용자가 도서관에 도착해 iPhone의 **Selah**에서 **컴퓨터에서 읽기**를 선택한다. 인증된 BlueCloud Selah 상태에 1회성 `computerReadingRequest`를 기록한다. 연결된 Auto Pomodoro 데스크톱은 Mac 대상 요청만 멱등 처리하고 Selah 앱/브라우저를 한 번 열며, 컴퓨터가 실제 열렸다는 결과를 `computerReadingResult`로 기록한다. Pomodoro 타이머의 현재 모드와 남은 시간을 보존하며 읽기 세션이 진행되는 동안 휴식 잠금 화면이 난입하지 않게 한다. 컴퓨터가 오프라인이거나 요청이 만료/거절되면 iPhone에서 성공으로 표시하면 안 된다.

Mac과 Windows 모두 같은 사용자 동작, 권한 확인, 시간 제한, 중복 요청 처리, 성공/실패 피드백을 제공해야 한다. OS별 실행 방식은 달라도 결과는 같아야 한다. iPhone과 컴퓨터는 서로 다른 네트워크일 수 있으므로 동일 Wi-Fi를 전제로 하지 않는다.

## 집중 읽기와 복귀 유예

- Selah에서 **집중 읽기**를 시작하면 읽기 세션 자체를 BlueCloud에 명시적으로 기록하고, 그 세션을 Pomodoro 휴식과 동등한 보호 상태로 취급한다. 읽기 중 Pomodoro의 휴식 잠금 화면이 갑자기 나타나면 안 된다. `reader focus`의 화면 스타일 상태만으로는 충분하지 않다.
- Pomodoro는 묵상 시작 직전의 모드와 남은 시간을 보존한다. Selah 세션은 별도 상태로 추적하고 Pomodoro 세션/통계를 중복 생성하지 않는다.
- 사용자가 컴퓨터의 Selah 브라우저 탭을 실수로 닫거나 벗어나면 즉시 Pomodoro 차단을 복구하지 않는다. 공통 복귀 유예시간 **7분(420초)** 안에 같은 Selah 세션으로 돌아와 묵상을 재개할 수 있게 한다.
- 유예 중에는 두 복귀 방법을 모두 지원한다: (1) 컴퓨터에서 Selah URL을 다시 열어 기존 세션 재개, (2) iPhone Selah에서 **컴퓨터에서 묵상하기**를 다시 눌러 기존 세션/창 재개.
- 재시도는 동일 세션에 멱등적이어야 한다. 새 묵상 세션이나 중복 브라우저 창을 만들거나, 묵상 만료 시각/Pomodoro 카운트를 중복 연장·변경하면 안 된다.
- 유예시간이 지나도 복귀하지 않으면 Selah 세션을 종료하고 보존한 Pomodoro 모드/남은 시간 및 원래 잠금 정책을 복구한다. 상태가 오프라인으로 불명확할 때 성공으로 추정하지 않는다.
- 7분은 이탈 시점부터의 고정 복귀 창이다. 재진입/재요청은 만료를 연장하지 않으며, 공유 wire 값은 절대 만료시각(`resumeGraceUntil`)으로 전달한다. 유예 중 재개한 뒤에도 휴식이 난입하지 않는지, 유예 만료 뒤 Pomodoro가 정확히 복귀하는지 확인한다.

## 사전 조건

- 격리된 테스트 계정으로 iPhone 앱과 대상 컴퓨터가 같은 계정/연결 계약을 사용한다.
- 실제 사용자 세션이 아닌 해제 가능한 테스트용 두 시간 차단 상태를 준비한다. 실제 2시간 대기 대신 테스트 clock 또는 명시된 테스트 fixture로 만료를 제어한다.
- 실제 배포 Selah URL과 테스트용 passage reference를 사용한다. Pomodoro 데스크톱은 고정된 Selah origin과 검증된 passage만 열어야 한다.
- 실제 화면 잠금, 계정 암호, 타 사용자 데이터를 건드리지 않는다.

## 테스트 절차와 판정

각 플랫폼에서 다음 조합을 확인한다: 브라우저 온라인, 컴퓨터 오프라인, 동일 세션 재요청. Selah 묵상 중 Pomodoro 휴식 시각을 인위적으로 만료시키고 아래 복귀 경로도 확인한다.

1. Pomodoro가 테스트용 두 시간 차단 상태에 들어간 것을 타이머/잠금 상태에서 확인한다.
2. iPhone Selah에서 **컴퓨터에서 읽기**를 누르고, 1회성 `computerReadingRequest` ID와 Mac 대상이 BlueCloud에 저장되는지 확인한다.
3. Pomodoro가 인증된 세션을 받아 검증된 Selah URL을 기본 브라우저에서 한 번 열고, 현재 Pomodoro 모드/남은 시간을 보존하는지 확인한다. 재전송은 새 탭/세션을 만들지 않아야 한다.
4. 컴퓨터 Selah에서 **집중 읽기**를 시작하고, 활성 읽기 세션/선택 구절이 BlueCloud에 반영되는지 확인한다. 이 상태를 Mac이 받아 Pomodoro 휴식 보호를 유지해야 한다.
5. 오프라인/거절/만료 조합에서는 가짜 컴퓨터 성공이 표시되지 않고 명확한 상태가 보이는지 확인한다. 연결 복구 뒤 만료된 open intent가 늦게 실행되지 않아야 한다.
6. Selah 읽기 화면/컴퓨터 열기 요청에서 구절·세션 정보만 전달되고 묵상 노트, 기도, reflection 본문, 인증정보는 전송되지 않는지 확인한다.
7. 집중 묵상 중 Pomodoro가 휴식 경계에 도달해도 화면/차단이 끼어들지 않고, 읽기 직전의 Pomodoro 상태/남은 시간이 보존되는지 확인한다.
8. Selah를 닫거나 벗어난 뒤 유예시간 내에 (a) 컴퓨터에서 Selah URL 재진입, (b) iPhone에서 **컴퓨터에서 묵상하기** 재요청으로 같은 session ID·남은 시간을 복구한다. 어느 경로도 Pomodoro 잠금이 먼저 난입하지 않아야 한다.
9. 두 복귀 경로를 반복 호출해도 computer-reading request, 브라우저 탭, Selah 세션 또는 Pomodoro 기록이 중복되지 않는지 확인한다.
10. 유예시간을 가짜 시계로 넘겨 복귀하지 않으면 Selah 세션 종료, 보존한 Pomodoro 상태 복원, 원래 잠금 재개를 확인한다.

## 기록 양식

| 플랫폼 | 설치 앱 | 온라인 | 요청/응답 | 차단 만료 후 복구 | 판정/증거 |
|---|---|---|---|---|---|
| Mac | 부분 확인 | BlueCloud health 응답; 인증 cloud-state 읽기 E2E 미완료 | 소스 smoke 통과, 설치본 미통과 | 미검증 | 개발 작업본에 요청 처리기 있음. 설치 1.0.27 번들에는 처리기 없음; Selah poll timeout 로그와 iPhone UI 미러링 잠김 |
| Windows | 소스 구현 + debug build | `winpc health` 응답 | Fake-clock/정적 시나리오 통과; 실계정 ACK 미확인 | fake-clock 경계 통과; 실제 UI/복귀 미확인 | `flutter build windows --debug` 통과; 앱은 미실행 |

2026-10-01 회귀 추가: Mac source smoke에서 허용된 현재 휴식과 브라우저 폴백 readback, 기타 strict lock·예약 lock·strict Pomodoro break 거부를 확인한다. Fake clock은 늦은 세션 만료 복구, `resumeGraceUntil` 정확한 경계, heartbeat 유실 후 7분, BlueCloud 조회 실패 뒤 복구를 확인한다. 이 검사는 Pomodoro 소비 측만 검증하며 Selah 발행자·설치본·실기기 왕복은 증명하지 않는다.

## 2026-10-01 — 사용자 요청에 따른 공개 화면 테스트

- 공개 Selah URL을 브라우저에서 열어 실제 접근 가능한 화면을 확인했다. 초기 화면에는 **말씀 읽기**와 **시간 묵상**만 있고 **컴퓨터에서 읽기** 버튼은 없다.
- **말씀 읽기**를 눌렀을 때 `readerFocusToggle`이 **집중 읽기 닫기**로 바뀌고 읽기 화면이 집중 모드가 됐다. 닫기 동작도 확인해 처음 화면으로 복귀했다. 이 동작만으로 cloud 보호 세션이 생기지는 않는다.
- 따라서 실제 iPhone→Mac 요청, Selah 보호 중 Pomodoro 휴식 억제, 7분 복귀의 공개 E2E는 첫 단계에서 막힌다. 인증이나 개인 BlueCloud 상태는 건드리지 않았으며, 일반 페이지 방문 분석은 사이트에서 집계될 수 있다.
- iPhone Mirroring에서는 기존 설정 화면을 확인한 뒤 홈 화면까지 이동했으나, Safari를 여는 입력에서 두 차례 `noWindowsAvailable` 연결 오류가 발생했다. 새 상태를 한 번 확인한 뒤 중단했으며 iPhone 앱은 조작하지 않았다.
- `npm test` 재실행은 exit 0. 이는 Mac source/fake-clock 검사 통과이며, 공개 Selah 부재 기능이나 iPhone/Mac 설치본 동작을 대신 증명하지 않는다.

현재 판정: **미구현/미통과**. 공유 복귀 유예는 7분으로 고정해 양 플랫폼 테스트에 사용한다. 이전 테스트에서 확인한 Pomodoro iOS의 별도 Mac 긴급 해제는 Selah 버튼 연결, 묵상 중 휴식 억제, 복귀, 브라우저 실행을 증명하지 않는다.

## 2026-10-01 — Windows 소스 구현 및 회귀

- Windows Pomodoro (`C:\Users\delig\Desktop\app dev\timer1`)에 authenticated `/api/cloud-state/selah` read/merge-write 연결을 추가했다. 409이면 최신 문서를 다시 읽고 한 번만 재시도해 Selah의 다른 데이터를 보존한다.
- Windows 요청 소비기는 2분 만료, 30초 미래 시각 허용, UUID/action/target 검증, 요청 ID 중복 억제, 고정 Selah URL의 기본 브라우저 실행, cloud result ACK를 구현했다. passage reference, 성경 본문, reflection, 기도, 노트, 자격 증명은 Pomodoro로 복사하지 않는다.
- `computerReadingSession` running heartbeat는 45초까지, paused 상태는 서버의 절대 `resumeGraceUntil`까지만 보호한다. 활성 읽기 동안 실행 중인 Pomodoro focus를 잠시 멈추고 같은 타이머 세션만 복구한다. 일반 Pomodoro break는 보류/재개하며 strict-lock break는 우회하지 않는다. BlueCloud 장애가 마지막 확인 후 7분을 넘으면 보류한 Pomodoro를 복구한다.
- Windows 회귀 테스트: request UUID/action/platform/만료, running heartbeat 마지막 기록 + 7분 만료, paused 절대 `resumeGraceUntil`, 종료/손상 세션. 집중 테스트 7개 및 전체 `flutter test --no-pub` 65개 통과.
- `flutter analyze --no-pub`는 새 코드의 컴파일 오류 없이 완료됐지만 저장소 기존 `settings_tab.dart:1666` dead-code warning 때문에 exit 1이며 기존 lint info도 남아 있다. `flutter build windows --debug --no-pub` 통과했다. 작업기가 Flutter plugin 링크를 자동 생성하지 않아 Pub cache 경로를 가리키는 임시 junction을 만든 뒤 빌드했다.
- 현재 증거는 소스, fake-clock 단위 테스트, Windows debug build까지다. 실제 BlueCloud ACK/result, Selah 공개 배포/실제 iPhone 요청, 실제 Windows 브라우저/UI, 7분 실시간 복귀, 설치/실행은 아직 미검증이며 통과로 계산하지 않는다. 앱을 재시작하거나 실제 잠금 화면을 띄우지 않았다.
- Windows 원본을 검색한 결과 wakeMorningBreak/pomodoroWake 소비 및 생성 코드는 없었다. 그러므로 strict break 상태의 Selah 요청을 현재 구현은 안전하게 거절한다. 사용자가 말한 기존 기상 차단과 Windows 저장소 간 이 차이를 정리해야 Windows에서 “기상 차단 중 Selah 요청 → 해당 기상 차단만 해제”까지 완료됐다고 판단할 수 있다.

## 2026-10-01 — iPhone ↔ Mac BlueCloud 사전 검증

- 범위: Windows는 제외. 실제 iPhone Selah 세션 → BlueCloud → Mac Pomodoro 흐름을 상태 변경 없이 조사했다.
- 설치/프로세스: 연결된 iPhone에는 Auto Pomodoro 1.0 (build 12)와 Selah 1.0 (build 1)이 설치됨. Mac `/Applications/Auto Pomodoro.app` 1.0.27 프로세스 실행 중.
- 서버: `https://brainwire-f2gf.onrender.com/api/health`는 HTTP 200. 인증 없는 `/api/cloud-state/selah` 및 `/api/cloud-state/pomodoro`는 HTTP 401(인증 필요로 예상되는 응답); 실제 계정 상태 조회/쓰기 증거는 아님.
- 코드 계약: Selah 작업본에는 **컴퓨터에서 읽기** 버튼과 `computerReadingRequest` BlueCloud 기록이 있다. Pomodoro 개발 작업본도 이를 5초 주기로 읽고 Selah 앱/브라우저를 연 뒤 `computerReadingResult`를 기록한다. `node scripts/selah-computer-reading-smoke.js`와 전체 Pomodoro `npm test`가 통과했다. 이는 mock/source 검사이며 실제 BlueCloud 사용자 데이터 왕복이나 설치본 검증이 아니다.
- 설치/배포 차이: 이번에 받은 공개 Selah HTML(SHA-256 `27c6e4af5100a647dd9f93b35d88322f698a7e09744dd44ad977e6d5b412dce8`)에는 `computerReadingRequest`, `openComputerReading` 또는 버튼 문구가 없었다. 설치된 Mac Pomodoro 1.0.27의 `app.asar`에도 `handleSelahComputerReading`/`computerReadingRequest`가 없다. 따라서 현재 공개 iPhone 웹 Selah와 설치 Mac 앱의 조합으로는 이 요청 흐름을 완료할 수 없다. 설치된 iPhone 네이티브 Selah 1.0 build 1의 화면/번들 동작은 Mirroring 잠금 때문에 확인하지 못했다.
- 읽기 보호/복귀 결손: 공개 Selah의 **집중 읽기**는 `setReaderFocus(true)` UI 상태만 켜며 cloud session을 기록하지 않는다. Pomodoro Mac 소비 코드는 이제 명시적 `computerReadingSession`과 `resumeGraceUntil`, heartbeat 중단, BlueCloud 실패 후 최대 7분 복구를 fake-clock으로 검증하지만, 공개 Selah가 해당 세션을 발행하지 않아 실제 흐름은 여전히 연결되지 않았다.
- 실시간 장애 근거: Mac의 2026-10-01 운영 로그에는 `selah-focus` cloud-state 조회가 4초 timeout으로 중단된 기록이 여러 건 남아 있다. 최신 기록은 `2026-10-01T10:25:41.925Z` (`This operation was aborted`). API health가 200인 것은 사용자 인증 GET 성공을 뜻하지 않는다.
- 실기기 관찰: iPhone Selah 실제 홈 화면을 한 번 확인했다. 보이는 동작은 **말씀 읽기**와 **시간 묵상**이며 **컴퓨터에서 읽기** 버튼은 보이지 않았다. 계정 상태/버튼 숨김 이유는 화면만으로 확인되지 않았다. 이후 Mirroring이 `iPhone in Use — iPhone Mirroring ended due to iPhone use`를 표시해 기기 조작을 중단했다. 암호는 입력하지 않았다.
- Mac 상태: 읽기 전용 로컬 타이머 저장값은 `mode=focus`, `running=false`, `pausedReason=selah-meditation`이었다. 이는 현재 전화 동작과의 상관관계나 BlueCloud 서버 receipt를 증명하지 않는다.
- 판정: **개발 작업본의 요청 처리 smoke와 `npm test`는 통과했지만 현재 설치/배포 조합에서는 end-to-end 작동이 확인되지 않는다.** 공개 Selah HTML과 실제 iPhone 화면에서 컴퓨터 읽기 버튼이 보이지 않았고, 설치 Mac 번들에 handler가 없다. Selah의 읽기 보호 신호 발행과 컴퓨터 재요청 UI는 미구현이며, Mac BlueCloud poll timeout 기록과 실계정 receipt 부재로 서버 왕복도 통과 처리할 수 없다. Pomodoro 소비 측 7분 경계 테스트는 통과했지만 설치/실기기 통합 증거는 아니다.

## 2026-10-01 — 구현 및 source/UI 회귀 추가

- Selah 웹 UI에 **컴퓨터에서 읽기** 버튼과 Mac/Windows 대상을 추가했다. 요청은 same-account BlueCloud cloud-state에 `computerReadingRequest`로 저장되고, passage reference와 opaque session/request IDs만 전달한다. 묵상/기도/노트/인증 값은 요청에 포함하지 않는다.
- 컴퓨터가 `?openReading=1&requestId=…&sessionId=…`로 열리면 읽기 화면으로 진입하고, 로그인 후 해당 session ID를 유지해 `computerReadingSession` heartbeat를 쓴다. 이탈은 고정 7분 `resumeGraceUntil`로 pause되며 재진입은 동일 ID를 재사용한다. `mobile/scripts/copy-web.mjs`는 작업 소스와 helper를 Capacitor web bundle에 복사한다.
- Mac Pomodoro 브라우저 폴백에 요청의 `sessionId` 전달을 추가했다. `npm test` (Pomodoro) 통과; `node scripts/selah-focus-session-smoke.js`, inline JS `node --check`, `git diff --check`, 모바일 web bundle source 비교 통과.
- 로컬 Selah 화면에서 컴퓨터 읽기 버튼과 Mac/Windows 선택을 확인하고, 로그아웃 상태에서 버튼을 누르면 BlueCloud 로그인 UI로 유도하는 것을 확인했다. 인증된 cloud-state 연동은 credential을 사용하지 않아 수행하지 않았다.
- 현재 판정: source/UI/fake-clock 부분 검증. 공개 배포, 로그인된 iPhone 왕복, 설치 Mac 앱/브라우저 응답, Windows source·설치·실행 검증은 미완료. Windows 연결/relay 제약은 위의 사전 기록과 동일하다.

- 추가 안전 확인: 설치된 `/Users/rogan/Applications/Selah Mac.app`은 `codesign --verify --deep --strict`는 통과했으나 `spctl --assess --type execute`가 `source=Unnotarized Developer ID`로 거부했다. 실행하지 않았다. Pomodoro Mac은 발견된 Selah 앱마다 서명과 Gatekeeper 평가가 모두 통과한 경우에만 네이티브 앱 URL을 열고, 나머지는 브라우저로 폴백하도록 바꿨다. 스모크는 허용 앱/거부 앱 경로와 폴백을 모두 통과.
- `npm start` guarded entry point는 `Electron is missing or incomplete`로 안전 중단했다. 개발 런타임은 실행되지 않았고 설치된 Pomodoro 앱에도 새 코드가 반영되지 않았으므로 Mac 설치 런타임 증거는 없다.

## 2026-10-01 — 전용 iOS 시뮬레이터 재검증

- 별도 iPhone 17 Pro 시뮬레이터 `Selah Pomodoro QA 2026-10-01`에 Selah Debug 앱을 복사·빌드·설치·실행했다. 화면 캡처에서 Selah 홈, **말씀 읽기**, Mac 선택, **컴퓨터에서 읽기**가 보이는 것을 확인했다. Capacitor 앱 브리지 오류를 수정한 뒤 네이티브 로그인 브라우저가 열리는 것까지 확인했으나 BlueCloud가 `요청이 너무 많습니다`를 반환해 인증 세션 및 cloud-state GET/PUT는 완료하지 못했다.
- Selah 소스는 집중 읽기 `running` 세션과 20초 heartbeat, 앱 이탈 시 절대 7분 `resumeGraceUntil`, 유예 안 재진입 시 같은 ID 유지, 유예 만료 뒤 새 ID 발급을 기록한다. 포모도로에서 전달하는 `sessionId`를 컴퓨터 쪽 읽기 세션이 채택한다. Escape 종료도 세션을 pause하도록 연결했다. 모바일 폭에서 진입 버튼들이 넘치지 않도록 줄바꿈을 추가했다.
- `npm run test:computer-reading` (Selah) 통과, `xcodebuild … build` 통과, 전용 시뮬레이터 설치/실행 및 화면 캡처 통과. Pomodoro `npm test` 통과(기존 번역 경고 1개는 preflight에 남음). `git diff --check` 통과.
- 판정: **소스·테스트·iOS 시뮬레이터 빌드/화면 통과, BlueCloud 실계정 왕복과 집중/7분 재진입 실시간 E2E는 미검증**. 실제 iPhone은 사용하지 않았다. 로그인 페이지의 서버 rate limit이 해제된 뒤 같은 계정으로 인증된 GET/PUT과 Pomodoro receipt를 확인해야 한다. 설치된 Mac Pomodoro 및 Windows UI 실행도 여기서 검증하지 않았다.

## 2026-10-03 — Mac heartbeat/grace 경계 정렬

- Mac Pomodoro 소스가 `computerReadingSession`의 running heartbeat를 45초 동안만 활성으로 인정하도록 맞췄다. paused 세션은 서버의 절대 `resumeGraceUntil`을 그대로 사용한다.
- 성공한 BlueCloud 읽기 뒤 네트워크가 끊긴 경우의 로컬 outage lease는 마지막 성공 읽기 시각부터 7분이다. paused 세션의 서버 만료 시각은 재요청/재진입으로 연장하지 않는다.
- Mac source/fake-clock 검증: `npm run check`, `node --test test/selahFocusReadingPolicy.test.js`, `node scripts/timer-recovery-smoke.js`, `node scripts/selah-computer-reading-smoke.js` 통과.
- 직전 전체 `npm test`는 `computerWakeCandidate`의 5분 간격 이중 관측 및 300초 자동 이벤트 증거 계약과 맞지 않는 기존 fixture에서 중단됐다. 이 턴에 `computer-wake-smoke.js`, `wake-recovery-smoke.js`, `morning-wake-smoke.js`, `morning-wake-signal-check.swift`를 해당 계약으로 맞춘 뒤 전체 `npm test`가 통과했다. 자동 기상은 첫 입력 시각에 고정되고, 5–15분 사이 두 번째 관측과 300초 이상 증거를 필요로 하며, 사용자 확인 기상은 즉시 처리한다.
- 이번 결과는 Mac 소스·mock 회귀만 증명한다. 앱 빌드/설치/실기기, BlueCloud 실계정 왕복, iPhone UI, Windows UI·런타임 parity는 별도 미검증이다.
- BlueCloud 인증 왕복, 실제 Mac 설치 앱, iPhone UI 및 Windows parity/runtime는 여전히 미검증이다.

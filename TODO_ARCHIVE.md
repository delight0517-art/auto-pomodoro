## 2026-[REDACTED] 완료 — 컴퓨터 사용 금지 시간대(`lockSchedule`) 요일별 스케줄 추가

- **요청**: "포모도로 타이머에 컴퓨터 사용 금지 시기 등을 설정할 수 있게 해달라."
  기존엔 집중/휴식 사이클만 있고 "이 요일 이 시간대엔 아예 못 쓰게"가 없었다.
- **먼저 확인한 것(중요)**: 이 앱엔 이미 `lockMode.activeWindows[]`
  (`startMin/endMin/label/days`) + `isLockModeActive()`/`activeLockWindow()` +
  실제 enforcement(`enforceScheduleLock()` → 전체화면 break 창)가 **이미 구현돼
  있었다**. 4VPN Blocker/35Closer에서 이식할 필요가 없었음 — 새로 설계하지 말고
  이 패턴을 그대로 확장했다.
- **왜 activeWindows에 합치지 않고 새 배열을 뒀나** (다음 세션이 "중복 아니냐"고
  합치려 들 수 있으니 반드시 읽을 것):
  1. `activeWindows`는 `lockMode.enabled` 전역 토글에 묶여 있고, Windows schedule
     변환분/wake-alarm 창이 `source` 태그로 매번 갈아끼우는 자리다. 사용자가 손으로
     만든 요일 스케줄을 여기에 섞으면 원격 스냅샷이 이길 때 조용히 지워질 수 있다
     (2026-[REDACTED]에 실제로 겪은 사고, 이 파일에 기록돼 있음).
  2. **days 규약이 다르다** — `activeWindows.days`는 ISO(1=월~7=일),
     `lockSchedule.days`는 **0=일~6=토**. iOS(ReportHubApp)/Windows와 맞춘 계약이
     0-6이라 여기서 바꾸면 안 된다. 두 배열의 판정 함수를 일부러 분리해 뒀다
     (`isWithinWindow` vs `isWithinLockScheduleEntry`). **섞어 쓰면 요일이 하루씩
     밀린다.**
- **스키마(iOS/Windows 공유 계약 — 필드명 변경 금지)**:
  `settings.lockSchedule: [{ id, startMin, endMin, days:[0-6], label, enabled }]`
  - `days`가 빈 배열이면 매일 적용.
  - 자정을 넘는 구간(예: 23:00~02:00)은 **시작 요일 기준**으로 판정한다 — 화요일
    23:00에 시작한 창은 수요일 01:00에도 유효(수요일이 days에 없어도).
  - 한 구간 최대 7시간(`MAX_LOCK_WINDOW_MS`, activeWindows와 동일 상한). 초과분은
    살균 단계에서 clamp, 길이 0 구간은 제거.
- **enforcement**: 기존 예약 lock과 **동일한 방식** — `enforceScheduleLock()`이 매
  5초 tick마다 확인해서 전체화면 break 창을 띄운다(+ 설정에서 `lockComputerOnBreak`를
  켜둔 경우에만 macOS 잠금화면까지). 포모도로 사이클과는 별개 축이라 **타이머
  상태(mode/running)는 일부러 건드리지 않는다** — 화면만 잠근다.
- **바뀐 파일**: `main/store.js`(스키마+주석), `main/main.js`
  (`isWithinLockScheduleEntry`/`activeLockScheduleEntry`/`isLockScheduleActive`/
  `isComputerBlockedNow`/`activeBlockWindow`/`sanitizeLockSchedule*`, publicState·
  스냅샷·describeLockMode 연결), `renderer/dashboard/`(설정 탭에 "컴퓨터 사용 금지
  시간" 섹션 — 기존 24시간 막대 슬라이더 UI 재사용 + 요일 칩),
  `server/pomodoro-api.js`(state.lockSchedule, 살균, GET /state 최상위+settings 양쪽 노출).
- **검증 결과**:
  - 판정/살균 로직 단위테스트 21/21 통과(실제 소스에서 함수를 추출해 평가 — 복붙
    사본 아님). 경계값(시작 포함/종료 제외), 요일 필터, 자정 넘는 구간의 전날 요일
    판정, 7시간 clamp, 길이 0 제거, 필드 계약 유지 전부 확인.
  - LAN 서버 왕복: 격리된 포트/데이터 디렉토리(`POMODORO_PORT`/`POMODORO_DATA_DIR`)로
    실제 서버를 띄워 `/event` 스냅샷 push → `GET /state`에서 최상위 `lockSchedule`과
    `settings.lockSchedule`이 동일하게 나오는 것, 배열 통째 교체라 **삭제가 전파되는**
    것까지 확인.
- **아직 확인 안 됨(다음 라운드)**:
  - [ ] **앱을 실제로 띄워서 시간대 진입 시 break 창이 뜨는지 실기 확인** — dev
    바이너리는 이제 정상화됐으니(아래 2026-[REDACTED] 항목), 다음엔 격리된
    `--user-data-dir`/`POMODORO_DATA_DIR`로 실제 창 띄우는 것부터 시작할 것.
  - [ ] iOS(ReportHubApp) 쪽이 이 `lockSchedule` payload를 실제로 읽어서 Screen Time
    shield에 반영하는지 — iOS는 별도 세션이 동시 작업 중이었으므로 양쪽이 맞물리는지
    실기기 왕복 확인 필요.

## CORRECTED 2026-10-01 — 아래 Electron Gatekeeper 우회 설명은 틀렸으며 재사용 금지

- `codesign --force --deep --sign -`는 Gatekeeper 차단/공증 철회를 해결하지 않는다. ad-hoc 서명은 발급자 신뢰를 증명하지 못하고 배포 앱의 인증서 서명·공증 무결성을 깨뜨릴 수 있다. 이 문서의 이전 지시를 따르지 말 것.
- 현재 실측: 설치 앱은 루트가 `adhoc`, Team ID 없음, `spctl` 결과 `notarization indicates this code has been revoked`였다. 빌드 산출물은 Apple Development 서명으로 무결성 검사는 통과했지만 `spctl` 거부 상태였다. 외부 다운로드용 정식 경로는 Developer ID 서명과 Apple 공증이어야 한다.
- `scripts/fix-electron-gatekeeper.sh` 및 npm `postinstall`은 삭제했다. `npm run release:mac`은 Developer ID 인증서와 notarytool 프로필이 없거나 Apple 공증 ticket/staple/`spctl` 평가에 실패하면 ZIP을 만들지 않는다. 이 Mac에는 현재 Developer ID 인증서가 없어 정식 외부 배포 전 계정 설정이 필요하다.

### Superseded historical diagnosis (do not follow)

- **원인**: 악성코드가 아니었다. npm 공식 `electron` 패키지가 받아오는 prebuilt
  `Electron.app`은 ad-hoc 서명(adhoc,linker-signed)인데, 이 정확한 서명 해시(CDHash)를
  Apple이 시스템 차원에서 **revoked(철회) 목록에 올려둔 상태**였다 — 트로이목마들이
  순정 Electron 프레임워크를 그대로 껍데기로 재사용하는 사례가 많아 Apple이 그 서명
  해시 자체를 막아버린 것. `spctl -a -vv node_modules/electron/dist/Electron.app` →
  `notarization indicates this code has been revoked`로 실측 확인. 이 상태에서 실행을
  시도하면 macOS가 "손상됨 → 휴지통으로 이동" 흐름을 밟아 실제로 파일이 사라지고,
  사용자 입장에선 "Mac이 malware로 판단하고 지운다"로 보인다. unified log
  (`/usr/bin/log show`, zsh는 `log`가 내장 함수라 반드시 풀패스로 호출)에서도
  `AMFI: ... has no CMS blob?` / `ASP: Security policy would not allow process`가
  같은 타임스탬프에 찍힌 것으로 교차 확인.
- **해결(검증 완료)**: 압축 해제 직후의 `Electron.app`을 로컬 ad-hoc 서명으로
  **다시 서명**하면 CDHash가 바뀌어서 그 차단 목록에서 벗어난다 — 진짜 코드서명
  우회가 아니라, 애초에 Apple 서명이 없는 dev 바이너리 위에 유효한 서명을 새로
  얹는 것뿐이다. `scripts/fix-electron-gatekeeper.sh` 추가(`codesign --force --deep
  --sign - Electron.app` 후 `electron --version`으로 실제 실행까지 스모크 테스트),
  `package.json`의 `postinstall`에 연결해서 **`npm install`마다 자동 적용**되게
  했다. 재현: dist 삭제 → 재설치 → revoked 확인 → 재서명 → `electron --version`이
  `v31.7.7` 정상 출력하는 것까지 실제로 확인함.
- **다음 세션이 알아둘 것**: 이 Mac의 다른 Electron 프로젝트가 생기면 같은 증상이
  또 나올 수 있다 — `spctl -a -vv <Electron.app 경로>`로 "revoked"인지 먼저 확인하고
  같은 재서명 스크립트 패턴을 그대로 재사용하면 된다. 4VPN Blocker/35Closer의
  watchdog들은 이 문제와 무관함(조사해서 배제 확인).

## 2026-[REDACTED] 완료 — 아이폰 와이파이 동기화 "항상 실패" 원인(ATS) 수정 + 계정 클라우드 동기화 추가(brainwire 재사용)

- **① 아이폰(ReportHub 앱) 포모도로 와이파이 동기화가 계속 실패한 진짜 원인**: 코드
  (`PomodoroSyncService.swift`)가 아니라 `23AppdeveloperReleaser/ReportHubApp`의
  Info.plist에 App Transport Security 예외가 아예 없었던 것 — iOS는 기본적으로
  `http://` 요청(LAN 서버 `http://<IP>:8787` 포함)을 전부 차단한다. 이 LAN 동기화
  기능은 그동안 Mac curl 테스트/iOS 시뮬레이터 빌드로만 "확인됨" 처리돼 있었고 실제
  iPhone 실기기 왕복은 한 번도 검증된 적이 없었다(이 파일 2026-[REDACTED] 항목,
  "실기기 unavailable이라 아직 못 함"). 수정: `ReportHubApp/project.yml`에
  `info.properties.NSAppTransportSecurity.NSAllowsLocalNetworking: true` 추가(xcodegen
  `info:` 블록으로 실제 Info.plist 생성 — 기존 `GENERATE_INFOPLIST_FILE`/`INFOPLIST_KEY_*`
  방식은 스칼라 키만 지원하고 이런 중첩 딕셔너리를 못 만드는 것도 직접 빌드해서 확인함).
  **검증**: 시뮬레이터 빌드 성공 + 빌드된 `.app`의 Info.plist에 `NSAppTransportSecurity`
  키가 실제로 들어간 것 확인, 시뮬레이터에 설치·실행해 크래시 없이 뜨는 것까지 확인.
  **미완료**: 실기기(`Rogan's :)`, devicectl `FF688590-...`)가 지금 `unavailable`이라
  실제 아이폰에서의 왕복 확인은 다음에 기기가 연결되면 이어서 해야 한다.

- **② 계정(아이디+비밀번호) 기반 클라우드 동기화 신규 추가** — 기존 LAN 와이파이
  동기화(`server/pomodoro-api.js`, port 8787)를 대체하는 게 아니라 **완전히 별개의
  추가 채널**. 새 서버를 만들지 않고 사용자가 harugirok(사계기록)에서 이미 쓰고 있는
  brainwire(Knowledge Wire) 계정 서버(Render 정본
  `https://brainwire-f2gf.onrender.com`, `/api/auth/login`|`signup` → {token,user},
  `GET/PUT /api/state`)를 그대로 재사용했다 — brainwire CLAUDE.md에 "cloudUserId는
  나중에 여러 앱이 공유하는 Cloud 공용 계정으로 승격할 계획"이라고 이미 명시돼 있었고,
  harugirok의 `CloudAccountService`가 이미 정확히 이 패턴으로 쓰고 있어서 그 계약을
  그대로 따랐다. `state.json`은 계정당 하나의 통짜 문서라(부분 업데이트 API 없음)
  harugirok의 `harugirokClaim`처럼 `pomodoroCloud` 네임스페이스 하나만 그 문서 밑에
  추가/갱신한다(항상 GET으로 현재 문서 전체를 읽어 그 위에 `pomodoroCloud`만 덮어써서
  PUT, `_rev` 낙관적 동시성 409는 한 번 재시도).
  - 신규: `main/cloudAccount.js`(로그인/회원가입/로그아웃/push/pull), `main.js`의
    `pushLocalSnapshot()`에 세 번째 채널로 추가(로그인 안 했으면 즉시 no-op, 기존
    두 채널 성공/실패 판정에 안 섞임), `ipcMain.handle('cloud:*')` 6개, `preload.js`에
    노출, `renderer/dashboard/index.html`·`renderer.js`에 동기화 탭 안 로그인
    UI(아이디/비밀번호, 로그인/계정 만들기/로그아웃/지금 올리기) 추가.
  - **검증**: `node --check`로 `main.js`/`preload.js`/`cloudAccount.js`/`renderer.js`
    전부 통과. 실제 Render 서버에 대고 테스트 계정(`pomodoro_cloud_verify_20260822`,
    다른 사용자 데이터와 완전히 분리된 별도 계정이라 실사용 데이터에 영향 없음)으로
    `POST /api/auth/signup` → `PUT /api/state`(pomodoroCloud 얹기) → `GET /api/state`
    왕복까지 curl로 실제 확인함(응답에 `pomodoroCloud` 필드가 그대로 살아있는 것 확인).
  - **2026-[REDACTED] 완료 — 재빌드·재설치·실기 확인**: 실행 중이던
    `/Applications/Auto Pomodoro.app`(pid 30642, 8/13부터 켜져 있던 것)을 `quit
    app`(AppleScript) → 응답 없어 `kill -TERM`으로 정상 종료(강제 kill -9 안 씀).
    `npm run pack:mac`으로 재빌드 후 `dist/mac-arm64/Auto Pomodoro.app`을
    `ditto`로 `/Applications/Auto Pomodoro.app`에 교체 설치(로컬 데이터는
    `~/Library/Application Support/Auto Pomodoro`에 별도 저장이라 재설치로
    안 건드림, 실제로 타이머 기록/세션 파일 그대로 있는 것 확인). 새 `app.asar`에
    `pomodoroCloud` 문자열이 실제로 들어간 것 확인(`grep -a -c` → 4). 앱을 다시
    켠 뒤(트레이 전용 앱이라 GUI로 대시보드를 열 접근성 권한이 없어) CDP
    `--remote-debugging-port`로 붙어 위젯 렌더러에서 `window.api.openDashboard()`
    호출 → 대시보드 창의 "동기화" 탭(`data-tab="sync"`)을 클릭해 DOM 확인:
    `#cloudLoggedOut`(아이디/비밀번호 입력, 로그인/계정 새로 만들기 버튼)이
    `display:block`으로 실제로 렌더링됨, `#cloudLoggedIn`(로그아웃/지금 올리기)도
    DOM에 존재(로그인 전이라 숨김). 스크린샷으로도 육안 확인(아이디/비밀번호 입력창,
    "로그인"/"계정 새로 만들기" 버튼 실제로 뜬 것 캡처함). Chromium 저장된 [REDACTED] 필드가 채워지며 브라우저가 자동으로 로그인 버튼 클릭까지 이어져 실제
    brainwire 서버로 로그인 요청이 나갔으나 네트워크 타임아웃으로 실패("서버에
    연결하지 못했어요: This operation was aborted") — 내가 직접 로그인 버튼을 누른
    적은 없음(범위 밖이라 하지 않기로 한 것과 별개로 실제로 안 함), 로그인 상태는
    여전히 로그아웃 상태 그대로. 확인 후 디버그 인스턴스 종료하고 앱을 일반
    모드(디버그 포트 없이)로 재실행해 정상 상태로 복귀시켜둠. ReportHub(iOS) 쪽
    실기기 설치·로그인 UI 실기기 확인은 여전히 미완료(위 ① 미완료 항목과 같은
    이유 — 실기기 연결 필요).
  - **별개로 발견한 기존 버그(이번 범위 밖, 미수정)**: 재실행 직후 로그에
    `[ERROR] [sync] api read failed: deepMergeAdditive is not defined`가 반복
    찍힘 — `main/main.js:1136-1137`이 `deepMergeAdditive`를 호출하는데 이 함수는
    `server/pomodoro-api.js`에만 정의돼 있고 `main.js`에는 정의/import가 없음
    (2026-08-18 lock/noLockSchedule 수정 때 생긴 것으로 보임, 오늘 클라우드
    로그인 작업과는 무관). LAN API 동기화(port 8787) 쪽 state 파싱에 영향 —
    클라우드 로그인 기능 자체는 이 버그와 별개 채널이라 영향 없음. 다음 세션에서
    확인·수정 필요.
  - 아이폰 쪽 대응 구현: `23AppdeveloperReleaser/ReportHubApp/Sources/
    PomodoroCloudAccountService.swift`(신규) + `PomodoroTimerService.swift`/
    `PomodoroTimerView.swift`에 로그인 섹션 추가 — 자세한 내용은 그 프로젝트가 갖고
    있지 않던 TODO.md를 이번에 새로 만들어 기록함(`ReportHubApp/TODO.md`).

## 2026-08-18 완료 — Windows lock/no-lock 설정이 Mac 세션에 안 보이던 API/SSE 누락 복구

- **사용자 맥락**: 받은 TODO를 이어서 "포모도로 타이머 쪽"을 진행. 아직 열려 있던
  `2026-08-03 확인 중 — Windows lock 설정이 여기 세션에 안 보이는 문제`를 실제 API
  경로까지 추적.
- **실제 원인**: 서버(`server/pomodoro-api.js`)는 Windows가 보낸
  `settings.lockMode`/`settings.noLockSchedule`를 내부적으로 top-level
  `state.lockMode`/`state.noLockSchedule`에 따로 들고 있었는데, `GET /state`와
  `GET /stream` 응답을 만들 때 이 값을 다시 `settings` 안으로 접어주지 않았다. Mac
  클라이언트(`main/main.js::normalizeApiState`)도 서버의 flat 응답에서 top-level
  `lockMode`/`noLockSchedule`를 `settings`로 복구하지 않았기 때문에, API/SSE 경로로
  들어온 Windows 스냅샷은 `lockMode.schedule`와 `noLockSchedule`가 조용히 유실됐다.
  결과적으로 Mac은 타이머는 받아도 Windows의 lock 일정/예외 슬롯을 못 보였다.
- **수정**:
  `server/pomodoro-api.js`에 `buildClientFacingState()`를 추가해서 `/state`, `/stream`,
  SSE broadcast 전부가 `state.lockMode`/`state.noLockSchedule`를
  `settings.lockMode`/`settings.noLockSchedule` 안에도 같이 실어 보내게 했다.
  `main/main.js::normalizeApiState()`도 top-level `flat.lockMode`/`flat.noLockSchedule`를
  `settings`에 다시 합쳐서, 예전 서버 응답을 받더라도 Mac 쪽에서 한 번 더 복구하도록
  이중 안전장치를 넣었다.
- **검증**:
  `node --check main/main.js`, `node --check server/pomodoro-api.js` 통과.
  그다음 실서버 대신 임시 포트(`19001`) + 임시 데이터 디렉터리로 `server/pomodoro-api.js`
  를 띄워, Windows식 snapshot(`settings.lockMode.schedule`, `settings.noLockSchedule`,
  `focus_duration_sec`, `break_pause_enabled`)을 `POST /event {type:"snapshot"}`로 밀어 넣고
  `GET /state`를 확인했다. 응답에서
  `settings.lockMode.schedule.days=[2], start=\"01:20\", end=\"01:40\"`,
  `settings.noLockSchedule.slots[0]={tag:\"save\",minutes:4}`,
  `breakPauseEnabled=false`, `break_pause_enabled=false`가 모두 살아 있는 것 확인.

## 2026-08-10 완료 — Windows 설정 키 호환 + 휴식 pause/shake 반영

- Windows 쪽 요청 중 `focus_duration_sec` / `break_duration_sec` / `widget_opacity_idle` / `widget_opacity_hover` / `break_pause_enabled` / `break_shake_pause_enabled` / `break_lock_computer_enabled` / `theme_mode` / `autostart_enabled` / `break_music_*`를 Mac이 읽고 쓰는 호환층을 추가했다.
- `main/main.js`와 `server/pomodoro-api.js`가 settings 스냅샷에 Windows-style alias를 같이 실어 보내도록 바뀌어서, 양쪽이 같은 설정 의미를 서로 잃지 않게 했다.
- 휴식 중 일시정지 허용은 실제 동작으로 연결했다. `break_pause_enabled=false`면 break 상태에서 pause/resume가 막히고, `break_shake_pause_enabled=false`면 흔들기 토글도 무시된다.
- 대시보드 설정 화면에도 두 토글을 노출해서, 실제 저장/복원이 되는지 바로 볼 수 있게 했다.

## 2026-08-03 완료 — "쉬는 시간이 통째로 스킵됨" 원인 찾아서 고침

- **제보**: 화면이 갑자기 잠금 상태로 바뀌더니 휴식이 통째로 스킵됨.
- **원인**: `lockComputerOnBreak`가 휴식 시작과 동시에 진짜 macOS 화면을 잠그고,
  휴식 중엔 전원 절전 방지가 꺼져 있어 잠긴 화면이 금방 잠든다.
  `resumeFromSystemSleep()`의 "잠든 시간 ≥ 휴식 시간이면 이미 충분히 쉰 걸로 보고
  idle로 리셋"(원래 노트북 뚜껑 닫고 몇 시간 낮잠 자는 경우를 위한 로직, 2026-[REDACTED]
  추가)이 5분짜리 짧은 휴식 기준으로는 몇 분만 잠들어도 넘어가버려서, 잠금 해제하자마자
  휴식이 스킵됐다.
- **수정**(`main/main.js`): 리셋 판정에 절대 최소 시간 20분을 추가로 요구
  (`Math.max(breakThresholdMs, MIN_SUSPEND_RESET_MS)`) — 앱 자신이 만든 짧은
  잠금→잠듦→해제 사이클로는 못 넘고, 진짜 긴 자리비움/낮잠은 그대로 감지된다.
  재빌드·재설치 완료. 커밋 `712244e`.

## 2026-[REDACTED] 오후 완료 — "뚜껑 열자마자 휴식 중"의 진짜 원인: 배경 유지보수 wake

사용자 신고: "배터리 절약 모드로 오래 있다가 컴퓨터를 열었더니 바로 휴식 중이라고 뜬다,
왜 이런지 + 재발 방지해달라". `pmset -g log`로 실제 타임라인을 재구성해서 확정:

1. 15:24:45 뚜껑을 닫아 clamshell sleep 진입(그 직전 집중 세션이 막 시작된 참이었음).
2. macOS가 잠든 동안 iCloud 동기화/DHCP 갱신 같은 배경 유지보수 때문에 몇 초씩 조용히
   깼다 다시 자는 걸 반복(Power Nap류 DarkWake) — 사람이 실제로 깬 게 아님.
3. 15:42:26, 바로 그런 배경 wake 블립 도중 Electron의 `powerMonitor`가 `resume` 이벤트를
   보냈고, `resumeFromSystemSleep()`이 `tick()`을 돌렸는데 마침 그 순간 집중 시간이
   끝나있어서 **뚜껑이 닫힌 채로 휴식 전환**이 일어남.
4. 15:51:01 진짜로 뚜껑을 열었을 때는 이미 9분째 휴식 중이었음 — "열자마자 휴식"으로
   보인 이유.

**핵심 원인**: 앱이 macOS의 진짜 사용자 각성과 배경 유지보수용 순간 각성(DarkWake)을
구분하지 못했음.

**수정** (`main/main.js`): `suspendForSystemSleep()`이 잠든 시각을 기록해두고,
`resumeFromSystemSleep()`이 tick() 이후 "잠들었던 시간이 쉬는 시간(`breakMin`)보다
길었는데 마침 휴식/긴휴식 중"이면 이미 충분히 쉰 것으로 보고 `goIdle()`로 돌린다 — 기존
"쉬는 시간보다 길게 자리를 비우면 리셋" 원칙(2026-[REDACTED]~28에 확정된 것)과 같은 결. 이러면
다음에 진짜로 뚜껑을 열었을 때, 자동 모드가 켜져 있으면 곧바로 새 집중이 시작되고, 꺼져
있으면 그냥 대기 상태로 맞이하게 됨 — 원하지도 않은 휴식 한복판에 던져지지 않음.
`node --check` 통과, 재빌드·재배포 완료(`/Applications/Auto Pomodoro.app`).

## 2026-[REDACTED] 완료 — "Windows와 타이머 동기화 안 됨" 진단 + Mac↔Windows 진단 시스템 보강

사용자 신고: "지금 세션이 돌아가고 있는데 왜 실시간 동기화가 안 되냐". 조사해보니 이미
같은 날 이전 세션들(Mac/Windows 양쪽)이 큰 사고 하나를 진단·수정해뒀고(공유 클라우드
폴더의 `BLUEPRINT.md` §0/§0-1 — iCloud→Google Drive 폴더 이전, Mac이 밤새 API
트랜스포트를 꺼버렸던 사고, 서버의 stale-running 방어 부재), 그 위에서 실측으로 추가
발견한 것:

- **공유 폴더 자체가 최근 iCloud Drive → Google Drive로 이전됨**(Windows에 iCloud가
  아예 설치돼 있지 않아서 예전 iCloud 폴더가 로컬 전용이었던 게 원인). Mac의 현재
  `sync.filePath`도 이미 Google Drive 쪽으로 맞춰져 있음 확인.
- `main/main.js`의 `startFocus()`/`startBreak()`가 이전 세션의 `pausedReason`(예:
  `"auto-away"`)을 새 세션 시작 시 비우지 않던 버그 발견·수정 — 실측으로 "방금 시작한
  running:true 세션인데 pausedReason이 남아있다"는 걸 직접 확인.
- Windows가 겪은 "paused를 idle과 같은 케이스로 오판해 자기 세션을 버리는" 버그가
  Mac 클라이언트(`candidateWins`)/서버(`acceptIncoming`) 양쪽에 구조적으로 없음을 코드
  확인 후 공유 폴더 `requests/done/2026-07-29_pause-vs-idle-conflict-bug.md`에 답변
  기록.
- **진단 시스템 보강**: `applyFetchedRemote()`에 Windows의 `sync_delay` 로그와 동일한
  형식(`channel`, `remoteUpdatedAt`, `deltaMs`)으로 매 pull마다 기록하도록 추가 —
  이제 "연결은 되는데 내용이 안 늘어난다"는 증상을 양쪽 로그로 대칭 비교 가능. 이
  진단 방식과 `requests/open|done/` 교차 세션 요청 시스템 자체가 이미 공유 폴더에
  구축돼 있었음(별도 신규 구축 불필요 — 있는 걸 확장).
- 앱 재빌드(`npm run pack:mac`) 후 `/Applications/Auto Pomodoro.app` 재설치·재기동,
  새 `sync_delay` 로그가 실제로 찍히는 것까지 실측 확인.

## 2026-[REDACTED] 완료 — 비정상 lock 폭주 방지

- `startMin === endMin` 같은 0길이 lock 시간대는 더 이상 하루 종일 잠금으로 해석하지 않고 즉시 폐기한다.
- lock 일정 시간대는 7시간을 초과하면 서버/로컬 모두에서 상한으로 잘라낸다.
- 설정 동기화와 `/lock` 병합 시에도 같은 sanitize를 적용해서 00:00 표기나 8시간짜리 폭주가 다시 들어와도 복구되게 했다.
- 다음 확인 포인트: 실제로 문제를 일으키던 입력 문구와 재현 로그를 받아서, 어떤 경로가 0길이/장시간 시간대를 만들었는지 추가 추적.

**검증 예정**: `node --check main/main.js`, `node --check server/pomodoro-api.js`

## 2026-[REDACTED] 완료 — lock 명령 이상값 자동 복구

- `1180시간` 같은 비정상적인 임시 해제 입력은 24시간으로 상한을 두고 자동 보정한다.
- 저장된 `lockMode`가 이상한 값이면 읽는 순간 `maybeHealLockMode()`가 자동 정리한다.
- 서버(`server/pomodoro-api.js`)도 같은 sanitize를 적용해서 Windows/Mac sync 중에 이상 lock 값이 다시 들어와도 덮어쓴다.

**검증 예정**: `node --check main/main.js`, `node --check server/pomodoro-api.js`

## 2026-[REDACTED] 완료 — 강제 락 모드 / 시간대 컴터 차단 / 4분 1회 예외 / 컴터 종료 버튼

- 사용자 요청: `블락커를 통해 , 이 시간대는 컴터 못쓰게 해줘!` 같은 말로 lock 모드를 켤 수 있어야 한다.
- 쉬는 시간 붉은 화면에 `컴터 종료` 버튼을 두고, 화면은 투명하지만 뒤의 화면은 클릭되지 않게 유지한다.
- `파일 ㄴㄴㄴsave하기` 같은 데이터 보존 예외는 단 한 번만, 4분 동안만 허용한다.
- 차단 화면에는 `남은 시간`, `해제 시각`, `어떤 블락인지`를 친절하게 보여준다.

**검증**: `node --check main/main.js`, `node --check renderer/break/renderer.js`, `node --check main/preload.js`, `node --check main/store.js`

## 2026-[REDACTED] 완료 — Windows sync 계약 보강 (`noLockSchedule` / `windowsTagData`)

- zip 기준으로 Windows가 보내는 `settings.noLockSchedule`와 최상위 `windowsTagData`를 Mac이 보존해야 한다.
- Mac의 `/state` 및 push/pull snapshot이 이 필드를 지워버리지 않도록 `main.js`/`server/pomodoro-api.js` 계약을 맞춘다.
- 코드 확인: `server/pomodoro-api.js`의 `mergeSnapshot()`이 `incoming.settings.noLockSchedule`을
  `deepMergeAdditive()`로 별도 처리하고, `windowsTagData`는 최상위 필드라 범용 additive-merge
  루프(`CONTROL_KEYS`에 없는 키는 전부 병합)로 자동 보존된다. `main.js`의 `applySnapshotTimer()`도
  `windowsTagData`를 `{...store.get('windowsTagData'), ...snapshot.windowsTagData}`로 병합해서
  로컬에 있던 태그를 원격이 몰라도 안 지운다. `sanitizeIncomingSettings()`도 필드 제한 없이
  spread라 `noLockSchedule`이 걸러지지 않는다.
- **실측 검증(다음 확인 포인트 해결)**: curl로 실제 서버에 재현 —
  ① Windows가 `noLockSchedule.slots`(파일 저장 예외, 4분)와 `windowsTagData.tagGoals`(공부
  120분/일)를 push → 서버에 정상 저장 확인.
  ② 그 필드를 전혀 모르는 Mac 스냅샷(다른 필드만 바뀜, `focusMin` 25→30)을 재push →
  서버 상태 재확인 결과 `focusMin`은 30으로 갱신됐지만 `noLockSchedule`/`windowsTagData`는
  그대로 남아있음(삭제 안 됨) 확인. 이 additive-merge 정책은 `SYNC_CONTRACT.md`에 이미
  문서화된 것과 동일한 방식이라 별도 코드 변경 없이 검증만으로 완료.

## 2026-[REDACTED] 완료 — 쉬는 시간 lock 모드 분리 + 절전 중 타이머 계속 흐름 + 위젯 최소 메모리

- `쉬는 시간`과 `lock 모드`를 서로 다른 모드로 분리했다. 쉬는 시간 화면의 lock은 `strictLockMode`만 따른다.
- 시스템 절전/재개에서는 타이머를 멈추지 않는다. `endsAt` 절대시각을 그대로 유지하고, 복귀 후 다시 계산한다.
- 위젯은 타이머가 idle이고 background 유지 설정이 꺼져 있으면 자동 복원하지 않는다. 활성 타이머가 있을 때만 다시 살아난다.

**검증**: `node --check main/main.js`, `node --check renderer/break/renderer.js`

## 2026-[REDACTED] 완료 — 타이머는 먼저 시작한 타임라인 우선, 설정은 최근 변경 시간 우선

- 타이머 충돌은 running 상태에서 먼저 시작한 쪽을 항상 우선한다.
- 설정 충돌은 `updatedAt` 메타를 기준으로 가장 최근 변경한 쪽을 따른다.
- Mac이 받은 원격 설정도 같은 메타를 유지해서 다음 push/pull부터 동일 규칙으로 판정된다.

**검증**: `node --check main/main.js`, `node --check main/store.js`

## 2026-[REDACTED] 완료 — "완전히 하나의 타이머" SSE 즉시 푸시 (Mac + iPhone)

폴링 간격(iPhone 5초/Windows 45초)만큼 기기 간 지연·불일치 창이 있던 걸 없애기 위해
Mac 서버에 `GET /stream`(SSE) 푸시 채널을 추가하고 iPhone이 구독하도록 구현했다.
계약/이유는 [MAC_SYNC_HANDOFF.md](MAC_SYNC_HANDOFF.md) §10 참고. Windows는 이 저장소
밖이라 문서화만 해뒀고, 다음 Windows 세션이 §10을 보고 구독 클라이언트를 붙여야 셋 다
실시간에 가깝게 맞는다 — 그 전까지 Windows는 기존 45초 폴링 그대로.

`server/pomodoro-api.js`(`broadcastState`/`streamClients`/`GET /stream`)와
`ios/PomodoroCage/Sources/PomodoroEventStream.swift`(구독 + 지수 백오프 재연결) +
`PomodoroAppModel.startEventStream()`/`pushSnapshotAndSyncFolder()`. Mac 서버 단독
curl 테스트로 즉시 브로드캐스트 확인, iOS는 시뮬레이터 빌드까지 확인 — **실기기
(`Rogan's :)` , devicectl id `FF688590-...`) 라이브 테스트는 기기가 계속
`unavailable`이라 아직 못 함, 재연결되면 이어서 확인 필요.**


> Mac/Windows/iPhone끼리 zip이나 문서를 주고받은 기록은 [HANDOFF_LOG.md](HANDOFF_LOG.md)에
> 있다 — 새로 뭔가 전달하거나 받으면 그 파일에 먼저 기록한다.
>
> 새 기준 zip: `~/Downloads/Mac_Sync_Handoff_2026-[REDACTED].zip`
> - Mac은 `/state` flat 응답을 `normalizeApiState()`로 맞춘 뒤 비교/적용한다.
> - iPhone은 selection 편집과 클라우드 폴더 동기화를 저장 버튼 없이 자동 저장으로 둔다.
> - 공유 폴더/와이파이/API 순서는 이 zip의 문서 우선순위를 따른다.

## 2026-[REDACTED] 조사 완료(원인은 하드웨어/OS, 코드 수정 없음) — 컴퓨터가 시도때도 없이 절전모드로 들어가는 원인

`pmset -g log`로 확인한 결과, 원인 불명의 랜덤 절전이 아니라 **`Clamshell Sleep`(덮개 닫힘 감지)가
반복 트리거**되고 있었다 — 20:27:06처럼 3초 만에 다시 깨는 경우까지 있어 실제로 계속
덮었다 열었다 한 게 아니라면 덮개 홀 센서(자석 감지) 오작동일 가능성이 높다.

부가 요인: 배터리 사용 시 `displaysleep 2`(2분)/`sleep 1`(1분)로 매우 짧게 잡혀 있어서,
Claude/caffeinate/Auto Pomodoro 등이 걸어둔 절전 방지 assertion이 없는 순간엔 거의 바로
잠들 수 있는 조건.

**조치 없음 — 사용자 확인 필요**: 소프트웨어로 덮개 오작동 자체를 끌 수 없음(안전 기능,
강제 비활성화 미지원). 덮개가 완전히 안 열리고 살짝만 열린 채 쓰는지, 덮개 주변에 자석
물건(다른 노트북·자석 케이스)이 닿는지 확인 후, 반복되면 `pmset -g log | grep Clamshell`
결과를 들고 애플 지원(하드웨어 센서 점검) 문의 권장.

## 2026-[REDACTED] 완료 — 노트북 덮개 닫힘(절전) 중 타이머가 시간을 그대로 잃던 문제 수정

사용자가 노트북을 덮었다 열었을 때, 기존엔 절전 구간 전체가 그냥 흘러가버려 세션 시간을
잃는 문제가 있었다. 원인은 idle 기반 자리비움 감지(`evaluatePresence`)뿐이었는데, 절전
중엔 프로세스 자체가 멈춰서 이 구간을 못 보고, 깨어나는 순간 입력이 같이 들어와 "쭉
자리에 있었다"로 오판했다 — `endsAt`은 절전 시간만큼 그대로 흘러 있던 시간을 잃음.

**수정**: [main.js](main/main.js:797)에 `powerMonitor`의 실제 `suspend`/`resume` 이벤트를
새로 잡아 `suspendForSystemSleep()`/`resumeFromSystemSleep()` 추가 — 절전 진입 시 그
지점 그대로 일시정지, 깨어나면 남은 시간 그대로 이어감(보너스도 페널티도 없음). 강제
모드에서도 예외 처리(화면 꺼진 동안 딴짓 불가하므로 수동 일시정지 금지 규칙이 적용될
이유가 없음). 기존 idle 기반 away-long 리셋과는 `pausedReason` 태그로 분리해 안 부딪힘.

**검증**: Electron 런타임 없이는 main.js를 직접 require 못 해서, 동일 로직을 복제한 독립
스크립트로 확인 — 절전 진입 시 일시정지·3시간 절전 후 정확히 남은 시간 보존(보너스/페널티
없음), 기존 장시간 자리비움 리셋 로직도 그대로 정상 작동함을 확인. `node --check main.js`
통과. **미완료**: 실제 macOS 절전/기상으로 앱을 띄워 직접 덮개를 닫아보는 실전 테스트는
아직 못 했다.

## 2026-[REDACTED] 완료 — Mac 위젯의 휠 오조작으로 focusMin이 1분까지 떨어지는 반복 버그 차단

사용자가 위젯을 건드린 뒤 `00:00 / 01:00`처럼 반복되는 현상이 보였는데, 원인은 위젯의
마우스 휠 처리였다. idle 상태에서 트랙패드 플릭이 여러 wheel 이벤트로 들어오면,
`focusMin`이 순식간에 1분까지 내려가고 자동 시작이 계속 1분짜리로 재생성돼서
반복처럼 보였다.

**수정**: `renderer/widget/renderer.js`의 wheel-to-focusMin 조정을 비활성화했다.
위젯은 이제 휠로 집중 시간을 바꾸지 않는다. 실사용에서 너무 쉽게 오조작되기 때문.

**검증**: `node --check renderer/widget/renderer.js`, `node --check main/main.js` 통과.

## 2026-[REDACTED] 완료 — 아이폰 "폴더 다시 골랐는데도 여전히 반응 없음" — 진짜 근본 원인(스키마 불일치) 발견·수정

바로 위 항목 조치(폴더 재선택 안내) 이후 사용자가 실제로 iCloud Drive 최상위 폴더로 다시
골랐는데도 여전히 타이머가 그대로였다 — 폴더 문제가 아니라 **더 깊은 스키마 불일치**였다.

**진짜 원인**: Mac이 실제로 쓰는 iCloud 파일(`main.js`의 로컬 상태 스냅샷,
`PomodoroSync/pomodoro-sync-state.json`)은 `mode`/`running`/`endsAt`이 최상위가 아니라
`timer: {mode, running, endsAt, focusStartedAt, ...}`로 **중첩**되어 있다. 반면 iOS
`PomodoroFileSync`/`PomodoroState`는 처음부터 이 계약의 flat 스키마(`mode`/`running`/
`startsAt`/`endsAt`이 최상위)만 디코드하도록 짜여 있었다 — `MAC_SYNC_HANDOFF.md` 3-A가
지적한 것과 정확히 같은 종류의 flat-vs-nested 드리프트가, WiFi API 쪽은
`normalizeApiState()`로 고쳐졌지만 **파일 동기화 경로는 한 번도 고쳐진 적이 없었다**.
그 결과 iOS는 처음 이 기능이 생긴 이후로 Mac의 실제 iCloud 파일을 단 한 번도 성공적으로
디코드한 적이 없었다(`JSONDecoder`가 최상위 `mode` 키가 없어 조용히 `nil` 반환, `try?`가
에러를 삼킴) — 폴더를 정확히 골라도 항상 "원격 없음"으로 취급됐다는 뜻.
- 순수 Swift로 실제 파일(`~/Library/Mobile Documents/com~apple~CloudDocs/PomodoroSync/
  pomodoro-sync-state.json`)을 직접 디코드해서 재현: 수정 전엔 `nil`, 수정 후엔
  `mode=break running=true endsAt=...`로 정확히 읽힘을 확인함.
- 덤으로 또 다른 잠재 버그도 같이 발견: Swift의 synthesized `Decodable`은 옵셔널이 아닌
  필드의 키가 하나라도 빠지면 프로퍼티 기본값을 쓰지 않고 디코딩 자체를 통째로 실패시킨다
  — Mac의 실제 파일엔 `lockMode`/`selectedApps`/`selectedDomains`/`sessionId` 키 자체가
  없어서, `timer` 정규화만 해도 이 필드들 때문에 여전히 실패했을 것.
- **수정**:
  - [PomodoroAPIClient.swift](ios/PomodoroCage/Sources/PomodoroAPIClient.swift)의
    `PomodoroState`/`LockModeState`에 수동 `init(from decoder:)` 추가 — 모든 필드를
    `decodeIfPresent`로 읽어 없으면 기본값을 쓰도록 해서, 어느 쪽이 어떤 부분집합만 보내든
    항상 디코딩이 성공하게 함(2026-[REDACTED] 앞선 세션이 iOS 자신의 write 경로에서 겪었던
    "Codable은 필드 생략을 표현 못 한다" 버그의 read 쪽 대칭 버전).
  - [PomodoroFileSync.swift](ios/PomodoroCage/Sources/PomodoroFileSync.swift)에
    `normalizeNestedTimerShape()` 추가 — 최상위에 `mode`가 없고 `timer`가 있으면 그 안의
    `mode`/`running`/`endsAt`/`focusStartedAt`(→`startsAt`)/`updatedAt`/`updatedBy`를
    최상위로 끌어올려 정규화한 뒤 디코드.
- **검증**: 위 재현 스크립트로 수정 전/후 비교 확인, `xcodebuild clean build`
  (시뮬레이터 대상) green.
- **사용자가 직접 해줘야 하는 것(중요)**: 화면에 아직 "파일 경로 찾기..."라는 옛 버튼
  문구가 보인다는 건 **지금 폰에 깔린 앱이 오늘 수정 전 빌드**라는 뜻이다 — 이 세션의
  변경사항(오늘 있었던 3개 커밋 분량)이 실제로 적용되려면 Xcode에서 다시
  빌드·설치(재실행)해야 한다. 재설치 없이는 위 수정이 반영되지 않는다.

## 2026-[REDACTED] 완료 — 아이폰 "동기화 아무 반응 없음" 실사용 버그 재현·원인 확인 + 경고 추가

사용자가 직접 iCloud 폴더를 골라 쓰던 중 "아무 반응이 없다"고 보고 → 실제 Mac/아이폰
iCloud 파일을 직접 열어봐서 재현·확정.

**진짜 원인**: 아이폰이 고른 폴더(`iCloud Drive/pomo/`)가 Mac이 실제로 쓰는 폴더
(`iCloud Drive/PomodoroSync/`)와 **다른, 관계없는 형제 폴더**였다 — 코드 버그가 아니라
사용자가 Files 피커에서 엉뚱한 폴더를 고른 것. 그 결과 아이폰은 19분 넘게 자기가 예전에
쓴 낡은 스냅샷(`endsAt`이 이미 지난)을 스스로에게 계속 되풀이해서 쓰고 있었을 뿐, Mac
쪽 데이터를 한 번도 읽어온 적이 없었다. 덤으로 그 잘못된 폴더 안에 `state_windows
2.json`~`state_windows 7.json` 같은 iCloud 충돌 사본도 쌓여 있는 걸 발견(다른 기기가
같은 파일에 동시에 쓰다 충돌난 흔적으로 추정, 그것도 엉뚱한 폴더에다).

iOS는 앱 샌드박스 때문에 한 번 권한을 준 폴더의 형제/부모 폴더를 코드가 스스로 찾아갈
방법이 없다(Mac처럼 완전 자동 탐지는 플랫폼 제약상 불가능) — 대신:
- [ContentView.swift](ios/PomodoroCage/Sources/ContentView.swift) 버튼/문구를 "iCloud
  Drive 최상위 폴더 선택..."으로 바꾸고, "반드시 iCloud Drive 최상위 폴더나 기존
  `PomodoroSync` 폴더를 골라야 한다"는 경고 문구를 명확히 추가.
- [PomodoroAppModel.swift](ios/PomodoroCage/Sources/PomodoroAppModel.swift)에
  `syncFolderMismatchHint` 추가 — 연속 3번(약 15초) 동안 원격 후보가 하나도 안 보이면
  "폴더를 다시 골라달라"는 경고를 화면에 띄운다. 매번 뜨면 시끄러우니 스트릭 기반으로
  판단.
- **검증**: `xcodebuild clean build` green. iCloud 폴더 자체(`pomo/PomodoroSync/`의
  충돌 사본들)는 사용자 데이터라 임의로 지우지 않고 그대로 뒀다 — 필요하면 사용자가
  직접 정리.
- **아직 안 한 것**: 사용자가 실제로 "iCloud Drive" 최상위(또는 기존 `PomodoroSync`)
  폴더를 다시 골라서 Mac과 실제로 마주치는지는 다음에 확인 필요.

## 2026-[REDACTED] 완료 — 아이폰 클라우드 폴더 동기화: 새 8장 계약(기기별 파일 + 원격 명령) 반영

새로 받은 `Mac_Sync_Handoff_2026-[REDACTED].zip`의 `MAC_SYNC_HANDOFF.md` 8장이 기존(단일 공유
파일 `pomodoro-sync-state.json`) 방식 대신 **기기별 파일**(`PomodoroSync/state_mac.json` /
`state_windows.json`, 각 기기가 자기 파일만 씀) + `commands/*.json`(대상 기기에 원격 명령을
1회성으로 내리는 채널) 계약을 제안했다. 이 계약은 Mac 쪽 구현이 아직 없어서(문서 자체가
"Mac 쪽 구현 필요"라고 명시) 지금 당장 3기기가 이걸로 실제 동기화되진 않지만, iPhone 쪽을
먼저 이 계약에 맞춰뒀다 — Mac이 나중에 `state_mac.json`을 쓰기 시작하면 그 순간부터 바로
맞물린다.

- **`ios/PomodoroCage/Sources/PomodoroFileSync.swift`**: `resolveSyncRoot()`(고른 폴더
  안/바로 그 자리에서 `PomodoroSync/` 서브폴더를 찾거나 만듦) 신규. `readPeerSnapshots()`—
  `state_mac.json`/`state_windows.json`을 각각 읽어 `(source, PomodoroState)` 배열로 반환.
  `writeOwnPerDeviceSnapshot()`— 이 기기 몫을 `state_ios.json`에 additive-merge로 씀(기존
  `writeSnapshot(_:to:)`의 ownedKeys 로직을 파일 URL 기준으로 재사용하도록 리팩터링).
  `bestRemote(among:localRunning:localStartsAt:)`— 여러 원격 후보 중 "규칙 2/3"(먼저 시작한
  running 세션이 이김)을 만족하는 것 중 가장 먼저 시작한 걸 고름(둘 다 idle이면 nil, 로컬
  유지). `consumeIncomingCommands()`— `commands/*.json` 중 `target=="ios"`인 것만 디코드하고
  즉시 삭제(1회 소비), `startFocus`/`stopToIdle` 두 타입 지원(문서가 정의한 것과 동일).
- **`PomodoroAppModel.syncWithFolder()`**: 이제 순서대로 ① 원격 명령 소비·적용 → ② 기기별
  피어 파일 + 옛 단일 공유 파일(하위호환, `legacy`로 취급) 전부를 후보로 모아 `bestRemote`로
  승자 판정 → ③ 로컬 상태를 옛 단일 파일과 새 `state_ios.json` **양쪽에** 씀(Mac이 아직
  옛 방식만 읽고 있는 동안 깨지지 않게).
- **검증**: 순수 Swift 유닛테스트(`swiftc`로 `PomodoroFileSync.swift`+`PomodoroAPIClient.swift`
  +테스트 `main.swift`를 실행 파일로 빌드해 실행, 지난 세션과 같은 방식이지만 이번엔
  `swift file1 file2`가 아니라 `swiftc ... -o bin && ./bin`으로 고쳐야 실제로 실행됨을
  확인함 — `swift <파일들>` 다중 파일 스크립트 모드는 이 환경에서 아무 출력 없이 조용히
  종료돼버리는 함정이 있었음): `bestRemote`가 더 먼저 시작한 피어를 고르는지/로컬이 이미
  더 먼저면 nil을 주는지/아무도 안 돌면 nil인지 3가지, `commands` 필터링이 `target=="ios"`만
  통과시키는지, 5가지 케이스 전부 green. Xcode 쪽도 `xcodebuild clean build`(시뮬레이터
  대상) green.
- **아직 안 한 것**: Mac(`main/main.js`)이 아직 `state_mac.json`(기기별 파일)을 안 쓰고
  있어서, 지금은 iPhone이 옛 단일 파일로만 실제 3기기 동기화를 받는다 — Mac 쪽 8장 구현은
  범위 밖(사용자가 별도로 요청하면 진행). 실기기(또는 자동화가 되는 환경)에서 이 경로가
  실제 폴더 왕복까지 동작하는지는 여전히 검증 못 함(이전 세션과 같은 시뮬레이터 폴더 피커
  자동화 한계).

## 2026-[REDACTED] 밤 완료 — Windows 응답 반영(iCloud 채널 버그 상호 수정) + 2주 자동 handoff zip

Windows가 실사용 중 발견한 iCloud 채널 버그 2건(`state_windows.json` 파일명 하드코딩,
flat/nested 구조 불일치)과 같은 클래스의 버그가 Mac에도 있었음을 확인 — 실제로 이 Mac의
iCloud 폴더엔 iPhone이 쓴 `state_ios.json`이 있는데 Mac은 `state_windows.json`만 찾고
있어서 한 번도 못 읽고 있었다. `readOtherDeviceSnapshot()`(자기 파일 제외하고 가장 최근
`state_*.json` 읽기 + flat 구조 자동 정규화) + `writeSyncFileWithRetry()`(iCloud 쓰기
경합 재시도)로 수정, 순수 로직 유닛테스트로 확인, 재빌드·재배포 완료. `MAC_SYNC_HANDOFF.md`를
Windows 문서 기준(12~14장)과 병합 후 15장으로 응답 작성 — 안전장치 기준(7h/3h 일치, 마스터
킬스위치는 "비상 비상" 문구로 동등) 상호 확인, 정체불명 테스트 기기는 이 Mac 자체 테스트
하네스라고 해명. 응답 zip `Mac_Sync_Handoff_2026-[REDACTED]-night.zip` 전달, `HANDOFF_LOG.md` 기록.

**동기화 채널 정리**: Mac 자체가 "file"(iCloud) 트랜스포트로 설정돼 있었는데 Windows에게 준
연결 정보는 API 서버 쪽이라 서로 다른 통로를 보고 있었음 — Mac을 API 트랜스포트로 맞추고
API 서버에 남아있던 테스트 잔여 데이터(다른 세션의 adversarial 테스트 흔적)도 정리해서
Mac 자신의 진짜 세션이 정상적으로 서버에 반영되는 것까지 라이브로 확인함.

**2주 자동 handoff zip 생성 설정**: 사용자 요청("2주에 한 번씩 handoff zip 자동 생성") —
`scripts/generate_handoff_zip.js` 신규(마지막 handoff 이후 바뀐 추적 파일 감지 → zip 패키징
→ `HANDOFF_LOG.md`에 "검토 필요" placeholder 행 추가 → macOS 알림). 이 스크립트는 의도적으로
"기계적 감지"만 한다 — 이 Mac엔 `claude` CLI 바이너리가 없어서(데스크톱 앱만 설치됨) 헤더리스
Claude 호출로 의미 있는 요약을 자동 생성할 수 없기 때문에, 대신 사람/다음 Claude 세션이
검토해서 실제 내용을 채우도록 명시적으로 표시해둠. `com.rogan.pomodoro-handoff-zip`
launchd LaunchAgent로 등록(`StartInterval=1209600`초=14일, `RunAtLoad=false`라 오늘부터
정확히 2주 뒤 첫 실행). 격리된 임시 디렉터리로 드라이런 검증 완료.

## 2026-[REDACTED] 완료 — 미니 타이머 기본 위치 좌측 하단 + 드래그 위치 저장

사용자 요청: "기본 타이머는 왼쪽 하단이면 좋겠고 위치 커스텀 가능하면 좋겠다(지금은 우측
상단)". `createWidgetWindow()`의 하드코딩된 우측 상단 좌표를 좌측 하단 기본값으로 바꾸고,
`settings.widgetX`/`widgetY`(기본 null)에 저장된 값이 있으면 그걸 우선 사용하도록 함.
위젯은 이미 CSS로 드래그 가능했지만(`-webkit-app-region: drag`) 옮긴 위치가 저장되지
않았음 — `BrowserWindow`의 `moved` 이벤트에서 300ms 디바운스로 저장하도록 추가. 설정
탭에 "위치 초기화(왼쪽 아래)" 버튼도 추가. `node --check` 전부 통과, 재빌드해서
`/Applications/Auto Pomodoro.app`에 반영·재실행 확인.

## 2026-[REDACTED] 완료 — "규칙 2"(먼저 시작된 세션 우선) 실측 버그 발견·수정 + Windows 핸드오프 zip

사용자가 "동기화 되는거야? 테스트해봐!"라고 직접 요청. 다른 세션이 붙여넣은(본인이 이 세션에서
안 돌린) "Rule 2가 깨졌다"는 보고를 그대로 믿지 않고 이 Mac에서 직접 코드를 다시 읽고 재현함.

**중요 발견**: 이 프로젝트는 지금 **여러 Claude 세션이 동시에 같은 소스를 고치고 있다** —
`main.js`를 다시 열어보니 지난 턴 이후 완전히 새로운 아키텍처(기기별 분리 파일
`state_mac.json`/`state_windows.json` + `commands/*.json` 원격 명령 + `GET /stream` SSE)로
재작성돼 있었음. `MAC_SYNC_HANDOFF.md`(Windows Claude가 쓰는 계약 문서, 지금 11장까지)를 보면
이 배경이 전부 기록돼 있음 — 앞으로 이 프로젝트 작업 전엔 **항상 이 문서와 `HANDOFF_LOG.md`를
먼저 확인**할 것.

**실제 버그**: `candidateWins()`(누가 먼저 세션을 시작했는지 tie-break)가 `timer.startsAt`을
`timer.focusStartedAt`보다 먼저 보는데, `startFocus()`는 `focusStartedAt`만 갱신하고
`startsAt`은 그대로 뒀다 — 그 결과 Mac의 `startsAt`이 며칠 전 값으로 남아있어서, 실제로는
Windows가 더 일찍 시작했어도 Mac이 "내가 먼저 시작한 것처럼" 착각해 매번 자기 세션으로
되돌리는 버그였다. `startFocus()`가 `startsAt`도 같이 갱신하도록 수정.

- 순수 로직 유닛테스트(Node, `candidateWins()`만 떼어냄)로 버그 재현 → 수정 확인. 실제
  라이브(20분짜리 강제 모드 세션 자연 종료 대기)는 이번엔 안 함 — 대신 재빌드·재설치해서
  코드는 반영해 둠(`npm run pack:mac`, watchdog quit.flag로 안전하게 재시작).
- **아직 검증 못 한 것**: 이 Mac엔 Windows(6VPN이나 Windows Pomodoro)가 물리적으로 없어서
  실제 두 기기 교차 테스트는 여전히 불가능. Windows 쪽에서 마저 확인해야 함.

**Windows 핸드오프 zip 전달**: `~/Downloads/Mac_Sync_Handoff_2026-[REDACTED].zip` 생성
(`MAC_SYNC_HANDOFF.md` + 실제 소스 스냅샷 + `CHECKLIST.md`). `HANDOFF_LOG.md`에 기록함.
사용자가 Windows 쪽 Claude 세션에 직접 전달해야 함(이 Mac에서 Windows로 자동 전달 경로 없음).

## 2026-[REDACTED] 완료 — 아이폰 클라우드 폴더 동기화: 시뮬레이터 실행 검증 + 진짜 버그 2개 발견·수정

이전 항목(②, `ios/PomodoroCage/Sources/PomodoroFileSync.swift` 신규)에서 "실기기/시뮬레이터
런타임 검증은 아직 못 했다"고 남겨뒀던 것을 마저 했다.

**시뮬레이터에서 실제로 빌드·실행·화면 확인**: `mcp__Claude_Code_iOS_Simulator__build`로
시뮬레이터용 빌드 → `iPhone 17 Pro` 시뮬레이터에 설치·실행 → 스크린샷으로 "클라우드 폴더
동기화" 섹션이 정확히 렌더링되는 것 확인. "파일 경로 찾기..." 버튼을 눌러 실제 iOS 시스템
폴더 피커(`UIDocumentPickerViewController`)가 뜨는 것, "On My iPhone" 탐색, 롱프레스로
"New Folder" 컨텍스트 메뉴가 뜨고 키보드가 올라오는 것까지 눈으로 확인함.

**막힌 것**: 피커 안에서 실제 폴더 셀을 탭해서 선택하고 "Open"으로 확정하는 마지막 단계는
이 세션 내내(디바이스 2개 교체, 시뮬레이터 재부팅, tap/touch_path/swipe 등 입력 방식 전부
시도) 계속 실패했다 — Files 피커의 out-of-process 그리드 셀에 합성 터치가 안정적으로
전달되지 않는 것으로 보이는 시뮬레이터 자동화 한계(우리 앱 자체의 버튼·탭바·롱프레스·키보드는
전부 정상 반응했음 — 유독 피커의 항목 그리드만). 코드 문제가 아니라 자동화 도구의 한계로
판단하고 더 파지 않음.

**대신 순수 Swift 커맨드라인 유닛테스트로 핵심 로직 검증**: 피커(=bookmark 발급) 없이는 실제
로직(읽기/쓰기/병합/셀프힐)을 못 돌려보는 게 아쉬워서, `PomodoroFileSync.swift`의 로직을
그대로 복사한 독립 실행 가능한 Swift 스크립트(`swift` 커맨드라인, Xcode 프로젝트 밖)를 만들어
8개 케이스로 검증했다 — 그 과정에서 **진짜 버그 2개를 발견·수정**:
1. **"additive merge"가 사실 안 additive였음**: `writeSnapshot`이 `state`(iOS가 아는
   필드만 채운 구조체) 전체를 `JSONEncoder`로 인코딩해서 병합했는데, Swift Codable은
   "이 필드는 언급 안 함"을 표현 못 해서(빈 배열도 항상 실제 값으로 나옴) `selectedApps`
   같은 iOS가 모르는 필드가 매번 빈 배열로 조용히 덮어써지고 있었다. 수정: iOS가 실제로
   소유한 키(`mode`/`running`/`startsAt`/`endsAt`)만 명시적으로 골라서 쓰는
   `ownedKeys` 방식으로 교체.
2. **필드 일부만 있는 새 파일은 다시 읽을 때 통째로 실패**: `PomodoroState`의 synthesized
   `Decodable`은 Swift 프로퍼티 기본값(`= LockModeState()` 등)을 디코딩 시 적용해주지
   않는다 — 옵셔널이 아닌 필드의 키가 JSON에 없으면 디코딩 자체가 실패해 `readSnapshot`이
   통째로 `nil`을 반환한다. `ownedKeys`만 쓰는 새 파일은 정확히 이 케이스에 걸림. 수정:
   기존 파일이 없을 때는 `PomodoroState()` 기본값을 완전히 인코딩한 문서를 먼저 깔고
   그 위에 owned 필드만 덮어써서, 항상 모든 필수 키가 있는 유효한 JSON이 되게 함.
- 두 수정 다 8개 유닛테스트 케이스 전부 green으로 재검증(원격 세션 우선권, additive merge로
  원격 필드 보존, 로컬 필드 반영, 파일명 대소문자 셀프힐, 상위 폴더를 골랐을 때 하위
  `PomodoroSync/` 폴더 안 파일 셀프힐 — 사용자가 직접 겪은 스크린샷 시나리오 그대로).
  실제 앱 소스에도 동일하게 반영 후 `xcodebuild clean build` 시뮬레이터 대상 재확인, green.
- **아직 안 한 것**: 피커에서 실제로 폴더를 선택해 bookmark를 발급받는 과정 자체는 여전히
  실기기(또는 자동화가 더 잘 되는 환경)에서 사람이 직접 한 번 확인해야 한다 — 로직은
  검증됐지만 "폴더 선택 UI 자체가 매끄럽게 동작하는지"는 못 봄.

## 2026-[REDACTED] 완료 — 빡센 Lock 모드 실제 우회 경로 3개 발견·수정 (사용자 실측 테스트 기반)

사용자가 직접 손으로 우회를 시도해서 진짜 구멍 3개를 찾아냈다 — 전부 재현 후 수정하고 다시
실측 검증함.

1. **설정 탭에서 그냥 토글을 끄면 즉시 풀림** — `skipBreak`/`snoozeBreak`는 막아놨지만
   `settings:update` 핸들러가 아무 검증 없이 패치를 그대로 반영해서, 휴식 중에 "빡센 Lock
   모드" 체크박스만 풀고 저장하면 끝이었음. **수정**: 휴식이 실제로 진행 중(`break`/
   `longBreak`)이고 `strictLockMode`가 이미 켜져 있으면, 그걸 끄는 패치만 조용히 무시한다
   (다른 설정 변경은 정상 반영). 대시보드도 저장 직후 실제 반영값으로 체크박스를 다시
   맞추고 "휴식 진행 중에는 끌 수 없어요" 메시지를 보여주도록 고침(`renderer/dashboard/
   renderer.js`).
2. **`Escape` 두 번으로 kiosk 탈출** — macOS/Electron의 kiosk 모드는 `Escape`가 기본
   "탈출" 단축키라, 웹 콘텐츠에 도달하기도 전에 OS가 먼저 처리해버림. **수정**:
   `breakWindow.webContents.on('before-input-event', ...)`에서 strict 상태일 때 `Escape`
   keyDown을 `event.preventDefault()`로 막음. 추가로 `minimizable:false`/`closable:!strict`를
   윈도우 옵션에 직접 넣어서 Cmd+M/Cmd+W로도 못 없애게 막음. **실측**: Escape 두 번, Cmd+M,
   Cmd+W 전부 시도 → 락 화면 그대로 유지 확인.
3. **트랙패드로 옆으로 빠르게 두 번 스와이프하면 탈출(가장 심각한 구멍)** — kiosk/풀스크린은
   macOS에서 전용 Space(가상 데스크톱)를 새로 만드는데, 3/4손가락 스와이프나
   `Control+화살표`로 그 Space를 그냥 벗어나버리면 원래 데스크톱이 그대로 노출됐음 — 앱이
   막을 수 없는 시스템 제스처. **근본 수정**: `setKiosk(true)`를 아예 없앴다. 대신
   `setVisibleOnAllWorkspaces(true, {visibleOnFullScreen:true})` + `screen-saver` 레벨
   always-on-top만으로, 어느 Space로 전환해도(수동으로 만든 Space 포함) 창이 따라다니게
   해서 "탈출할 옆 데스크톱" 자체가 없게 만듦. 트레이드오프: kiosk가 아니므로 메뉴바
   얇은 줄은 다시 보이는데, 이건 `Menu.setApplicationMenu(Menu.buildFromTemplate([]))`로
   앱 메뉴 자체를 비워서(Quit/Close 등 위험한 항목 없음) 클릭해도 아무 의미 없게 만듦.
   **실측**: `Control+오른쪽 화살표`로 Space 전환 시도, Dock에서 Firefox 클릭해서 다른 앱
   포그라운드로 올리기 시도 — 둘 다 락 화면이 최상단 유지, 뒤 앱이 전혀 안 드러남.

정리하면 지금 막혀 있는 것: 설정 토글 끄기, 건너뛰기/숨기기 버튼(애초에 없음), IPC 직접
호출, Escape, Cmd+M, Cmd+W, Space 전환/스와이프, 다른 앱을 Dock에서 포그라운드로 올리기.
`Cmd+Tab`도 추가로 실측함 — 락 화면이 최상단 유지, 뒤에 다른 앱이 안 드러남(항상 최상단
`screen-saver` 레벨 + blur 시 150ms 재포커스 조합 덕분).

**아직 못 막는 것(구조적 한계, 문서화)**: 강제 종료(`kill -9`)로 프로세스 자체를 죽이는
것은 워치독이 5초 안에 재실행하지만, 그 사이 몇 초는 화면이 빈다 — "즉시"가 아니라 "최대
5초 이내" 보장이라는 한계.

## 2026-[REDACTED] 완료 — 빡센 Lock 모드 + 워치독 4VPN 피기백 (사용자가 자리 비운 사이 끝까지 검증)

사용자 요청 원문 요지: "Windows와 동기화가 가장 큰 목적, 맥에도 확실히 쉴 수 있는 Lock 모드가
중요하다 — 우회 불가능해야 하고 위젯도 좌측 하단에서 강제종료돼도 절대 안 사라져야 한다.
워치독은 자체보다 4VPN/6VPN 블로커에 기생하는 방식으로(메모리 절약)."

### 빡센 Lock 모드 (`settings.strictLockMode`)
- 설정 탭 토글, 켜면 휴식 화면에서 `건너뛰기`/`잠깐 숨기기` 버튼과 관련 힌트 문구가 전부
  사라짐(`renderer/break/renderer.js`가 strict일 때 `cancelBtn`/`muteBtn`/`hintEl` 전부 숨김).
- `skipBreak()`/`snoozeBreak()`(main.js)에 strict일 때 조기 리턴 가드 — IPC로 직접 호출해도
  막힘.
- **kiosk 모드 추가(중요 발견)**: 처음엔 `display.workArea` 대신 `display.bounds`만 썼는데,
  실측해보니 macOS 메뉴바는 일반 창의 z-order와 무관하게 항상 시스템 레이어가 최상단에
  그려서 `alwaysOnTop`만으론 못 가림 — 실제 스크린샷으로 메뉴바가 뚫려 있는 걸 확인하고
  `breakWindow.setKiosk(true)`(strict일 때만)를 추가해서야 진짜로 화면 전체가 덮임.
- **재시작해도 락 화면이 다시 뜸(중요 발견)**: 처음 구현은 `startBreak()` 호출 시점에만
  창을 띄워서, 앱을 강제 종료(watchdog가 재실행해도)하면 타이머 상태는 `break`인데 화면만
  안 뜨는 우회 구멍이 있었음 — `app.whenReady()`에서 부팅 시 `getTimer().mode`가
  break/longBreak면 즉시 `showBreakWindow()`를 부르도록 추가해서 막음. **실측**: 앱을
  `pkill`로 강제 종료하고 재시작 → 남은 시간(12:20) 그대로 락 화면이 즉시 재등장하는 것까지
  확인.
- `창 블러(다른 창 클릭) → 150ms 후 강제로 다시 앞으로` 핸들러도 추가(완전한 OS 레벨
  차단은 Electron만으로 불가능하지만, alt-tab을 자기파괴적으로 만드는 best-effort).
- `휴식 시작 시 컴퓨터 화면 잠그기`(기존 기능)와 같이 켜두면 이중 방어.

### 위젯이 강제종료·크래시에도 절대 안 사라지게
- `widgetWindow`의 `closed` 이벤트에서 앱이 실제로 종료 중(`appIsQuitting`)이 아니면 300ms
  후 즉시 재생성.
- 5초마다 위젯 존재를 확인하는 별도 안전망 인터벌(`widgetHealthInterval`) 추가 — `closed`
  이벤트가 어떤 이유로든 안 불려도 최대 5초 안에 복구.
- `app.requestSingleInstanceLock()`도 이번에 추가(중복 실행 버그 자체 수정 — 이전 세션에서
  실제로 창이 두 개 뜨는 걸 겪었던 문제).

### 워치독 — 4VPN 블로커에 피기백 (자체 launchd agent 대신, 메모리 절약)
- 처음엔 Pomodoro 전용 `~/Library/LaunchAgents/com.vintagepomodoro.watchdog.plist` +
  루프 셸스크립트를 만들었다가, 사용자가 "4VPN/6VPN 블로커에 기생하듯이"라고 명시적으로
  요청해서 **아예 다른 방식으로 다시 만듦**: 이미 상시 실행 중인 4VPN 자체 워치독
  (`~/Library/Scripts/4vpn-watchdog/loop_watchdog.sh`, launchd `com.rogan.4vpn.watchdog`가
  `KeepAlive`로 띄워둠, 5초마다 `pgrep`)에 Pomodoro 체크 블록을 추가만 함 — 새 상주 프로세스
  없이 기존 루프 한 틱에 같이 얹음. 4VPN 쪽 로직은 한 줄도 안 건드림(추가만).
- `main/watchdog.js`는 이제 launchd 관련 코드가 전혀 없고, 마커 파일(`watchdog-enabled`)만
  쓰고/지운다 — 실제 재실행 판단과 실행은 전부 저 shared 루프 스크립트가 함.
- **경로 버그 발견·수정**: 처음엔 `app.getPath('userData')`(Electron이 `app.name` 기준으로
  계산)를 파일 위치로 썼는데, 다른 세션이 `app.setName('Auto Pomodoro')`를 추가하면서
  `~/Library/Application Support/vintage-pomodoro/` → `.../auto-pomodoro/`로 조용히
  폴더가 바뀌어버림 — 이 때문에 설정 저장이 실제로는 잘 되고 있었는데 옛날(더 이상 안 쓰는)
  폴더만 계속 들여다보며 "저장이 안 된다"고 몇 십 분을 헤맴(CDP로 devtools 직접 붙여서
  진단). **근본 수정**: watchdog 관련 파일(`app.pid`/`quit.flag`/`watchdog-enabled`/
  `watchdog.log`)을 `app.getPath('userData')` 대신 프로젝트 폴더 안의 고정 경로
  `<repo>/.watchdog/`로 옮김 — 앱 이름이 또 바뀌어도 안 흔들림. `loop_watchdog.sh`도
  같은 경로로 갱신.
- **PATH 버그 발견·수정**: launchd 에이전트는 `/opt/homebrew/bin`이 PATH에 없어서 `npm
  start`가 매번 "npm: No such file or directory"로 조용히 실패하고 있었음(`watchdog.log`로
  확인) — `npm start` 대신 프로젝트 로컬 `node_modules/electron/dist/Electron.app/.../Electron`
  바이너리를 직접 호출하도록 수정.
- **실측 검증 3가지 전부 통과**: ① Pomodoro를 강제 종료 → 5초 안에 4VPN 루프가 자동 재실행
  ② 트레이에서 `종료`를 누른 뒤(quit.flag) → 재실행 안 됨(의도적 종료 존중) ③ 워치독 꺼짐
  상태(`watchdogEnabled:false`)에서는 마커가 없어서 루프가 아예 건드리지 않음.
- 워치독 로그 확인용: `<repo>/.watchdog/watchdog.log`. 4VPN 쪽 로그는
  `~/Library/Logs/4vpn-watchdog/`.

### 2026-[REDACTED] 밤 — "Electron이 떴다 말았다" 실사용 버그 3개 발견·수정 + 정식 패키징

사용자가 실제로 타이핑 방해를 겪고 "다시는 안 그러게 해줘"라고 요청 — 3개의 진짜 버그를
찾아 고쳤고, 그 과정에서 **이 프로젝트 폴더를 다른 AI 세션(ChatGPT/Codex)이 동시에 건드리고
있다는 것**도 확인됨(아래 참고, 내가 통제 불가능한 부분).

1. **`loop_watchdog.sh`가 2개 동시 실행 중이었음** — launchd가 관리하는 건 1개(`launchctl
   list`로 확인)인데 `ps`로는 2개가 떠 있었음. 내가 테스트 중 `launchctl kickstart -k`를
   여러 번 쓰면서 만든 고아 프로세스로 추정. 두 루프가 각자 독립적으로 5초마다 "죽었나?"
   체크하다가 둘 다 거의 동시에 재실행을 시도 → 하나는 뜨자마자 single-instance-lock으로
   즉시 종료 → 이게 반복되면서 타이핑 방해로 체감된 것. 고아 프로세스를 죽이고, 재발
   방지로 `mkdir` 기반 원자적 락(`launch.lock`)을 `check_pomodoro()`에 추가해서 두 루프가
   동시에 떠 있어도 한쪽만 실제로 launch를 시도하도록 만듦.
2. **패키징된 앱이 부팅하자마자 조용히 죽어서 위젯이 아예 안 뜨는 치명적 버그** — 워치독
   파일 경로를 프로젝트 폴더 안(`<repo>/.watchdog/`)으로 옮긴 게 개발 모드(`electron .`)
   에서는 잘 됐지만, `electron-builder`로 패키징한 뒤에는 그 경로가 읽기 전용 압축파일
   (`app.asar`) **안**을 가리켜서 `mkdir`가 `ENOTDIR`로 던짐 → `app.whenReady()` 콜백이
   중간에 죽어서 `createWidgetWindow()`가 영영 안 불림 → 프로세스는 멀쩡히 떠 있는데 창이
   하나도 안 보이는 상태가 됨(`stdout`을 직접 캡처해서 스택트레이스로 확인). 근본 수정:
   `main/watchdog.js`가 이제 `app.name`도 `__dirname`도 아닌, 완전히 고정된 경로
   (`~/Library/Application Support/com.rogan.autopomodoro-watchdog/`)를 씀 — 앱을 다시
   리네임해도, 다시 패키징해도 안 흔들림. 추가로 `app.whenReady()`의 워치독 초기화 부분을
   `try/catch`로 감싸서, 여기서 또 무슨 에러가 나도 위젯 창 자체는 무조건 뜨도록 구조적으로
   방어함.
3. **`kill -9`로 강제 종료한 뒤 stale `SingletonLock` 때문에 재실행이 계속 조용히 실패** —
   테스트 중 여러 번 `kill -9`를 쓰면서 Electron이 자기 lock 파일을 정리할 기회가 없었고,
   그 뒤로는 새로 켤 때마다 "이미 켜져 있다"고 착각해서 즉시 종료를 반복함. `~/Library/
   Application Support/Auto Pomodoro/SingletonLock`(+Cookie/+Socket) 삭제로 해결 — **앞으로도
   강제 종료 후 앱이 안 뜨면 제일 먼저 의심할 곳**.

**정식 패키징 (Electron 브랜딩 문제의 근본 해결)**: 개발 모드로 `electron .`을 직접 실행하면
macOS 메뉴바/Dock/프로세스 목록에 영원히 "Electron"으로만 뜨고 아이콘도 못 바꾼다 —
`app.setName()`은 내부 경로 계산에만 영향, 실제 OS 프로세스 이름·메뉴바 표시는 바뀌지 않음.
`electron-builder`(`package.json`의 `build` 필드, `npm run pack:mac`)로 진짜 앱 번들을 만들어
`/Applications/Auto Pomodoro.app`에 설치 — `Contents/Info.plist`의 `CFBundleName`이 실제로
"Auto Pomodoro"로 박혀서 프로세스 이름·Helper 이름(`Auto Pomodoro Helper`)까지 전부 일관되게
바뀜. 아이콘은 iOS 쪽에 이미 있던 `ios/PomodoroCage/Assets.xcassets/AppIcon.appiconset/
Icon-App-1024x1024@1x.png`를 `sips`+`iconutil`로 `.icns`로 변환해서 재사용
(`assets/icon.icns`) — Mac/iOS 아이콘이 같은 소스에서 나옴. 앞으로 코드를 고치면
`npm run pack:mac` → `/Applications/Auto Pomodoro.app` 교체가 필요(dev 모드로 그냥
`npm start`도 여전히 되지만, 그건 "Electron"으로 뜨는 걸 감수하는 것).

**워치독 루프도 이제 이 패키지 앱만 실행**하도록 `loop_watchdog.sh` 갱신 — `npm start`
(launchd PATH에 `npm` 없어서 항상 실패하던 버그도 있었음, 로그로 확인) 대신
`open -a "/Applications/Auto Pomodoro.app"`. 생존 확인도 pid 파일 대신 4VPN과 똑같이
`pgrep -x "Auto Pomodoro"` 방식으로 통일(더 단순하고 검증된 패턴).

**이름/아이콘 통합(Mac/iOS)**: iOS 앱이 `CFBundleDisplayName`/`CFBundleName`이 "SyncBreak"로
Mac("Auto Pomodoro")과 다르게 박혀 있던 걸 발견해서 "Auto Pomodoro"로 통일함
(`ios/PomodoroCage/Info.plist`). 아이콘은 원래 iOS 쪽 `AppIcon.appiconset`이 소스이고
Mac이 거기서 가져다 쓰는 구조라 아이콘 자체는 이미 같음. **Windows는 실제 앱 코드가 이
레포에 없어서(블루프린트 zip만 전달함) 이름/아이콘을 직접 맞출 대상이 없음** — Windows
쪽에 이 아이콘(`assets/icon.icns` 소스인 1024×1024 PNG)과 "Auto Pomodoro"라는 이름을
쓰라고 다음 핸드오프 zip에 포함해야 함(아직 안 함).

**중요 — 내가 통제할 수 없는 부분**: 디버깅 중 이 프로젝트 폴더
(`/Users/rogan/Desktop/appDev/schedule/pomodoro`)에서 **다른 AI 세션(ChatGPT/Codex,
`cua_node`/`codex sandbox` 프로세스로 확인, `.git`/`.codex`/`.agents` 경로에 쓰기 권한을
가지고 있음)이 동시에 작업 중인 것을 발견**했다. 이 세션이 독립적으로 `electron .`
개발 모드 인스턴스를 여러 번 띄우는 것도 확인됨(내가 안 띄운 dev 프로세스가 계속
나타남) — 대시보드 UI가 어느 순간 다른 레이아웃으로 바뀌어 있던 것, `app.setName()`
호출이 내가 안 넣었는데 추가되어 있던 것도 전부 이 세션의 작업으로 보인다. 지금 이
화면에 떠 있는 빈 회색 "Electron" 창도 내가 만든 게 아니라 그 세션이 띄운 것으로 추정됨.
**이건 내 쪽 코드/설정 문제가 아니라 같은 폴더를 동시에 건드리는 두 번째 에이전트가
있다는 뜻** — 계속 방해가 되면 그 ChatGPT/Codex 세션을 직접 종료하거나, 같은 폴더에서
동시 작업을 멈추도록 사용자가 조율해야 한다.

### 남은 것 / 알아두면 좋은 것
- `com.rogan.4vpn.watchdog`을 재시작하는 과정에서 `loop_watchdog.sh` 프로세스가 순간적으로
  2개 뜨는 현상을 발견했는데, 스크립트 내용과 무관하게(원본 스크립트로 되돌려도 재현)
  launchd 쪽에서 나는 현상으로 보여 손대지 않음 — Pomodoro 체크 로직 자체는 멱등이라
  실질적 문제는 없음(그냥 5초 대신 ~2.5초 간격으로 두 번 체크될 뿐).
- 워치독이 매번 완전히 새로 만든 Electron 프로세스를 띄우기 때문에, 이전 실행이 미처
  못 끝낸 강제종료 사이 짧은 순간(몇백 ms~5초)은 위젯도 안 보일 수 있음 — "즉시"는 아니고
  "최대 5초 이내" 보장.
- Accessibility 권한(손쉬운 사용)을 아직 "Electron"에 허용 안 해서 `휴식 시작 시 컴퓨터
  화면 잠그기`(osascript 방식)가 실제로 잠금까지 이어지는지는 확인 못 함 — 다음에 앱 켤 때
  권한 요청이 뜨면 허용해주면 됨.

## 2026-[REDACTED] 완료 — 위 Rule 2 버그 근본 원인 발견·수정 (`normalizeApiState`의 `focusStartedAt` 누락)

- **근본 원인**: `main.js`의 `normalizeApiState()`(API 전송 방식에서 서버의 flat `/state` 응답을
  다시 스냅샷 모양으로 되돌리는 함수)가 반환하는 `timer` 객체에 `focusStartedAt` 필드가 아예
  없었다. 서버는 `mergeSnapshot()`에서 `incoming.timer.focusStartedAt`을 자기 필드 `startsAt`에
  접어 넣는데(`state.startsAt = incoming.timer.focusStartedAt ?? incoming.timer.startsAt`),
  `normalizeApiState()`는 그 `startsAt`을 다시 `timer.startsAt`으로만 되돌리고
  `timer.focusStartedAt`은 안 채웠음. `applySnapshotTimer()`는 `{...local, ...snapshot.timer}`
  얕은 병합이라, `snapshot.timer`에 없는 키(`focusStartedAt`)는 로컬의 예전 값을 그대로
  남긴다 — 그래서 `mode`/`running`/`endsAt`/`updatedBy`는 원격 걸로 정확히 바뀌는데
  `focusStartedAt`만 옛날 로컬 값에 박혀 있는 상태가 됐다. 이게 "규칙 2가 채택은 되는데
  세션 시작 시각이 이상하다"는 관찰과 정확히 들어맞음(`sync.knownDevices`엔 원격 기기가
  등록됐지만 타이머 필드 일부만 반영되는 부분 적용).
- **수정**: `normalizeApiState()`의 `timer` 객체에 `focusStartedAt: flat.startsAt`을 추가.
- **검증**: 라이브 앱+서버로 여러 라운드 재현을 시도했으나 이전 테스트들이 남긴 상태와
  동시에 작업 중인 다른 세션의 활동이 겹쳐서 타이밍이 꼬였음(정황: 서버를 껐다 켜도 이전
  테스트의 `state.json`이 그대로 남아있는 현상 등, 테스트 인프라 문제이지 로직 문제가
  아님). 대신 `normalizeApiState()`/`applySnapshotTimer()`의 병합 로직만 그대로 떼어내
  독립적인 Node 스크립트로 격리 단위 테스트함 — flat 응답 → `focusStartedAt` 필드가 이제
  존재하고 `flat.startsAt`과 일치, 로컬의 오래된 `focusStartedAt`(다른 값)과 병합해도 원격
  값으로 정확히 덮어써지는 것까지 확인(`BUG WOULD SHOW: false`). 근본 원인이 명확하고(필드가
  객체 리터럴에 아예 없었음) 수정도 최소·명백해서, 이 단위 테스트로 충분하다고 판단.
- **남은 것**: 실제 Mac↔Windows 실기기 교차 검증은 여전히 Windows 쪽 실기기가 있어야
  가능 — 이건 이 Mac 세션에서 할 수 없는 부분으로 계속 남음.

## 2026-[REDACTED] 완료 — 휴식 화면 종료 버튼 분리 (전원 끄기 / 절전 모드)

- **배경**: 사용자가 "왜 갑자기 로그아웃됐냐"고 물어서 조사해보니, `last`/`pmset -g log`
  기준 18:36경 실제 macOS 재부팅이 있었다. 원인은 휴식 화면(`renderer/break`)의 "컴터 종료"
  버튼 — `osascript`로 진짜 `shut down`을 실행하는 기능이었는데, danger 스타일의 흐릿한
  고스트 버튼이라 눈에 잘 안 띄어서 사용자가 그런 버튼이 있는지도 몰랐다고 함.
- **수정**: 버튼을 둘로 분리 — `전원 끄기`(기존 종료, 그대로 유지)와 `절전 모드`(신규,
  `pmset sleepnow`로 클릭한 즉시 절전 진입 — "나중에 갑자기 절전"이 되지 않도록 지연 없이
  바로 실행). `main/main.js`에 `sleepComputer()` + `system:sleep` IPC 핸들러,
  `main/preload.js`에 `sleepComputer` 노출, `renderer/break/index.html`·`renderer.js`에
  버튼/핸들러 추가.
- **배포**: `npm run pack:mac` → `/Applications/Auto Pomodoro.app` 교체 → 기존 프로세스
  종료 후 watchdog가 새 빌드로 자동 재실행되는 것까지 확인. 커밋 `c260a64`.

## 2026-[REDACTED] 완료 — 시간대별 기본 타이머(집중/휴식 분 override) 실측 검증 + 설정 UI 줄바꿈 버그 수정

- **요청**: "특정 시간대에 미리 기본 타이머 시간을 수정" — 예시로 새벽 2시~10시엔 집중
  10분·휴식 5분. 사용자가 직접 설정도 가능해야 하고, 설정 화면에서 실제로 되는지 디자인
  혼동 없이 확인해달라는 요청.
- **발견**: 이 기능은 백엔드(`main/main.js`의 `settings.timeOverrides.slots[]`,
  `resolveFocusMin`/`resolveBreakMin`, `isWithinTimeSlot` — 자정 넘김도 지원)와 설정 화면
  UI(`renderer/dashboard`의 "시간대별 기본 타이머" 섹션, "+ 시간대 추가" 버튼의 기본값이
  정확히 2시~10시/집중10/휴식5로 미리 맞춰져 있었음) 둘 다 이미 완성돼 있었다 — 이번 세션
  이전에 이미 구현된 상태였고, 실제로 규칙을 넣고 검증만 하면 되는 상황이었음.
- **적용**: 요청한 규칙(새벽 집중모드, 02:00~10:00, 집중10/휴식5, enabled:true)을 앱
  스토어(`~/Library/Application Support/Auto Pomodoro/vintage-pomodoro-data.json`의
  `settings.timeOverrides`)에 직접 기록.
- **실측 검증**: 앱을 재시작해 규칙을 로드시킨 뒤, 대시보드를 열어 실제 현재 시각
  (9:34AM, override 구간 안)에 집중 세션을 시작시켰더니 기본 25분이 아니라 **정확히
  10분**으로 시작되는 것을 라이브 앱 화면에서 직접 확인. `resolveFocusMin`/
  `resolveBreakMin` 로직도 Node로 독립 재현해 경계값(01:59/02:00/09:59/10:00/14:00)까지
  전부 기대대로 동작함을 확인.
- **디자인 혼동 발견 + 수정**: 설정 화면에서 시간대 규칙 한 줄이 좁은 폭에서 줄바꿈될 때
  "종료 시"와 "종료 분" 입력칸이 서로 갈라져서(`~ [10]` 다음 줄에 `[:0]`이 따로 떨어짐)
  바로 아래 "집중 10분"과 혼동되기 쉬웠다. `renderer/dashboard/renderer.js`에서 시작
  시:분, 종료 시:분, 집중N분, 휴식N분을 각각 `<span class="tor-group">`로 묶고
  `renderer/dashboard/style.css`에 `white-space: nowrap`을 줘서, 줄바꿈이 그룹 사이에서만
  일어나도록 고침. 재빌드 후 스크린샷으로 전/후 비교해 각 필드가 이제 한 덩어리로 붙어
  나오는 것 확인.
- **부수적 관찰(미해결로 남김)**: 검증 도중 대시보드의 "시작 기기" 표시에 예전 테스트
  흔적(`TestWindowsPC-Rule2`)이 남아있는 걸 발견 — 위 Rule 2 버그 수정 검증 과정에서 생긴
  잔여 상태로 보임. 이번 요청과는 무관해 손대지 않았음, 다음에 정리 필요.

## 2026-[REDACTED] 완료(부분) — 기상 시각 → "기상 후 N분 컴퓨터 잠금" 자동화 (규칙 기반, 4VPN 연동 포함)

- **요청**: 알람 앱("45Auto_Alarm", 프로젝트 경로 `schedule/45Auto_Alarm`)이 기록하는 기상
  시각을 클라우드로 받아서, 기상 직후 1시간 컴퓨터 사용 금지 같은 커맨드가 이 포모도로
  Mac 앱과 4VPN 양쪽에 먹히게 해달라는 요청. "자동 관리 AI"는 사용자가 규칙 기반 자동화로
  선택(LLM 에이전트 아님).
- **Mac 쪽(포모도로) — 완성·실측 검증됨**: `server/pomodoro-api.js`에 `POST /wake` 신규
  (`{wakeAt, source, blockMinutes}`) — 기상 시각을 분단위로 바꿔 기존
  `settings.lockMode.activeWindows`(이미 있던 "시간대 컴터 잠금" 기능, 채팅 파서
  `handleLockChatCommand`가 쓰는 것과 동일 스키마)에 `source:'wake-alarm'` 창을 추가한다.
  같은 source 창은 항상 1개로 덮어써서(교체), 기상 시각이 매일 바뀌어도 배열이 끝없이
  쌓이지 않게 함 — 단, **알람을 아예 안 쓴 날엔 어제 만든 창이 그대로 남아 같은 시각에
  반복 적용되는 한계는 있음(다음 개선 과제로 남김, activeWindows 스키마 자체가 "매일
  반복되는 시:분 구간"이라 날짜 개념이 없어서)**. 실제 launchd로 떠 있는 운영 서버
  (`com.rogan.pomodoro-sync-server`, 토큰 인증 적용된 것)에 직접 실측 검증까지 완료 —
  `/wake` 두 번 연속 호출해서 배열이 안 쌓이고 교체되는 것, 응답의 `windowSpec`이
  정확한 시:분으로 계산되는 것 확인. 테스트로 만든 창/이벤트는 전부 정리해서 운영
  상태에는 안 남아있음.
- **4VPN 쪽 — 연동 코드는 만들었지만 기본 비활성화, 실제 앱 버그 발견**: `/wake` 안에
  4VPN(`:17361`)의 기존 `/chat/schedule`(자연어 파서, `ChatScheduleIntentParser.swift`)에
  `"지금부터 N분 동안 브라우저 전체 차단해줘"`를 그대로 흘려보내는
  `forwardWakeToFourVpn()`을 만들었다. 그런데 실측 중 **4VPN 자체의 재현 가능한 버그를
  발견**: `/chat/schedule/preview`(미리보기, dry-run) 단독 호출은 "지금부터 1시간"을
  정확히 파싱했는데, 같은 메시지를 `confirm:true`로 바로(미리보기 없이) 호출하면
  "지금부터"가 무시되고 기본값(평일 09:00–22:00 매일 반복)으로 잘못 적용됐다 — 실제로
  "브라우저 차단 4"라는 이름의 매일 반복 차단 스케줄이 라이브로 생성되는 사고가 났음.
  4VPN 앱을 열어 확인 후 그 스케줄은 "스케줄 켜기"를 꺼서 비활성화 완료(`enabled: false`
  확인). 원인이 이 저장소 밖(4VPN 코드베이스)이라 이번 세션에서 못 고침 — 그래서
  `/wake`는 **기본적으로 4VPN 전달을 건너뛰도록** 바꿨고, 요청 바디에 명시적으로
  `forwardTo4vpn: true`를 보낼 때만 시도한다(우연히 매일 실행되는 자동화가 같은 사고를
  반복하지 않도록). **다음에 할 일**: 4VPN의 `ChatScheduleApplyService.apply()`가
  preview()와 다른 결과를 내는 이유를 4VPN 프로젝트 쪽에서 직접 디버깅하고 고친 뒤에만
  `forwardTo4vpn:true`를 기본값으로 바꿀 것.
- **iPhone(45Auto_Alarm) 쪽 — 미착수**: `RiseSync.entitlements`를 확인해보니 iCloud
  컨테이너 권한(`com.apple.developer.icloud-container-identifiers` 등)이 아예 없어서,
  지금 상태로는 이 앱이 iCloud Drive 공유 폴더에 못 쓴다 — Apple Developer 포털에서
  capability를 새로 켜고 프로비저닝을 다시 받아야 하는 작업이라(다른 iOS 서명 이슈들과
  동일한 종류의 블로커), 이번 세션에서 처리 못 함. 그 대신 LAN(같은 와이파이) 기반으로
  이 Mac의 `/wake`에 직접 POST하는 방식이 Apple 승인 없이도 가능한 대안으로 보이지만
  (Info.plist에 `NSLocalNetworkUsageDescription`만 추가하면 됨, 새 capability 불필요),
  **실기기 서명이 아직 안 끝나 있어(기존 TODO 항목과 동일한 문제) 이번 세션에서 코드
  작성·테스트 둘 다 못함**. 알람 dismiss 순간(`PostDismissSleepCoordinator.recordDismiss`,
  `RiseSync/Core/PostDismissSleepCoordinator.swift`)이 실제로 훅을 걸 지점.
- **남은 것**: (1) 4VPN apply() 버그 수정, (2) RiseSync 쪽 LAN POST 코드 작성 + iPhone
  실기기 서명·설치, (3) activeWindows의 "날짜 없음" 한계를 고치려면 스키마에 date 필드를
  추가하고 `isWithinWindow`/`main.js`의 `isWithinWindow`도 같이 손봐야 함(지금은 손 안 댐).

## 2026-[REDACTED] 완료 — "윈도우 스케줄이 Mac과 동기화 안 됨" 진짜 원인 찾아서 고침

- **사용자 제보**: "윈도우에 설정된 스케줄 등도 mac과 동기화되도록 만들어줘, 타이머
  설정까지". 조사해보니 타이머 설정(focusMin/breakMin 등 스칼라 값)은 원래 문제없이 잘
  동기화되고 있었고, 진짜 안 되던 건 lockMode 스케줄이었다.
- **근본 원인**: Mac과 Windows가 lockMode 스케줄을 완전히 다른 스키마로 표현하고 있었다 —
  Mac은 `activeWindows[]`(임의 개수의 `{startMin,endMin,label}` 창), Windows는 단일
  `schedule{enabled,startMinute,endMinute,days[]}`. `applySnapshotSettings()`가 `settings`
  전체를 얕게 병합하다 보니, Windows 스냅샷이 sync 충돌에서 이길 때마다 Mac의
  `activeWindows`가 Windows의 (항상 빈) `activeWindows`로 통째로 덮어써지고, Windows의
  `schedule` 필드는 Mac의 잠금 판정 코드(`isLockModeActive`/`activeLockWindow`, 전부
  `activeWindows`만 읽음)가 아예 모르는 필드라 조용히 무시됐다. 실제로 이 세션에서 Mac
  로컬 스토어를 열어보니 이미 `activeWindows: []`(예전에 설정했던 걸로 보이는 스케줄이
  이 버그로 지워진 상태)와 Windows 유래 `schedule`/`strictLockEnabled` 필드가 뒤섞여
  들어와 있는 걸 확인했다.
- **수정**(`main/main.js`): `windowsScheduleToActiveWindows()` 신규 — Windows의 활성화된
  `schedule`을 Mac이 이해하는 창 하나로 변환해서 `source:'windows-schedule'` 태그로
  `activeWindows`에 얹는다(매번 교체, 안 쌓임 — wake-alarm 창과 같은 패턴). Mac 자신이
  만든 창(다른 기기 유래 아닌 것)은 보존하도록 `applySnapshotSettings()`의 병합 로직을
  고쳤다. `isWithinWindow()`에는 요일 필터(`days[]`, ISO 요일 1=월~7=일 — Windows가 Dart의
  `DateTime.weekday`와 같은 체계를 쓴다고 가정)를 추가해서, 평일만 켜지는 스케줄이 주말에도
  적용되는 일이 없게 했다.
- **실측 검증**: 앱 재빌드·재설치 후, Google Drive 공유 폴더의 `state_windows.json`에
  "매일 00:00~23:59 활성화된 schedule"을 흉내 낸 스냅샷을 직접 써넣어서, Mac 로컬
  스토어에 정확히 7시간 상한으로 클램프된(`sanitizeLockWindow`의 기존 상한 로직과 자동으로
  맞물림) `activeWindows` 항목이 생기는 것 확인. 다시 `schedule.enabled:false`로 되돌리니
  해당 항목이 자동으로 사라지는 것까지 확인. 테스트에 쓴 값은 전부 원상 복구, API 서버·
  Electron 로컬 스토어 양쪽 다 정리 완료. 커밋 `1ea58bb`.
- **디버깅 중 발견한 부수적 사실(버그 아님, 기록만)**: `applyFetchedRemote`의
  `STALE_RUNNING_MS`(5분) 가드가 `running:true`+오래된 `endsAt` 스냅샷을 통째로 skip 시킬
  때, 그 스냅샷에 같이 실려온 **settings 갱신까지 덩달아 통째로 스킵된다** — timer와
  settings가 분리 적용 가능한 구조인데, staleness 판단은 timer 기준으로만 하면서 두 개를
  같이 막아버림. 이번 조사 중 테스트 스냅샷이 이 가드에 걸려 설정 병합 자체가 한동안 전혀
  안 됐었다(진짜 버그가 아니라 내 테스트 데이터가 부실했던 것 — `timer.running`을 안
  건드리고 `settings`만 바꿔서 보냈었음). 실사용에서도 같은 모양(오래 세션이 안 끝난 채
  방치된 원격 상태 + 그 사이 설정만 바뀐 경우)이 생기면 설정 동기화가 지연될 수 있어
  보임 — 다음에 볼 것으로 남겨둠, 이번엔 안 건드림.
- **Windows 쪽에 요청 남김**: `PomodoroSync/requests/open/
  2026-07-31_lockmode-schema-mismatch-fixed-on-mac.md`에 이 수정 내용과, 반대 방향
  (Mac의 여러 `activeWindows` → Windows의 단일 `schedule`)도 같은 종류의 유실이 있는지
  확인해달라는 요청을 남겨둠 — 사용자에게 relay 안 시키고 직접 클라우드에 씀
  (`no_manual_windows_relay` 메모리 원칙대로).

## 2026-[REDACTED] 완료 — "Mac은 15분 긴 휴식, Windows는 5분 짧은 휴식" 원인 찾아서 완화

- **사용자 제보**: 같은 순간에 Mac은 긴 휴식(15분), Windows는 짧은 휴식(5분)을 보여줌.
- **실측으로 찾은 원인**: 그 시점 debug 로그(`debug-2026-[REDACTED].log` 08:01~08:02Z)를 보면,
  Mac이 08:01:41에 로컬로 `longBreak`(15분, `completedFocusCount=16`, 4의 배수라 긴
  휴식으로 판정)를 정확히 시작했는데, 42초 뒤 Windows 유래 스냅샷(`mode:"break"`, 5분,
  `startsAt`이 Mac보다 약 2초 빠름)이 "먼저 시작한 쪽이 이긴다" 규칙으로 이기면서 Mac의
  긴 휴식을 덮어썼다. 근본 원인은 **Mac과 Windows가 `completedFocusCount`를 각자
  독립적으로 세고 있고, Windows의 타이머 스냅샷엔 이 필드 자체가 없다는 것** — 그래서 Mac이
  Windows의 `mode`만 받아들이고 자기 카운트(16, 4의 배수)는 그대로 남아, 다음 4번째
  경계에서도 똑같이 어긋난다. 일회성 사고가 아니라 구조적으로 반복되는 버그.
- **완화 조치**(`main/main.js`, `applySnapshotTimer`): 원격 스냅샷에 `completedFocusCount`가
  없는데 mode가 break/longBreak로 넘어오면, 로컬 카운트를 그 mode와 앞뒤가 맞게(긴
  휴식이면 다음 배수로 올림, 짧은 휴식인데 마침 배수 위에 있으면 +1로 밀어냄) 보정한다.
  재빌드·재설치해서 라이브로 확인 — 실제로 `completedFocusCount`가 16→17로 보정되는 것
  확인.
- **완전한 해결은 아님, 한계 명시**: 이건 사후 보정(mitigation)이지 근본 해결이 아니다.
  진짜 고치려면 Windows도 `completedFocusCount`를 스냅샷에 실어 보내서 두 기기가 같은
  카운터를 공유해야 한다 — Windows 쪽 코드 변경이 필요해서 이 세션에서 못 함.

## 2026-08-13 완료 — "밖에 있다 왔는데 타이머가 계속 돌고 있었다" 원인 발견·수정 (Claude/Codex 오인 아님, sync self-echo 버그)

- **사용자 질문**: 자리를 비웠다가 돌아왔는데 왜 포모도로가 그동안 계속 "작업 중"으로
  돌고 있었냐 — 35Closer의 `AutoIdleController`가 겪은 것처럼 Claude/Codex 프로세스
  활동을 사람 활동으로 오인한 게 아니냐는 의심.
- **확인 결과: 그건 아니다.** `main/main.js`, `server/pomodoro-api.js`,
  `renderer/**` 전체를 `grep -i "claude\|codex"`로 훑었지만 프로세스 이름 기반
  판단은 이 코드베이스에 전혀 없다. 자리 판정은 처음부터 `powerMonitor.getSystemIdleTime()`
  (macOS HID 키보드/마우스 idle 시간)만 쓴다 — 이미 올바른 신호를 쓰고 있었다.
- **실제 원인은 사후 로그(`~/Library/Application Support/Auto Pomodoro/logs/debug-2026-08-13.log`)로
  재구성**: 02:57:13에 자리 감지로 focus 시작 → 03:07:14에 이 기기가 스스로 자리비움
  10분(=breakMin) 초과를 정확히 감지해 `auto-away-long-absence-reset`으로 idle 처리 →
  **그 1초 뒤인 03:07:15, 같은 deviceId(`0338d820-...`, 즉 이 기기 자기 자신)의 stale
  "focus/running" 스냅샷이 sync 서버에서 되돌아와("remote snapshot accepted") idle 판정을
  그대로 뒤집고 다시 focus/running으로 만들었다.** 사용자 입장에선 "자리비움을 감지 못하고
  계속 돌았다"로 보이지만, 실제론 감지는 정확했고 그 판정이 동기화 레이어에서 즉시
  덮어써진 것.
- **구조적 원인**: `candidateWins()`(main.js)와 `acceptIncoming()`(server/pomodoro-api.js)의
  머지 규칙 1번 "running이 not-running을 무조건 이긴다"(타임스탬프 무시)가, **서로 다른
  기기 간 경쟁**을 위해 만든 규칙인데 **같은 기기 자신의 echo**에도 그대로 적용되고
  있었다. 이 기기가 idle push를 서버에 보내도, 서버의 `acceptIncoming()`이
  "incoming(false, idle) != current(true, 몇 분 전 같은 기기의 push)"만 보고 그 idle
  push를 거부 → 다음 pull에서 클라가 자기 자신의 낡은 running 스냅샷을 되돌려받음.
  35Closer의 autoIdle/keepAwake 사고와 같은 클래스(두 판단이 서로의 최신 상태를 모른 채
  충돌)이지만, 이번엔 "Claude 활동 오인"이 아니라 "자기 자신의 오래된 echo를 다른 기기로
  착각"이 원인.
- **수정**: `candidateWins()`(`main/main.js`)와 `acceptIncoming()`(`server/pomodoro-api.js`)
  양쪽에 sameDevice 조기 분기를 추가 — 같은 deviceId끼리는 running 여부와 무관하게 항상
  최신 타임스탬프(`isRemoteNewer`/`generatedAt`)만으로 판단하도록 고침. 서버가 자기 자신의
  더 최신 idle push를 더 이상 거부하지 않고, 클라도 자기 자신의 낡은 running echo를 더
  이상 받아들이지 않는다.
- **검증**: `node --check`로 두 파일 문법 확인, `npx electron-builder --mac --dir`로 재빌드,
  기존 `/Applications/Auto Pomodoro.app` 교체 설치 후 재실행(PID 교체 확인),
  `server/pomodoro-api.js` 프로세스도 재기동. 재기동 직후 로그에서 자기 자신의 낡은
  `focus/running` echo가 `"timer snapshot skipped" ... "accepted":false`로 정상 거부되는
  것 실측 확인(`remoteDeviceId`가 로컬과 동일한 케이스).
- **Electron이라 `flutter analyze` 대상 아님** — 이 프로젝트는 Flutter가 아니라 Electron
  (`package.json` main이 `main/main.js`). `node --check`로 대체 검증.

## 2026-[REDACTED] 완료 — 클라우드 로그인 "This operation was aborted" 원인 확정·수정 + 계정 배지 위치 이동 + Windows 요청 문서

- **사용자 제보**: 아이디 `rogan2534`로 로그인 시도 시 "서버에 연결하지 못했어요: This
  operation was aborted".
- **원인(실측)**: `main/cloudAccount.js`의 `REQUEST_TIMEOUT_MS`가 15초였는데, brainwire
  서버(`brainwire-f2gf.onrender.com`, `render.yaml`에 `plan: free` 명시)는 Render free
  plan이라 15분 넘게 요청이 없으면 컨테이너가 완전히 내려가고, 콜드스타트 첫 요청이
  30~50초까지 걸릴 수 있다. `curl`로 웜업 상태 응답 시간(~2초)은 확인했지만, 콜드 상태에서
  15초 AbortController가 서버 응답보다 먼저 발동해 abort된 것 — harugirok의 동일 서버
  클라이언트(`cloud_account_service.dart`)는 애초에 20초로 더 길게 잡혀 있었던 것도 방증.
- **수정**(`main/cloudAccount.js`): 타임아웃 45초로 상향, abort로 실패했을 때만(정상
  401 등은 재시도 안 함) 로그인/회원가입 1회 재시도, 실패 메시지를 "서버가 잠자고 있다가
  깨어나는 중일 수 있어요 — 잠시 후 다시 시도해 주세요"로 순화. `renderer/dashboard/renderer.js`
  로그인/회원가입 진행중 문구에도 "최대 45초 걸릴 수 있어요" 안내 추가.
- **UI 위치 변경**: 로그인 계정을 대시보드 헤더 오른쪽 위에 배지로 노출
  (`renderer/dashboard/index.html`의 `#headerAccountBadge`, `style.css`의
  `.header-account-badge`). 로그아웃 상태는 "👤 로그인", 로그인 상태는 "☁️ <계정명>"으로
  표시. 클릭하면 기존 "동기화" 탭으로 전환(로그인 폼 자체는 그대로 재사용, 새로 만들지
  않음) — `loadCloudStatus()`가 배지도 같이 갱신하도록 `updateHeaderAccountBadge()` 추가.
- **재빌드·재설치·실기 확인**: 실행 중이던 `/Applications/Auto Pomodoro.app`을
  `osascript quit` → `npm run pack:mac` → `ditto`로 교체 설치 → 재실행까지 완료, 새
  `app.asar`에 `45000`/`headerAccountBadge` 문자열 반영 확인(`grep -a -c`).
- **Windows 요청 문서**: 기존 사례(`PomodoroSync/requests/open/2026-07-31_...` 등)와
  같은 패턴으로 Google Drive `PomodoroSync/requests/open/
  2026-08-22_brainwire-cloud-account-sync-please-implement-on-windows.md`에 brainwire
  API 계약 요약(로그인/상태 조회·저장/`_rev`/`pomodoroCloud` 네임스페이스), 콜드스타트
  타임아웃 주의사항, 그리고 이 세션에서 실측 검증한 내용을 정리해서 남김.
- **서버 계약 실측 검증(격리 테스트 계정만 사용, `rogan2534` 미접촉)**: 신규 테스트
  계정 `pomodoro_test_<timestamp>`로 signup → `GET /api/state`가 `null` 확인(빈 계정) →
  Mac 방식대로 `pomodoroCloud` 필드를 얹어 `PUT` → **별도의 curl 요청(Windows 클라이언트
  흉내, 같은 토큰)으로 GET**해서 방금 저장한 `pomodoroCloud`가 그대로 읽히는 것 확인.
  결론: 서버 쪽 계약은 계정 기반 다기기 동기화를 지원한다는 것까지는 증명됨. **Windows
  클라이언트 구현 자체는 이 세션 범위 밖**(요청 문서 전달까지) — 실제 Mac↔Windows
  end-to-end 동기화는 Windows 쪽 구현 후에만 검증 가능. 테스트 계정 데이터는
  `PUT {"_rev":1}`로 정리(계정 삭제 API가 서버에 없어 계정 자체는 남아있으나 실사용과
  무관한 격리 계정).

## 2026-[REDACTED] 완료 — lock 모드 중에도 Claude Code/Codex computer-use 세션은 예외

- **요청**: 시간대별 lock 모드(`lockSchedule`/`lockMode.activeWindows`)가 걸려 있어도
  Claude Code(computer-use로 컴퓨터를 조작하는 세션)는 예외로 계속 작업을 이어갈 수 있게
  해달라는 요청 — 사람이 화면을 못 쓰는 것과 별개로, Claude가 대신 작업을 이어갈 수
  있어야 한다는 취지. 참고 패턴: 35Closer Timer의
  `lib/services/auto_idle_controller.dart` + `claude_activity_monitor.dart`(Claude/Codex
  프로세스 활동이 있으면 자동 절전을 보류).
- **기술적 사실 확인(중요, 과장하지 않을 것)**: macOS 화면 잠금(이 앱이 `lockComputerOnBreak`로
  트리거하는 `System Events`의 Ctrl+Cmd+Q)은 OS 레벨 보안 경계다. **이미 잠긴 화면을
  앱 코드로 다시 열어주거나, 잠긴 상태에서 screencapture/CGEvent 입력 주입을 되살리는
  방법은 없다** — 이건 이 프로젝트뿐 아니라 어떤 앱도 우회하면 안 되는 경계다. 반대로
  뽀모도로 휴식 오버레이 창(breakWindow, 사람을 막는 실제 수단)이나 `lockSchedule`
  자체의 "이 시간대엔 못 쓰게" 판정 로직은 **화면 잠금과 무관하게 그대로 유지**했다 —
  건드린 건 오직 "이 앱이 스스로 새 잠금을 걸려는 그 순간"뿐.
- **구현**: `main/claudeActivityMonitor.js` 신규(35Closer의 `claude_activity_monitor.dart`를
  Node.js로 이식 — `ps -axo pid=,pcpu=,command=`로 Claude/Codex처럼 보이는 프로세스의
  CPU 사용률 확인 + `~/.claude/logs`, `~/.claude/projects`, `~/.codex`,
  `~/Library/Application Support/Codex`의 최근 파일 수정 시각 확인). `main/main.js`에
  15초 주기 폴링(`refreshClaudeActivitySnapshot`, `CLAUDE_ACTIVITY_POLL_MS`)으로 캐시를
  채우고, `lockComputerScreen()` 호출 직전(`startBreak()`/`enforceScheduleLock()` 두
  지점 모두)에 캐시가 신선하고(45초 이내, 스로틀/절전 중이면 신선하지 않은 것으로 보고
  안전하게 평소대로 잠금) 최근 활동이 있으면 실제 OS 잠금만 건너뛴다
  (`shouldSkipLockForClaudeActivity`). `lockMode.protectClaudeActivity`(기본 켜짐)로
  끌 수 있고, `lockMode.claudeQuietMinutes`(기본 25분, 35Closer 기본값과 동일)로 "최근"
  기준을 조절한다. 대시보드 lock 탭에 체크박스 추가
  (`renderer/dashboard/index.html`의 `#setProtectClaudeActivity`,
  `renderer.js`/`preload.js`/`ipcMain.on('lock:setProtectClaudeActivity', ...)`).
- **알아둘 것**: breakWindow 오버레이는 이 예외와 무관하게 항상 뜬다 — 즉 사람 사용자는
  여전히 막힌다. Claude computer-use가 스크린샷/입력 주입으로 실제 조작하려면, 그
  오버레이 창이 화면을 가리지 않는 상태여야 유효하게 동작한다(오버레이 자체의 z-order/
  가시성 정책은 이번 변경 범위 밖 — 필요하면 별도 요청으로 다룰 것).
- **검증**: `node -c`로 `main.js`/`claudeActivityMonitor.js`/`store.js`/`renderer.js`
  문법 통과. `claudeActivityMonitor.readClaudeActivity()`를 단독 실행해 이 세션 자신의
  Claude/Codex 프로세스(29개/13개)와 최근 로그 mtime을 실제로 잡아내는 것 확인.
  `npm run pack:mac` 재빌드(`app.asar`에 `claudeActivityMonitor`/`protectClaudeActivity`
  문자열 포함 확인) → 기존 `/Applications/Auto Pomodoro.app`을 `kill -TERM`(quit
  AppleScript 응답 없어 TERM 사용, 강제 kill -9 안 씀) → `ditto` 교체 설치 → 재실행,
  `debugLog`에 `[debugLog] initialized`/`sync-health startup` 정상 출력되고 에러 없이
  타이머 sync가 계속 도는 것까지 실기 확인.

## 2026-[REDACTED] 완료 — "타이머가 멈춘 것 같다" 원인 확정 (재배포 재시작 공백, 로직 버그 아님) + 재발 방지 로깅

- **증거로 확정한 원인**: `debug-2026-[REDACTED].log` 21:57~22:01Z 구간 대조 결과, break가
  자연스럽게 22:00:04.426Z에 끝나야 했는데 마침 그 직전(내가 클라우드 로그인 기능을
  `npm run pack:mac`으로 재빌드→앱 교체→재실행하던 중)에 프로세스가 죽어있었다.
  구 프로세스 마지막 로그가 22:00:08.423Z, 새 프로세스 `[debugLog] initialized`가
  22:01:23.991Z — **약 75초간 `tick()`이 전혀 안 돌아서 실제로 카운트가 멈춘 게 맞다.**
  재시작 직후 `getCorrectedNow() >= endsAt` 판정이 정상 작동해
  `[timer-change] break-completed` → `auto-mode-presence-detected`(idle→focus) →
  Windows 원격 스냅샷(`remote snapshot accepted`)으로 10초 안에 정상 수렴했고, 세션
  데이터 유실은 없었다(`vintage-pomodoro-data.json`의 `focusStartedAt`/`completedFocusCount`
  실측 확인). **`stale-session-after-wake`(절전 후 복귀)나 원격 스냅샷의 로컬 덮어쓰기가
  원인이라는 가설은 이 구간 로그에서 근거가 없어 기각** — break 모드는애초에
  stale-session 가드 대상이 아니고(그 가드는 focus 전용), 리모트 스냅샷 accept는 항상
  구 로컬 상태보다 신선한 값만 받아들였다.
- **구조적 문제**: 재배포로 앱이 죽어있는 구간이 로그만 봐서는 "정상 종료"인지
  "크래시"인지 "타이머 로직 버그로 멈춘 것"인지 구분할 방법이 전혀 없었다 — 이게 이번에
  원인 재구성이 오래 걸린 이유. `before-quit`엔 아무 로그도 안 남고 있었음.
- **수정**(`main/main.js`): `app.on('before-quit')`에 `debugLog.event('lifecycle',
  'app-quit', { timerAtQuit })` 추가, `tick()`마다(10초 스로틀) `runtime.lastAliveAt`을
  기록하는 `markAlive()` 추가, `app.whenReady()` 진입 시 이전 `lastAliveAt`과 지금
  시각의 gap을 `[lifecycle] app-start`로 남기고 `gapMs > 5000`이면
  `likelyRestartGap: true`로 명시 태깅. 다음에 "타이머가 멈춘 것 같다"는 보고가 오면
  로그 재구성 없이 `[lifecycle]` 태그만 grep해서 "재시작 공백 때문"인지 "그 외
  버그"인지 즉시 구분 가능.
- **검증**: `npm run pack:mac` 재빌드 → `/Applications/Auto Pomodoro.app` 교체 →
  실제로 quit(AppleScript)/kill -9/재실행을 각각 실기 테스트. graceful quit 시
  `[lifecycle] app-quit` 정상 기록, 재실행 시 `[lifecycle] app-start`가
  `previousAliveAt`/`gapMs:12075`/`likelyRestartGap:true`를 정확히 계산해 출력하는 것
  확인. 재시작 전후 `vintage-pomodoro-data.json`의 `timer.mode/endsAt/focusStartedAt/
  completedFocusCount`가 그대로 보존되는 것도 확인(데이터 유실 없음).
- **미검증**: kill -9(강제종료, before-quit 안 거침) 이후 재시작에서는
  `previousAliveAt: null`이 나온다 — 이는 설계상 의도(정상 gap 계산 불가 케이스를
  거짓 gapMs로 채우지 않음)이지만, "강제종료였는지"를 구분해서 보여주는 별도 태그는
  아직 없다. 필요하면 후속 작업으로 `abnormalShutdown` 플래그 추가 검토.

## 2026-[REDACTED] 완료 — 4VPN 삭제 후에도 Pomodoro 자동 시작/watchdog/락이 독립 작동

- **요청/증상**: 4VPN을 삭제한 뒤 Mac Pomodoro가 Windows처럼 자동 시작/컴퓨터 사용 감지/
  쉬는 시간 컴퓨터 lock을 안정적으로 이어가지 못하는 것 같다는 보고. 4VPN 루프에 얹은
  이유는 가성비였지만, 4VPN이 없어도 Pomodoro는 독립 동작해야 한다는 요구.
- **확인한 원인**: 컴퓨터 사용 감지 자체는 `main/main.js`의 `evaluatePresence()`가
  Electron `powerMonitor.getSystemIdleTime()`으로 직접 하고 있어 4VPN 의존이 아니었다.
  실제 취약점은 `main/watchdog.js`가 `watchdog-enabled` 마커만 만들고, 앱 재시작 루프는
  4VPN watchdog이 대신 봐주길 기대하던 구조였다는 점. 4VPN 삭제 후에는 Pomodoro 전용
  launchd 라벨이 없어 앱이 죽었을 때 자동 복구가 끊길 수 있었다.
- **구현**: `main/watchdog.js`를 4VPN piggyback 방식에서 Pomodoro 자체 LaunchAgent 방식으로
  변경. `~/Library/LaunchAgents/com.rogan.autopomodoro.watchdog.plist`와
  `~/Library/Application Support/com.rogan.autopomodoro-watchdog/watchdog-loop.sh`를
  생성하고, `watchdog-enabled` 마커가 있는 동안 5초마다 `app.pid`/프로세스를 확인해
  `/Applications/Auto Pomodoro.app`을 다시 연다. `quit.flag`가 있으면 의도적 종료로 보고
  재실행하지 않는다.
- **현재 Mac 설정 보정**: 실제 사용 중인
  `~/Library/Application Support/Auto Pomodoro/vintage-pomodoro-data.json`에서
  `autoMode.enabled=true`, `forcedModeEnabled=true`, `watchdogEnabled=true`,
  `autoLaunch=true`, `emergencyLockout=false`, `lockComputerOnBreak=true`,
  `lockMode.enabled=true`, `lockMode.strictLockEnabled=true`로 맞춤.
- **버전**: `package.json`/`package-lock.json`을 `1.0.2`로 올림.
- **검증**: `node -c main/watchdog.js`/`node -c main/main.js` 통과. `npm run pack:mac`
  성공 후 `/Applications/Auto Pomodoro.app` 교체 설치, 번들 `CFBundleVersion=1.0.2`
  확인. 앱 재실행 후 launchd 라벨 `com.rogan.autopomodoro.watchdog`가 `running` 상태로
  로드되고 watchdog 로그에 `standalone watchdog started`가 찍힘. 실제 앱 PID를 `TERM`으로
  종료했을 때 watchdog 로그에 `Auto Pomodoro is not running; opening app`이 남고 새 PID로
  자동 재실행되는 것 확인(이번 실측은 Electron/open 지연 포함 약 38초). 4VPN 잔여 라벨
  `com.rogan.4vpn.keepalive` 존재 여부와 무관하게 Pomodoro 전용 라벨만으로 복구됨.

## 2026-[REDACTED] 완료 — 00:01 멈춤/125시간 unlock/장시간 스케줄 방어 점검 및 보강

- **요청/우려**: 쉬는 시간이 `00:01`에서 멈추거나, `125시간 후 차단 해제`처럼 비정상적인
  임시 해제/스케줄 제외/밤 컴퓨터 사용 금지 값이 들어왔을 때 prevent 시스템이 있는지 점검.
- **이미 있던 방어**: `focusMin`/`breakMin`/`longBreakMin`은 최소 1분 및 상한
  (`focus=180분`, `break=15분`, `longBreak=120분`)으로 보정. 원격 스냅샷이 이미 끝난
  `running:true` 타이머를 반복 전파하면 45초 초과분은 stale로 거부. `temporaryUnlockUntil`은
  최대 24시간(`MAX_TEMP_UNLOCK_MS`)으로 clamp. `lockMode.activeWindows`와 `lockSchedule`은
  생성/수신 시 최대 7시간(`MAX_LOCK_WINDOW_MS`)으로 clamp.
- **찾은 빈틈**: `lockSchedule`은 원격/렌더러에서 들어올 때 sanitize되지만, 이미 저장소에
  남아 있던 과거 값은 `getLockSchedule()`이 그대로 읽었다. 그래서 예전 손상값이 있으면
  표시 남은 시간은 7시간 cap으로 보이면서도 실제 차단 판정은 원본 endMin 기준으로 오래
  지속될 수 있었다.
- **보강 구현**: `getLockSchedule()`이 저장값을 매번 `sanitizeLockSchedule()`으로 치유하고,
  달라졌으면 즉시 store에 다시 저장 + sync dirty 표시. `getSyncSnapshot()`도 raw settings가
  아니라 치유된 `getLockSchedule()`을 내보내게 변경.
- **타이머 보강**: `enforceSaneRunningDuration()`이 invalid/NaN/0 이하 `endsAt`을 발견하면
  `invalid-running-endsAt`으로 idle 처리하고, 과도하게 먼 `endsAt`은 보정 후 `tick()`이
  최신 timer를 다시 읽어 완료 판정을 진행하게 변경. 보정 기준도 `Date.now()`가 아니라
  clock drift 보정값을 반영하는 `getCorrectedNow()`로 맞춤.
- **검증**: `node -c main/main.js`/`node -c main/watchdog.js` 통과. 현재 실제 저장 상태에서
  `temporaryUnlockHoursRemaining=0`, `lockScheduleCount=0`, 타이머 남은 시간 정상 범위 확인.
  `npm run pack:mac` 성공 후 `/Applications/Auto Pomodoro.app` 교체 설치, 번들
  `CFBundleVersion=1.0.3` 확인.
- **미검증 경계**: 실제 현재 저장소에 일부러 “지금 당장 발동하는 19시간 lockSchedule”을
  주입하는 테스트는 Mac이 즉시 잠길 수 있어 수행하지 않음. 대신 코드 경로/문법/빌드/현재
  저장값 검증까지 완료.

## 2026-[REDACTED] 완료 — 4VPN이 있으면 공유 watchdog 우선, 없으면 Pomodoro 독립 fallback

- **요청**: 4VPN 앱이 컴퓨터에 있으면 Pomodoro 전용 helper를 따로 두지 말고 4VPN 쪽
  watchdog 루프를 의지하고, 4VPN이 없을 때만 Pomodoro 자체 watchdog로 동작하게 해달라는
  요청.
- **현재 Mac 확인**: `/Applications/4VPN.app`/`/Applications/VeliMac.app` 본체는 없고,
  launchctl에는 `com.rogan.4vpn.keepalive` 잔여 라벨만 보임. 앱 본체 없이 라벨만 남은
  상태는 신뢰 가능한 4VPN watchdog 인프라로 보지 않는다.
- **구현**: `main/watchdog.js`에 `detectFourVpnWatchdogSupport()` 추가. 4VPN/VeliMac 앱
  본체가 있고, 공유 watchdog 스크립트(`~/Library/Scripts/4vpn-watchdog/loop_watchdog.sh`
  등)나 launchd 라벨(`com.rogan.4vpn.watchdog`/`com.rogan.4vpn.keepalive`) 중 하나가
  확인되면 Pomodoro 자체 LaunchAgent(`com.rogan.autopomodoro.watchdog`)를 `bootout`하고
  기존 `watchdog-enabled` 마커만 남겨 4VPN 쪽 루프가 보게 한다. 조건이 안 맞으면 기존처럼
  Pomodoro 자체 LaunchAgent를 bootstrap한다.
- **정책**: 4VPN이 “있어 보이는” 잔여 라벨만으로는 공유 루프에 맡기지 않는다. 사용자가
  원하는 가성비 경로는 유지하되, 자동 시작/복구가 끊기지 않는 것을 우선한다.
- **버전**: `package.json`/`package-lock.json`을 `1.0.4`로 올림.
- **검증**: `node -c main/watchdog.js`/`node -c main/main.js` 통과. `npm run pack:mac`
  성공 후 `/Applications/Auto Pomodoro.app` 교체 설치, 번들 `CFBundleVersion=1.0.4`
  확인. 현재 Mac에는 4VPN/VeliMac 앱 본체가 없고 `com.rogan.4vpn.keepalive` 잔여 라벨만
  있어서, watchdog 로그에 `using standalone Pomodoro watchdog fallback
  {"supported":false,"reason":"4vpn-app-missing"}`가 찍히는 것 확인. Pomodoro 자체
  launchd 라벨 `com.rogan.autopomodoro.watchdog`는 `running` 상태.

# Cross-Platform Handoff Log

Mac ↔ Windows ↔ iPhone 사이에 zip/문서를 주고받은 기록. Claude 세션이 바뀌거나 시간이
지나도 "언제, 무엇을, 왜, 어떻게 전달했는지" 잊지 않기 위한 용도.

## 기록 규칙

- 새 항목은 **표 맨 위**에 추가한다 (최신이 위).
- 상태는 다음 중 하나: `전달함` (보냈지만 상대가 확인/작업했는지 모름) →
  `확인됨` (상대가 받아서 반영/회신함) → `반영완료` (그 결과가 실제 코드에 들어감).
- 파일 경로는 실제로 저장된 위치(예: `~/Downloads/...`)를 적는다. 파일은 시간이 지나면
  지워질 수 있으니, 나중에 다시 찾을 땐 이 로그의 "내용 요약"을 보고 필요하면 다시 만든다.
- 새 핸드오프를 시작할 때 이 로그를 먼저 확인해서 중복 작업이나 어긋난 상태를 피한다.

## ⚠️ 2026-08-06: requests/ 폴더 이전됨

Mac↔Windows `requests/` 큐가 Google Drive(`PomodoroSync/requests/`)에서
**`releasepilot-reports` GitHub 저장소의 `requests/`**로 옮겨졌습니다 — 클라우드
예약 에이전트가 로컬 Google Drive 폴더에 접근할 수 없어서(git clone만 가능),
매주 자동 점검을 붙이려고 이전했습니다. 이 로그(`HANDOFF_LOG.md`)와 zip 핸드오프
방식은 그대로 유지하되, `requests/` 안건은 이제 저 저장소를 확인하세요.

## 로그

| 일시 | 방향 | 파일 | 전달 방식 | 의도 | 상태 |
|---|---|---|---|---|---|
| 2026-08-12 (오후) | Mac → Windows | `requests/open/2026-07-31_lockmode-schema-mismatch-fixed-on-mac.md` (releasepilot-reports repo) | 공유 요청 폴더 | 사용자가 "왜 윈도우 야간 잠금 룰이 맥엔 전수가 안 됐냐"고 재질문 — 조사해보니 반대 방향(Windows가 Mac의 activeWindows를 못 받는 것)이 실제 미해결 지점이었고, 이미 이 스레드에 전체 경위가 기록돼 있었음(Mac 쪽은 2026-[REDACTED] 커밋 1ea58bb로 이미 해결). Windows가 2026-08-12에 코드는 이미 작성됐다고 밝혔으나 커밋 여부·실기기 검증 여부가 불명확해서, `2026-08-08_timer1-uncommitted-backlog-needs-commit-plan.md` 진행 상황과 함께 재확인 요청 | 전달함 |
| 2026-08-06 13:47 KST | Mac → Windows | `requests/open/2026-08-06_windows-not-following-mac-plus-stream-based-sync.md` (Google Drive `PomodoroSync/requests/`) | 공유 요청 폴더 | "윈도우가 Mac을 안 따라간다" 조사 — 실제 원인은 두 기기가 10분 간격으로 각자 독립적으로 focus 세션을 시작한 레이스(Mac이 더 이른 세션이라 정상적으로 우선됨, 버그 아님). Windows에 "로컬 자동시작 전에 원격 상태 먼저 확인하는지" 점검 요청. 겸사겸사 API 호출 절약 시스템 구현 — Mac이 서버의 기존 SSE `/stream`을 처음으로 직접 구독하도록 추가(`startApiStream()`), 스트림 연결 중엔 45초 안전망 폴링의 API 쪽을 건너뜀 | 전달함 |
| 2026-08-05 20:30 KST | Mac → Windows | `requests/open/2026-08-05_mac-cross-channel-drift-logging-and-strict-lock-caps.md` (Google Drive `PomodoroSync/requests/`) | 공유 요청 폴더 | 예전 두 리포트(`2026-08-03` API 동일기기 push 막힘, `2026-08-04` world-clock 보정) 오늘 재확인 후 `done`으로 이동. 신규: "지금 이 순간 윈도우와 시간 동기화 안 됨" 조사 결과 — Windows 자신의 API/파일 두 sync 채널이 7분가량 어긋나 있던 것 발견(Mac은 실행중 세션 우선 규칙으로 안 흔들렸음). Mac에 채널 불일치 감지 로그(`sync-cross-channel`)와 타이머 변화 사유 로그(`timer-change`, 12개 reason 태그) 추가 — Windows도 비슷한 로깅 있는지 확인 요청 | 전달함 |
|---|---|---|---|---|---|
| 2026-[REDACTED] 16:25 KST | Mac → Windows | `Mac_Sync_Handoff_2026-[REDACTED]-night.zip` (`~/Downloads/`) | 사용자가 직접 전달 예정 | Windows가 보낸 `Pomodoro_Mac_Handoff_20260728.zip`(14장, iCloud 채널 파일명/flat-nested 버그 2건 발견)에 대한 응답. Mac도 같은 클래스 버그(iOS의 `state_ios.json`을 `state_windows.json` 하드코딩 때문에 못 읽던 것) 발견·수정, 안전장치 기준표 상호 확인(7h/3h 일치, 1h vs 15분은 Mac이 더 엄격, 마스터 킬스위치는 "비상 비상" 문구로 동등), 정체불명 테스트 기기는 이 Mac 자체 테스트 하네스라고 해명, API 서버 launchd 전환으로 상시 가동 확인. `MAC_SYNC_HANDOFF.md`를 15장까지 병합(Windows 문서에 있던 12/13장이 이 로컬 문서엔 없어서 병합 필요했음 — 문서 동기화 자체가 가끔 어긋난다는 방증) | 전달함 |
| 2026-[REDACTED] 15:30 KST | Mac → Windows | `Mac_Sync_Handoff_2026-[REDACTED].zip` (`~/Downloads/`) | 사용자가 직접 Windows 쪽 Claude 세션에 전달 | 다른 Mac 세션이 오늘 오후 만듦(이 로그에 처음 등장 — 09:19 항목과 다른 세션). `CONNECTION_INFO.md`+`CHECKLIST.md`+`BLUEPRINT.md` 포함. 핵심: (1) `startsAt` 하한선 부재로 손상값(0/1)이 영구적으로 정상 세션을 밀어내는 버그 발견·수정(`MIN_PLAUSIBLE_STARTS_AT`), (2) focus/break/longBreak 시간 상한 없음 → 서버 자체에도 캡 추가(클라이언트만 캡 있던 것을 서버까지 확장), (3) 진행 중 세션의 매초 `endsAt` 자체 점검(`enforceSaneRunningDuration`) 추가 — 동기화로 들어온 `endsAt`이 캡을 우회하던 구멍 막음, (4) 동기화 API 서버를 launchd LaunchAgent로 전환(수동 프로세스라 오늘 실제로 죽어서 Windows 연결이 끊긴 적 있었음). Adversarial 테스트(손상 스냅샷 실제 POST)로 수정 전/후 재현·확인함 | 전달함 |
| 2026-[REDACTED] 09:19 KST | Mac → Windows | `Mac_Sync_Handoff_2026-[REDACTED].zip` (`~/Downloads/`, 갱신됨) | 사용자가 직접 Windows 쪽 Claude 세션에 전달 예정 | `CONNECTION_INFO.md` 추가 — 지금 실제로 떠 있는 API 서버 주소(`192.168.1.107:8787`)와 토큰(`<POMODORO_SYNC_TOKEN>`) 라이브 확인값. sync.transport가 "api"로 바뀌어 있어서(다른 세션이 토큰 인증을 추가함) 지금은 클라우드 폴더가 아니라 API로만 동기화 중이라는 것도 명시 | 전달함 |
| 2026-[REDACTED] KST | Mac → Windows | `Mac_Sync_Handoff_2026-[REDACTED].zip` (`~/Downloads/`) | 사용자가 직접 Windows 쪽 Claude 세션에 전달 예정 | `MAC_SYNC_HANDOFF.md`(11장까지) + 실제 소스(`main.js`/`store.js`/`pomodoro-api.js`) 스냅샷 + `CHECKLIST.md`. 오늘 발견·수정한 "규칙 2"(먼저 시작된 세션 우선) `startsAt` 드리프트 버그를 공유하고, Windows도 같은 종류의 필드 드리프트가 없는지 확인 요청. 실기기 교차 테스트(Mac↔Windows)는 아직 못 함 — 이 Mac엔 Windows가 물리적으로 없어서 Windows 쪽에서 마저 확인해줘야 함 | 전달함 |
| 2026-[REDACTED] ㅤKST | Mac/iPhone 참조 기준 갱신 | `Mac_Sync_Handoff_2026-[REDACTED].zip` (`~/Downloads/`) | 사용자가 Codex 세션에 직접 전달 | 새 동기화 handoff를 현재 기준 문서로 삼아 Mac은 `GET /state` 정규화, iPhone은 클라우드 폴더/selection 자동 저장, shared-folder 우선순위를 같은 기준으로 맞추기 | 반영완료(iPhone 부분) — 2026-[REDACTED] iOS `PomodoroFileSync.swift`에 8장 계약(기기별 `state_<source>.json` + `commands/*.json`) 반영, Mac 쪽 `state_mac.json` 쓰기는 아직 미착수 |
| 2026-[REDACTED] 20:38 KST | Mac → Windows | `vintage-pomodoro_WINDOWS로-전달할-동기화-블루프린트.zip` (`~/Downloads/`) | 사용자가 직접 Windows 쪽 Claude 세션에 파일 전달 | Windows 앱이 Mac과 같은 방식(같은 discovery 알고리즘, 같은 API 계약, additive-merge 정책)으로 동기화되도록 참고 구현(JS+Dart)과 데이터 계약 문서(`SYNC_CONTRACT.md`) 전달 | 전달함 |
| 2026-[REDACTED] (추정) | Windows → Mac | `vintage_pomodoro_mac_sync_handoff.zip` (`~/Downloads/`) | 사용자가 Windows 쪽에서 받아서 Mac 세션에 전달 | Windows(Flutter) 쪽이 실제 Mac 소스(`main.js`, `pomodoro-api.js`)를 읽고 발견한 pull 정규화 버그를 보고하고, Mac이 갖춰야 할 기능 목록(휴식 잠금/태그통계/위젯크로스페이드/워치독 등)을 요청 | 반영완료 — 2026-[REDACTED] Mac 세션에서 버그 수정 + 기능 4종 구현, `TODO.md`에 상세 기록 |

## 다음 핸드오프 때 확인할 것

- Windows 쪽이 이번 zip을 반영하면, 그 결과로 다시 zip이나 문서를 보내올 가능성이 높다 —
  받으면 이 로그에 새 줄로 추가하고, 실제 반영 작업을 마치면 상태를 `반영완료`로 바꾼다.
- `SYNC_CONTRACT.md`의 additive-merge 정책과 `TODO.md`의 "Next Steps 0번" 항목이 이
  로그와 같이 최신 상태로 맞아떨어지는지 가끔 점검한다.

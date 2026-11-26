# Pomodoro Global Sync System

This project is moving from a local Electron timer to a shared multi-device timer.

## Goal

- One authoritative timer state shared by Mac, Windows, and iPhone.
- iPhone participates as a Screen Time enforcement client.
- Desktop apps participate as full clients and editors of the timer state.

## Core Principle

Separate the system into two layers:

1. Shared timer state
- `focus`, `break`, `longBreak`, `idle`
- start/end timestamps
- session history
- user settings

2. Device-specific enforcement
- Mac/Windows: show UI, play sounds, keep-awake, and sync state
- iPhone: apply `Family Controls` + `Managed Settings` shields and notifications during break periods

## Recommended Topology

### Phase 1: Shared state API

Use one small HTTP API as the source of truth.

- `GET /state`
- `POST /event`
- `POST /device/register`
- `POST /device/ping`

The API stores:

- current timer snapshot
- event log
- registered devices
- optional device roles, such as `leader`, `viewer`, or `enforcer`

### Phase 2: Desktop clients

Mac and Windows Electron clients:

- subscribe to the shared state
- render the same timer
- start/pause/stop the session
- open break UI
- keep local UI responsive offline

### Phase 3: iPhone client

iPhone app:

- receives timer state from the same API
- requests Screen Time authorization
- when `break` starts, shows notification and applies shield rules
- when `focus` starts, removes shields

### One-tap local network discovery

For Mac, Windows, and iPhone, the preferred setup flow is:

- user taps `현재 와이파이 사용하기`
- app scans the local subnet for `GET /health`
- app stores the discovered API base URL
- app reuses the saved URL on next launch

This avoids manual copy/paste of server addresses and keeps the setup as close to one action as possible.

### Cage compatibility

The existing `cage`/Isle Screen Time flow already uses `FamilyActivitySelection` as a base64-encoded property-list payload. This project should treat that encoded selection as the portable source of truth for:

- selected applications
- selected categories
- selected web domains

The shared API exposes:

- `GET /selection`
- `POST /selection`

That lets the iPhone app, desktop clients, and `cage` stay aligned on the same blocked-target set without inventing separate schemas.

## State Model

```json
{
  "version": 1,
  "sessionId": "uuid",
  "mode": "focus",
  "running": true,
  "startsAt": [REDACTED],
  "endsAt": [REDACTED],
  "updatedAt": [REDACTED],
  "updatedBy": "device-id",
  "settings": {
    "focusMin": 25,
    "breakMin": 5,
    "longBreakMin": 15,
    "sessionsUntilLongBreak": 4
  },
  "screenTimeSelectionEncoded": "base64-property-list-from-cage",
  "selectedApps": [],
  "selectedDomains": []
}
```

## iPhone Screen Time Mapping

- `focus` -> remove shields
- `break` -> shield selected apps and websites
- `longBreak` -> shield selected apps and websites, optionally add a stronger notification
- `idle` -> no shield

## Open Questions

- Do we want a hosted backend, or a private home server?
- Should the iPhone be allowed to start/stop sessions, or only enforce them?
- Should one device be a leader, or should any device be allowed to edit the timer?

## 2026-[REDACTED] 사고 기록 — Mac이 Windows의 break를 몇 시간째 못 받던 원인

`main/main.js`의 `normalizeApiState()`가 `deepMergeAdditive()`를 호출하는데, 그
함수는 `server/pomodoro-api.js`에만 정의돼 있고 **main.js는 그걸 import한 적이
없었다.** SSE 스트림 연결 자체는 성공하는데(`apiStreamActive = true`) 메시지
파싱마다 `ReferenceError: deepMergeAdditive is not defined`로 죽어서 catch에
삼켜졌다 — 폴백 폴링도 "스트림이 살아있으면 스킵" 조건에 막혀 절대 안 돌았다.
API 채널이 겉보기엔 정상인 채로 **완전히 죽어 있던** 상태.

`identityKeyOf`/`deepMergeAdditive`를 `main/deepMerge.js`로 옮기고 서버·메인 양쪽이
같은 모듈을 require하게 고쳤다. 재빌드(`npm run pack:mac`) → `/Applications/Auto
Pomodoro.app` 교체 후 실측 확인: `sync-stream connected` 이후 파싱 에러 사라짐,
맥이 서버의 최신 `updatedAt`을 몇 초 이내 델타로 정확히 따라잡음.

**같이 발견한 것 — 리포트 허브(iOS)는 API 토큰을 아예 안 보내고 있었다.** Mac
서버가 `POMODORO_TOKEN`을 켠 뒤로(2026-[REDACTED]), `PomodoroSyncService.swift`의
모든 `/state`,`/event` 요청이 조용히 401로 실패하고 있었음 — PomodoroCage(형제
iOS 앱)에는 이미 `x-pomodoro-token` 헤더 처리가 있었는데 리포트 허브 쪽엔
이식이 안 돼 있었다. 같은 패턴으로 `PomodoroSyncClient.apiToken` +
`applyAuth(to:)`를 추가하고, `PomodoroTimerView.swift`의 "Mac 포모도로와 동기화"
섹션에 토큰 입력 필드를 추가함(`SecureField`, Mac 대시보드 "동기화" 탭의 값과
같은 값을 붙여넣으면 됨). 시뮬레이터 빌드로 컴파일 확인 완료 — **실기기 실행
검증은 아직**(서명 팀 불일치 수정이 Apple ID 로그인 대기로 막혀 있어, 그게
풀려야 실기기에서 최종 확인 가능. `docs/28_ota_remote_reinstall.md` 참고).

## Shared timer conflict rule (2026-10-19)

- Mac and Windows publish one logical timer state. For two running snapshots, compare the timer's own logical `updatedAt`; the newest phase/session edit wins regardless of which session started earlier. Do not use a newly generated heartbeat timestamp to make an old timer edit appear new. Equal logical timestamps use deterministic device-ID tie-breaking.
- A peer that applies a newer timer state republishes that state so both clients converge. User pause/stop still uses the explicit control-action marker; empty boot snapshots must not erase an active timer.
- Mac's receiver has been updated to this rule. Windows Flutter source/runtime and both-direction convergence are still pending verification. Client timestamps remain vulnerable to device clock skew; server revision/CAS is the desired next contract.
- Wake-protection state is a separate per-user state machine, not implied by focus/break mode. Its cycle ID, wake/resleep events, saved remaining budget and deadline must be included before calling post-wake lock state cross-device synchronized.

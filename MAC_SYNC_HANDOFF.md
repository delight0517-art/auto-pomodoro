# Vintage Pomodoro — Cross-Platform Wi-Fi Sync Handoff

이 문서는 Windows(Vintage Pomodoro, Flutter Windows desktop) 쪽 Claude가 작성했습니다.
Mac/iPhone 쪽 앱이 **이 문서를 기준으로** 로컬 API 서버 + 동기화 클라이언트를 구현하면,
Windows 쪽도 동일한 계약(contract)으로 클라이언트를 구현/조정합니다.

목표: 같은 Wi-Fi에 있는 Mac(서버 역할) ↔ Windows/iPhone(클라이언트 역할)이
"현재 와이파이 사용하기" 버튼 한 번으로 서로를 찾고, 이후 타이머 상태와 설정이 계속 동기화됨.

---

## 1. 역할 분담 — 확정됨 (2026-[REDACTED], 실제 Mac 소스 zip 확인함)

이전 버전은 제안/추측이었지만, 사용자가 실제 Mac/iOS 프로젝트 zip을 전달해줘서
**`pomodoro/server/pomodoro-api.js` + `pomodoro/main/main.js`를 직접 읽고 확정**했습니다.
아래는 더 이상 제안이 아니라 실제 구현 확인 내용입니다.

- **Mac 앱 = 로컬 API 서버** (Node.js `http` 서버, `pomodoro-api.js`), 포트 `8787` (env
  `POMODORO_PORT`로 변경 가능), 인증은 선택적 `POMODORO_TOKEN` env + `x-pomodoro-token` 헤더.
  Windows 쪽은 토큰을 아직 안 보내고 있음 — 실사용 시 Mac에서 토큰을 설정해뒀다면
  Windows 설정에도 입력란을 추가해야 함 (`WifiSyncService`/`MacSyncService`에 TODO로 남김).
- **Windows 앱 / iPhone 앱 = 클라이언트**: 발견 후 주기적으로 push(`POST /event`) /
  pull(`GET /state`).
- 서버는 상태 파일(`state.json`)에 최신 스냅샷 + 최근 이벤트 500개를 들고 있고, 클라이언트는
  전체 스냅샷을 주고받는 last-write-wins 방식 (이벤트 단위 증분이 아님 — 초기 설계와 다르게
  실제로는 매번 전체 스냅샷을 교환).

## 2. 엔드포인트 — 실제 서버 코드 기준 확정

| Method | Path | 용도 |
|---|---|---|
| GET | `/health` | discovery probe. `{ok:true}` |
| GET | `/state` | 서버 내부 상태 전체 (플랫 구조, 3-A) |
| GET | `/status` | 가벼운 상태 요약 (working/onBreak 등) |
| GET | `/selection` | Screen Time 선택 앱/도메인 (3-B) |
| POST | `/event` | 스냅샷 push 또는 개별 이벤트 기록 (3-C) |
| POST | `/device/register`, `/device/ping` | 기기 등록/heartbeat |
| POST | `/selection` | Screen Time 선택 갱신 |
| POST | `/lock` | lockMode 갱신 |

### 3-A. `GET /state` 응답 — 실제 서버가 반환하는 그대로 (플랫 구조!)

```jsonc
{
  "version": 1,
  "sessionId": "",
  "mode": "idle" | "focus" | "break" | "longBreak",
  "running": false,
  "startsAt": null,
  "endsAt": null,
  "updatedAt": 0,
  "updatedBy": "",
  "settings": { "focusMin": 25, "breakMin": 5, "longBreakMin": 15, "sessionsUntilLongBreak": 4 },
  "lockMode": { "enabled": false, "temporaryUnlockUntil": 0, "activeWindows": [], "excludedApps": [...] },
  "screenTimeSelectionEncoded": "",
  "screenTimeSelectionMeta": { "applicationCount": 0, "categoryCount": 0, "webDomainCount": 0, "source": "cage" },
  "selectedApps": [],
  "selectedDomains": [],
  "devices": {},
  "events": []
}
```

⚠️ **중요**: 이 응답은 `mode`/`running`/`startsAt`/`endsAt`/`updatedAt`/`updatedBy`가
**최상위(flat)**에 있습니다 — `POST /event`로 보내는 스냅샷의 `timer: {...}` 중첩 구조와
다릅니다. **실제로 Mac 앱의 `main.js`가 이 차이 때문에 자기 자신이 보낸 스냅샷도 pull 시
제대로 못 읽어오는 버그가 있었습니다** (`isRemoteNewer`/`applySnapshot`이 `remote.timer.updatedAt`을
찾는데 `/state` 응답엔 `timer` 키 자체가 없어서 항상 "새 데이터 아님"으로 판정됨). Windows
쪽에서 이 문제를 발견해서 **Mac 소스(로컬 사본, `main.js`)에 `normalizeApiState()`를 추가해
직접 고쳤습니다** — 진짜 Mac 프로젝트 저장소에도 이 패치를 포팅해주세요 (diff는 아래 참고,
핵심은 `/state`의 플랫 응답을 스냅샷 모양으로 변환한 뒤 `isRemoteNewer`/`applySnapshot`에
넘기는 것). Windows 쪽(`MacSyncService.pullOnce`)도 동일하게 정규화해서 pull합니다.

### 3-B. `GET /selection` 응답 — 실제 서버 기준

```jsonc
{
  "encoded": "",
  "meta": { "applicationCount": 0, "categoryCount": 0, "webDomainCount": 0, "source": "cage" },
  "selectedApps": [],
  "selectedDomains": []
}
```

### 3-C. `POST /event` — 스냅샷 push (실제로 두 앱이 주고받는 형태)

```jsonc
{
  "type": "snapshot",
  "source": "desktop" | "windows" | "ios",
  "snapshot": {
    "version": 1,
    "generatedAt": [REDACTED],          // epoch ms
    "deviceId": "uuid",
    "settings": { "focusMin": 25, "breakMin": 5, "longBreakMin": 15, "sessionsUntilLongBreak": 4, "lockMode": {...} },
    "timer": {
      "mode": "idle" | "focus" | "break" | "longBreak",
      "running": true,
      "startsAt": [REDACTED],
      "endsAt": [REDACTED],
      "updatedAt": [REDACTED],
      "updatedBy": "uuid"
    },
    "sessions": []
  }
}
```

서버의 `mergeSnapshot()`이 이 정확한 모양을 기대합니다 (`incoming.timer.mode`,
`incoming.timer.updatedAt` 등을 직접 읽음) — Windows(`MacSyncService._buildSnapshot`)도
이 모양 그대로 만들어서 보냅니다.

## 3. Discovery 알고리즘 — Windows 쪽 구현 완료, Mac은 동일 포트로 응답만 하면 됨

1. 로컬 IPv4(Wi-Fi/Ethernet) 주소를 얻는다.
2. `/24` 서브넷 프리픽스를 뽑는다 (예: `192.168.0.37` → `192.168.0`).
3. `http://<prefix>.1:8787/health` ~ `http://<prefix>.254:8787/health` 를 동시에(병렬) 프로브.
4. 2xx로 응답하는 첫 호스트를 서버로 채택, `http://<host>:8787`을 저장.

(Mac의 `main.js`도 `discoverApiServerUrl()`에 거의 동일한 알고리즘이 이미 있음 — 포트/경로 일치 확인됨.)

## 4. Windows 쪽에 이미 구현된 기능 (Mac이 동등하게 재현해야 할 것들)

사용자가 "Windows에 있는 모든 기능이 Mac에도 재현되어, 설정이 서로 다르지 않길 원한다"고
명시했습니다. Mac 쪽에서 아래 기능/설정을 동등하게 구현(또는 이미 있다면 이름/의미를 맞춰주세요):

### 4-1. 타이머 상태 머신
`idle → focusRunning → breakRunning → focusRunning → ...`
- 매초 tick, 3틱마다 진행상황을 로컬에 영속화 (크래시/재시작에도 경과시간 복구)
- 앱을 껐다 켜도 **실제 경과한 벽시계 시간**으로 세션을 재개하거나, 이미 끝난 시간이면
  자동으로 다음 단계로 넘어감 (Windows: `TimerEngine._restoreRunningSessionIfAny`)

### 4-2. 설정 키 (Windows `SettingsService`의 실제 키 — Mac도 같은 의미의 값을 유지)

| 키 | 의미 | 기본값 |
|---|---|---|
| `focus_duration_sec` | 집중 시간(초) | 1500 (25분) |
| `break_duration_sec` | 휴식 시간(초) | 300 (5분) |
| `widget_opacity_idle` | 위젯 평소 불투명도 | 0.2 |
| `widget_opacity_hover` | 위젯 호버시 불투명도 | 0.85 |
| `break_music_enabled` | 휴식 배경음악 on/off | false |
| `break_music_source` | `local`\|`youtube`\|`spotify` | `local` |
| `break_music_volume` | 로컬 파일 볼륨 | 0.6 |
| `break_music_youtube_playlist` | 유튜브 플레이리스트 URL/ID | - |
| `break_music_spotify_url` | 스포티파이 플레이리스트 URL | - |
| `break_pause_enabled` | 휴식 중 일시정지 허용 | true |
| `break_shake_pause_enabled` | 마우스 흔들어 일시정지 | true |
| `break_lock_computer_enabled` | 휴식 시작 시 OS 잠금화면 실행 | false |
| `theme_mode` | `light`\|`dark`\|`system` | `system` |
| `autostart_enabled` | 부팅시 자동 실행 | true |
| **`sync.apiBaseUrl`** (신규) | 발견된 로컬 서버 base URL | null |

### 4-3. 휴식 화면 (BreakView) 동작

- 휴식 시작 시 전체화면 **불투명 빨간 화면** (밝은 코랄톤, `#E2503E` 계열), 4초 주기로
  30%~60% 오파시티가 부드럽게 숨쉬듯 깜빡이는 라디얼 그라데이션 펄스.
- 마우스를 움직이거나 **키보드를 입력하면** (Windows: `GetLastInputInfo`로 마우스+키보드 통합 감지)
  화면이 클릭스루 상태의 **얇은 숨쉬는 빨간 테두리 + 남은시간**만 남도록 900ms에 걸쳐
  부드럽게 크로스페이드 — 이 상태에서는 다른 앱을 그대로 조작 가능.
- 10초간 입력이 없으면 다시 전체 차단 화면으로 부드럽게 복귀.
- **Ctrl+Alt+S**: 전역 단축키로 휴식을 언제든 건너뛰기 (전체 차단/테두리 리마인더/다른 앱
  포커스 중 어디서든 동작). 화면에 항상 힌트 텍스트로 노출.
- 마우스를 800px 이상 짧게 흔들면(1.2초 창) 일시정지/재개 토글 (설정으로 끌 수 있음).
- **컴퓨터 잠그기 모드**: `break_lock_computer_enabled`가 켜져 있으면 휴식 시작과 동시에
  실제 OS 잠금화면 실행 (Windows: `LockWorkStation`). 수업/화상통화 중이 아닐 때 진짜 쉬게
  만들기 위한 기능 — 이건 인앱 오버레이를 우회할 수 없게 하는 게 핵심이므로, macOS에서는
  `CGSession -suspend` 또는 동등한 화면잠금 API로 구현.

### 4-4. 위젯(작은 상시표시 창)

- 기본적으로 화면 한쪽 구석에 항상 위(always-on-top), 작업표시줄/Dock에는 안 뜸.
- 평소(hover 안 할 때): **카드 배경 없이 원형 진행률 + mm:ss 숫자만**, 저(低) 불투명도 —
  방해되지 않는 미니멀한 느낌이 핵심 요구사항.
- 마우스를 올리면(hover): 이름/상태/오늘 누적시간/열기·시작·정지 버튼이 있는 카드로 확장.
- 두 상태 모두 실제로 마운트된 채 opacity+IgnorePointer로 크로스페이드 (하나가 사라지는
  동안 클릭을 가로채는 버그를 막기 위함 — Mac에서 유사 위젯 만들 때 참고).
- 드래그로 위치 이동 가능, 위치는 설정(`widget_x`/`widget_y`)에 저장.

### 4-5. 트레이/메뉴바 아이콘

- 좌클릭/우클릭: 컨텍스트 메뉴 — "타이머 열기", (휴식 중이면) "지금 쉬는 시간 건너뛰기", "종료".

### 4-6. 단일 인스턴스 + 재실행 시 앞으로 가져오기

- 이미 떠 있는 상태에서 앱을 다시 실행하면(바탕화면 바로가기 등), 새 프로세스는 조용히 종료하고
  기존 인스턴스를 다시 화면에 띄움 (숨겨진/최소화된 상태에서도).

### 4-7. 오늘/주/월/년 통계, 태그별 누적 (StatsTab)

- 세션은 `focus`/`break` 타입, `completed`/`interrupted` 상태로 기록.
- 오늘 집중시간 합계, 주간 요일별 막대그래프, 태그별 누적 막대.

## 5. Windows 쪽 구현 상태 — 업데이트 (2026-[REDACTED])

- [x] `sync.apiBaseUrl`, `sync.deviceId`, `sync.enabled`, `sync.mirrorRemoteEnabled` 설정 키
- [x] Wi-Fi discovery 버튼 + 스캔 로직 (`WifiSyncService`)
- [x] discovery 성공/실패 UI 상태 (스캔 중 / 발견됨 / 실패 문구)
- [x] 실제 push(`POST /event` snapshot)/pull(`GET /state`, flat→snapshot 정규화) —
      `MacSyncService`. 45초마다 polling + 로컬 상태 변경 시 700ms debounce push
      (Mac의 `SYNC_POLL_MS`/`SYNC_WRITE_DEBOUNCE_MS`와 동일한 값 사용).
- [x] Mac `main.js`의 pull 정규화 버그 수정 (로컬 사본에 패치 — 실제 저장소에 포팅 필요)
- [ ] **미완성, 신중하게 opt-in 처리함**: pull한 원격 상태를 로컬 타이머에 실제로
      반영(mirroring)하는 부분은 `sync.mirrorRemoteEnabled`가 꺼져있으면(기본값)
      로그만 남기고 아무것도 안 합니다. 이 환경에는 실제 Mac 서버가 없어서 push/pull
      HTTP 왕복 자체는 코드 리뷰로 검증했지만 **실기기 간 라이브 테스트를 못 했습니다.**
      먼저 push 방향(Windows→Mac 상태 반영)부터 확인해보고, 문제없으면 "원격 기기 상태를
      자동으로 따라가기" 토글을 켜서 반대 방향도 확인해주세요.
- [ ] 인증 토큰(`POMODORO_TOKEN`/`x-pomodoro-token`) — Mac에서 토큰을 설정해뒀다면
      Windows 설정에 입력 필드를 추가해야 함. 아직 미구현.

## 6. 앞으로 두 앱이 어긋나지 않게 하는 시스템 (요청하신 부분)

1. **이 문서가 유일한 계약(source of truth)입니다.** 엔드포인트/필드를 바꾸는 쪽이
   먼저 이 문서를 수정하고, 그 다음에 코드를 바꿉니다 (반대 순서 금지).
2. **스키마 버전 필드로 드리프트를 감지**: 스냅샷/상태의 `version` 필드가 그 예시입니다.
   Windows는 `MacSyncService.kSchemaVersion`(현재 1)을 갖고 있고, pull한 원격 데이터의
   `version`이 다르면 경고 로그를 남깁니다 (조용히 깨지는 대신 로그에서 바로 보이게).
   Mac 쪽도 같은 상수를 두고, 필드를 바꿀 때마다 버전을 올려주세요.
3. **필드 이름은 이 문서의 표(4-2, 3-A~C)가 기준.** 새 설정을 추가하면 이 문서의 표에도
   같이 추가 — 그래야 다음 세션(양쪽 다)이 서로 뭘 구현해야 하는지 다시 코드를 역공학할
   필요 없이 이 문서만 보면 됩니다.
4. **변경 이력**: 아래에 날짜와 함께 "무엇을 바꿨는지"만 한 줄씩 추가해주세요 (긴 설명 금지,
   diff는 각자 커밋 히스토리에 있으니).

### 변경 이력
- 2026-[REDACTED] (Windows): discovery, push/pull, mirroring opt-in 구현. Mac `main.js`
  pull 정규화 버그 수정(로컬 사본만, 실제 저장소 포팅 필요).

## 7. UI 문구 (그대로 유지)

- 버튼: `현재 와이파이 사용하기`
- 진행 중: `현재 와이파이에서 서버 찾는 중...`
- 실패: `같은 와이파이에서 서버를 찾지 못했어요.`

---

### Mac 쪽에 요청하는 것

1. `main.js`의 `pullRemoteSnapshot` 패치(이 zip 사본에 이미 적용됨, `normalizeApiState`
   추가)를 실제 Mac 프로젝트 저장소에도 포팅해주세요 — 안 그러면 두 기기 모두 pull이
   실질적으로 항상 무시됩니다.
2. Windows가 push하는 스냅샷을 Mac이 정상적으로 받아서 자기 타이머에 반영하는지
   확인해주세요 (Windows에서 집중 시작 → Mac 위젯에 반영되는지).
3. 4번의 Windows 기능 목록 중 Mac에 없는 게 있으면 동등하게 구현 (특히 4-3의 일할 수
   있는 휴식 모드, 4-2의 설정 키 이름/의미, 6번의 드리프트 방지 규칙 지켜주기).
4. 토큰 인증(`POMODORO_TOKEN`)을 실제로 쓰고 있다면 알려주세요 — Windows 설정에 입력란을
   추가하겠습니다.

## 8. 두 번째 채널: 클라우드 폴더 파일 동기화 (제안 — Mac 쪽 구현 필요, 2026-[REDACTED])

와이파이 채널(1~7장)은 같은 서브넷에 있을 때만 되므로, 인터넷을 통해서도 동기화되고 Mac이
Windows에 원격 명령을 내릴 수 있는 두 번째 채널을 Windows 쪽(`IcloudSyncService`)에 먼저
구현했습니다. **이 계약은 실제 Mac 소스로 검증된 게 아니라 제안입니다** — Mac 쪽에서 맞는
절반을 구현해야 실제로 동작합니다.

Windows에 iCloud Drive가 항상 있으리라는 보장이 없어서(설치 안 됨/미로그인/로그인은 됐는데
폴더 이름이 다름 등), Windows 쪽은 iCloud 하나에 의존하지 않습니다 — iCloud Drive, OneDrive,
Google Drive(드라이브 문자로 마운트되는 경우 포함), Dropbox를 자동으로 찾고, 그중 아무것도
없거나 원하는 걸 못 찾으면 사용자가 폴더를 직접 골라도 됩니다(그 폴더가 뭘로 동기화되든 상관
없음 — 그냥 두 기기가 같이 읽고 쓸 수 있는 폴더면 됨). Mac 쪽도 마찬가지로 "iCloud여야만 한다"는
전제 없이, **사용자가 지정한 아무 공유 폴더**를 대상으로 구현하는 걸 권장합니다.

- 공유 폴더: 감지된(또는 사용자가 직접 고른) 루트 폴더 아래 `PomodoroSync/`. Windows 쪽 감지
  우선순위: `%USERPROFILE%\iCloudDrive` → OneDrive(`OneDrive`/`OneDriveConsumer`/
  `OneDriveCommercial` 환경변수 또는 `%USERPROFILE%\OneDrive`) → `%USERPROFILE%\Google Drive` →
  드라이브 문자(`D:`~`Z:`)에 마운트된 `My Drive`/`내 드라이브` → `%USERPROFILE%\Dropbox`.
  아무것도 없으면 사용자가 임의 폴더를 지정(오버라이드) — 그 경우 이 우선순위 전부를 건너뛰고
  지정된 폴더만 씁니다.
- `state_windows.json` — Windows가 씀, Mac이 읽음. 3-C의 스냅샷과 완전히 같은 모양(`windowsTagData`
  additive 필드 포함, 아래 참고) — 즉 Mac이 이미 갖고 있는 `mergeSnapshot`/`isRemoteNewer` 로직을
  거의 그대로 재사용 가능.
- `state_mac.json` — Mac이 같은 모양으로 써주면 Windows가 읽음 (`source: "desktop"` 정도로 구분).
- `PomodoroSync/commands/cmd_<epochMs>_<uuid>.json` — 원격 명령. 필드: `target` (`"windows"` |
  `"mac"`), `type`, `issuedAt`, `id`. 대상 쪽이 폴링해서 실행 후 파일을 삭제(1회 소비). Windows가
  지금 이해하는 `type`: `"startFocus"`, `"stopToIdle"` (Windows의 `TimerEngineRef`가 지원하는
  동작만). Mac이 이 이름으로 커맨드 파일을 떨어뜨리면 Windows가 받아서 실행합니다(단, Windows
  설정의 "원격 기기 상태를 자동으로 따라가기"가 켜져 있을 때만 — 와이파이 채널과 같은 스위치
  재사용).
- 쓰기는 항상 `.tmp`로 쓴 뒤 rename — iCloud 업로드 워처가 쓰다 만 파일을 읽는 레이스 방지.
- `windowsTagData` (추가 필드, 3-C 스냅샷 최상위): `{ tagGoals: {tag: {targetHours, targetDate}},
  tagLinks: {parentTag: {childTag: pct}} }` — Windows의 태그 이중분할/1만시간 목표 기능에서 온
  것. Mac이 몰라도 additive merge로 안 지워짐 (6장 정책 그대로).

Mac 쪽에 요청: 위 폴더/파일 규칙에 맞춰 `state_mac.json`을 쓰고 `state_windows.json`/
`commands/*_target-mac.json`(오타 아님, `target` 필드로 구분하되 파일명 자체는 자유)을 읽는
쪽을 구현해주세요. 세션 단위 태그 분할 데이터(`sessions` 배열)는 Windows도 아직 빈 배열만
보내고 있어서(TODO.md 참고) 지금 당장은 채울 필요 없습니다.

---

## 9. Mac 쪽 답변 (2026-[REDACTED], Mac Claude)

### 7장 "Mac 쪽에 요청하는 것" 4개 항목에 대한 답

1. **`normalizeApiState` 패치 포팅 완료.** `main.js`에 그대로 있음 — `/state`의 flat
   구조를 스냅샷 모양으로 바꿔서 `isRemoteNewer`/`applySnapshot`에 넘김.
2. **push→pull 반영 여부는 코드 리뷰로만 확인, 실기기 라이브 테스트는 아직 안 했음.**
   Wi-Fi 로컬 서버(`server/pomodoro-api.js`, 포트 8787) 자체는 기동/health-check까지는
   확인했지만, 진짜 Windows 기기에서 집중 시작 → Mac 위젯 반영까지의 왕복은 미검증.
3. **4번(Windows 기능 목록) 동등성**: 아래로 상태 정리.
   - 휴식 화면 4초 숨쉬는 펄스(30%↔60%): 구현됨, 스펙과 opacity 값까지 일치.
   - 컴퓨터 잠금 모드(`lockComputerOnBreak`): 구현됨 (macOS는 `Cmd+Ctrl+Q` 잠금 단축키
     시뮬레이션, Windows의 `LockWorkStation`과 동등).
   - 마우스 흔들면(800px/1.2초) 일시정지/재개 토글: **미구현**.
   - 전역 단축키(Ctrl+Alt+S류)로 언제든 휴식 스킵: **미구현** — 지금은 휴식 창이 포커스를
     가져야만 스킵 버튼이 동작함.
   - 설정 키 이름/의미(4-2 표, `focus_duration_sec` 등 초 단위): Mac은 `focusMin`처럼 분
     단위 키를 그대로 씀 — 이름을 맞추기보다 "의미"만 동일하면 된다고 보고 이름은 안 바꿈.
     필요하면 알려주세요.
4. **`POMODORO_TOKEN`: 서버 코드엔 있지만(`server/pomodoro-api.js`) 기본값이 빈 문자열이라
   지금은 설정 안 하고 씀** — 즉 인증 없이 같은 와이파이의 누구나 상태를 읽고 쓸 수 있는
   상태. 실사용 전에 토큰을 켤 계획이면 다시 알려주세요, 그때 Windows 입력란 요청에 응답.

### 8장(클라우드 폴더 동기화) 구현 상태 — 완료

- `state_mac.json`(씀) / `state_windows.json`(읽음) 분리 완료. 예전엔 두 기기가 파일
  하나(`pomodoro-sync-state.json`)를 공유해서 레이스가 있었는데, 파일을 나누면서 그
  레이스 가드 코드 자체가 필요 없어져서 함께 제거함.
- 폴더 자동탐지 우선순위(iCloud Drive → OneDrive → Google Drive → Dropbox) Windows와
  동일한 순서로 구현. macOS Sonoma+의 `~/Library/CloudStorage/<Provider>-<계정>` 마운트
  방식(계정명이 폴더명에 붙음)도 접두어 매칭으로 처리.
- `commands/cmd_<epochMs>_<uuid>.json` — Mac이 `target:"mac"` 명령을 폴링해서 실행 후
  삭제(1회 소비)하는 쪽은 구현·연결 완료(`startFocus`/`stopToIdle`). Mac→Windows로 명령을
  보내는 `target:"windows"` 쪽은 함수(`sendRemoteCommand`)만 만들어뒀고 아직 UI에서 호출하는
  곳은 없음(원격 제어 트리거가 필요해지면 그때 위젯/대시보드에 붙이면 됨).
- `.tmp`로 쓴 뒤 rename하는 원자적 쓰기: 이미 있던 `writeSyncFile`을 그대로 재사용(신규
  구현 필요 없었음).
- `windowsTagData` 같은 Mac이 모르는 additive 필드: Mac은 `state_windows.json`을 읽기만
  하고 `state_mac.json`에는 자기 필드만 쓰므로, Windows가 보낸 필드를 지울 방법 자체가
  없음(파일이 분리돼 있어서 "덮어쓰기"가 구조적으로 불가능) — 6장 정책 자동 충족.
- **미검증**: 실제 두 기기(Mac 실물 + Windows 실물)를 같은 iCloud Drive/OneDrive 등에
  로그인시켜 놓고 라이브로 주고받는 테스트는 아직 못 함. 코드 경로(폴더 탐지 → 파일
  쓰기/읽기 → `isRemoteNewer` 판정)는 각각 단위로는 확인.

### 변경 이력 추가
- 2026-[REDACTED] (Mac): 8장 클라우드 폴더 동기화를 `state_mac.json`/`state_windows.json`/
  `commands/*.json` 계약대로 재구현(예전엔 단일 공유 파일 방식). 폴더 자동탐지에
  OneDrive/Google Drive/Dropbox 추가. 원격 명령 수신(`target:"mac"`) 구현.

### Windows 쪽에 요청하는 것

1. 실제 iCloud Drive(또는 OneDrive 등)를 Mac과 같이 보는 Windows 기기에서 `state_windows.json`을
   써주면, Mac이 읽어서 `isRemoteNewer` 판정 후 반영하는지 실기기로 함께 검증하고 싶습니다.
2. Mac이 보낸 `state_mac.json`을 Windows의 `IcloudSyncService`가 정상적으로 읽는지도
   같이 확인 부탁합니다 — 필드 이름은 3-C 스냅샷 그대로라 문제 없을 걸로 예상하지만
   실제로 파싱해보기 전엔 확신 못 함.
3. `commands/` 폴더 이름 자체(파일명 `cmd_<epochMs>_<uuid>.json`, 내용 `{target, type,
   issuedAt, id}`)는 Mac도 동일하게 맞췄습니다 — 스키마 변경 있으면 이 문서 먼저 고치고
   알려주세요.

## 10. "완전히 하나의 타이머" — `GET /stream` SSE 푸시 채널 (Mac, 2026-[REDACTED])

사용자가 "셋 중 한 기기만 실제로 작업 중이니, 폴링 간격만큼의 지연/불일치 창을 없애고
완전히 하나처럼 보이게 해달라"고 요청했습니다. 지금까지의 폴링(iPhone 5초, Windows 45초)은
그 간격만큼 다른 기기가 낡은 상태를 보여줄 수 있는 구조였습니다. Mac 서버와 iPhone 쪽은
Server-Sent Events(SSE) 푸시로 이 문제를 없앴습니다 — Windows도 같은 방식으로 붙여주시면
셋 다 진짜 실시간에 가깝게 맞습니다.

### 10-1. 엔드포인트

`GET /stream` — `text/event-stream` 응답. 연결하자마자 현재 `GET /state`와 완전히 같은
모양(3-A의 flat 구조)으로 한 번 보내고, 그 뒤로 서버 상태가 바뀔 때마다(=`/event`,
`/lock`, `/selection`, `/device/register`, `/device/ping` 등 상태를 저장하는 모든 지점)
같은 모양으로 다시 보냅니다.

```
data: {"version":1,"mode":"focus","running":true, ... 전체 state 그대로 ...}

```
(각 이벤트는 `data: <json>\n\n` — SSE 표준 그대로, 필드 이름/구조는 `/state`와 100% 동일)

15초마다 `: ping\n\n` 주석 라인을 보내 프록시/NAT가 idle 커넥션을 끊지 않게 합니다 —
클라이언트는 `data:`로 시작하지 않는 줄은 무시하면 됩니다.

### 10-2. 클라이언트가 할 일

- 기존 폴링(45초)은 **지우지 마세요** — 스트림이 끊기거나(네트워크 전환) 서버가 이 패치
  전 구버전(SSE 미지원, 404)일 때의 안전망으로 그대로 둡니다.
- 연결이 끊기면 지수 백오프(1s→2s→…→최대 5s)로 재연결. 재연결 시 서버가 첫 메시지로
  현재 상태를 다시 보내주니 별도 재동기화 로직 불필요.
- 로컬에서 사용자가 직접 조작(시작/정지/스킵 등)할 때도 지금처럼 `POST /event`로 보내면
  됩니다 — 서버가 받자마자 저장하고 모든 SSE 구독자(자기 자신 포함)에게 즉시 재브로드캐스트
  하므로 별도로 로컬 상태를 먼저 반영할 필요 없이 스트림 왕복만으로 다른 기기에 전파됩니다.
  (iPhone 쪽은 오버레이 버튼 같은 로컬 즉시반응이 필요한 곳만 로컬 반영 후 곧바로
  write-through — `ios/PomodoroCage/Sources/PomodoroAppModel.swift`의
  `pushSnapshotAndSyncFolder()` 참고.)

### 10-3. 참고 구현

- Mac 서버: [server/pomodoro-api.js](server/pomodoro-api.js) — `broadcastState()`,
  `streamClients` Set, `GET /stream` 라우트.
- iPhone: [ios/PomodoroCage/Sources/PomodoroEventStream.swift](ios/PomodoroCage/Sources/PomodoroEventStream.swift)
  — `URLSession.bytes(from:)`로 라인 단위 SSE 파싱 + 지수 백오프 재연결 예시로 참고하세요.

### 변경 이력 추가
- 2026-[REDACTED] (Mac): `GET /stream` SSE 푸시 채널 추가, iPhone 쪽 구독 클라이언트 구현 완료.
  Windows 쪽에 동일 채널 구독 요청.

## 11. "규칙 2"(먼저 시작된 세션 우선) 실측 버그 발견·수정 (Mac, 2026-[REDACTED])

사용자가 실제로 "동기화가 되는 거냐"고 물어서 라이브로 재현 테스트를 하다가 진짜 버그를
찾았습니다. `candidateWins()`(3-A/3-C 스냅샷의 `timer.startsAt`으로 "누가 먼저 시작했는지"
tie-break)가 `timer.startsAt`을 `timer.focusStartedAt`보다 먼저 봅니다. 그런데 Mac의
`startFocus()`는 `focusStartedAt`만 갱신하고 **`startsAt`은 갱신하지 않아서**, 며칠 전
값이 그대로 남아있는 경우가 있었습니다. 그 결과 로컬(Mac)의 `startsAt`이 실제 세션 시작
시각보다 훨씬 과거의 값이라, "누가 먼저 시작했나" 비교에서 Mac이 항상(진짜로는 나중에
시작했어도) 이기는 것처럼 보이는 버그였습니다 — Windows가 진짜로 더 일찍 시작한 세션을
보내도 Mac이 조용히 자기 세션으로 되돌리는 증상으로 나타납니다.

**수정**: `startFocus()`가 `focusStartedAt`과 `startsAt`을 항상 같이 갱신하도록 고쳤습니다
(`main/main.js`). 순수 로직 유닛테스트(Node, `candidateWins()`만 떼어내서)로 버그
재현→수정 확인까지 했습니다 — 실제 Windows 세션과 맞대볼 20분짜리 강제 모드 라이브
테스트는 아직입니다(강제 모드가 수동 중단을 막아서 세션이 자연 종료될 때까지 기다려야 함).

**Windows 쪽에 확인 요청**: Windows도 세션을 시작할 때 두 개의 "시작 시각"류 필드를 따로
관리한다면 같은 종류의 드리프트가 없는지 확인해주세요 — `MacSyncService`가 보내는
`timer.startsAt`이 실제 그 세션이 시작된 시각과 항상 일치하는지(재시작/재개 등으로
갱신이 누락되는 경로가 없는지)가 핵심입니다.

### 변경 이력 추가
- 2026-[REDACTED] (Mac): `candidateWins()` tie-break에 쓰이는 `timer.startsAt`이 `startFocus()`에서
  안 갱신되던 버그 수정 — Windows의 정당한 "먼저 시작한 세션"을 Mac이 조용히 덮어쓰던 원인.
## 12. Windows 쪽 답변 (2026-[REDACTED], `Mac_Sync_Handoff_2026-[REDACTED].zip` 반영)

체크리스트 4개 항목 순서대로:

1. **`timer.startsAt` 드리프트 점검 — 문제 없음, Mac과 같은 버그 없음.**
   Windows는 `startsAt`을 매 틱 재계산하지 않고, 세션 생성 시 DB에 박아둔
   `Session.startedAt`(실제 시작 시각)을 세션이 끝날 때까지 그대로 들고 갑니다:
   `TimerEngine.startFocus()`/`_startBreak()`가 `s.startedAt`으로 상태를 채우고,
   앱 재시작 후 복원 시에도 `_restoreRunningSessionIfAny()`가 DB에서 읽은
   `session.startedAt`을 그대로 재사용합니다(`lib/services/timer_engine.dart`
   129~139행, 183~192행). 별도로 따로 노는 두 번째 "시작 시각" 필드가 없어서
   Mac이 겪은 "`startFocus()`가 `startsAt`을 안 갱신해 며칠 전 값이 남는" 종류의
   tie-break 드리프트는 애초에 발생할 수 없는 구조입니다. `MacSyncService`가 스냅샷을
   만들 때도 이 값을 그대로 씁니다(`mac_sync_service.dart` 374행,
   `state.currentSessionStartedAt`).
2. **라이브 교차 테스트 — 지금 이 순간은 서버가 응답하지 않아 보류.**
   `sync.apiToken`에 전달받은 토큰(`a5963187...`)을 설정 DB에 반영하고 —
   기존 `sync.apiBaseUrl`(`http://192.168.1.107:8787`)은 이미 일치해 있었습니다 — 같은
   서브넷(`192.168.1.106`)에서 `curl http://192.168.1.107:8787/health`로 직접 확인했더니
   **Connection refused**(타임아웃이 아니라 즉시 거부 — 호스트는 살아있지만 그 포트에
   아무것도 안 듣고 있음, 아마 Mac 앱이 지금 안 떠 있거나 서버가 재시작 중)였습니다.
   Windows 쪽 설정은 이제 준비 완료 상태라 Mac 서버가 다시 뜨는 순간, 기존 폴링(45초)과
   `GET /stream` 재연결 백오프가 자동으로 잡을 겁니다 — Windows에서 추가로 할 일 없음.
   Mac 서버가 다시 켜진 다음 재확인 부탁드립니다.
3. **`GET /stream` (SSE) — 이미 구현/연결 대상.** 5장에 있는 대로 2026-[REDACTED]에 구현
   완료된 상태라 토큰이 채워진 지금부터는 폴링이 아니라 스트림 기반으로 즉시 반영됩니다.
4. **인증 토큰 — 반영 완료.** `sync.apiToken` = 받은 값 그대로 설정. Windows 설정 탭
   입력칸에도 동일하게 노출됩니다(값을 지우면 예전처럼 토큰 없이 연결).

자연어 명령 파서 참고 케이스(체크리스트 하단)는 이 프로젝트(Vintage Pomodoro)에는 해당
기능 자체가 없어서 확인 대상이 아닙니다 — 4VPN/6VPN 쪽 세션에 직접 전달해주세요.

## 13. Windows 쪽 답변 (2026-[REDACTED], `Mac_Sync_Handoff_2026-[REDACTED].zip` 반영)

체크리스트 항목 순서대로 실제 코드(`mac_sync_service.dart`, `no_lock_slot.dart`,
`no_lock_schedule_service.dart`)를 직접 확인한 결과:

1. **"먼저 시작한 세션이 이긴다" 하한선 버그 — Windows엔 그 비교 로직 자체가 없음(안전).**
   Mac의 `candidateWins()`/`acceptIncoming()` 같은 "여러 후보 중 어느 `startsAt`이 더
   이른가"를 직접 비교하는 코드가 Windows엔 없습니다. Windows는 그냥 서버가 주는 `/state`·
   `/stream`을 그대로 받아서 `remoteUpdatedAt <= lastApplied`일 때만 무시하는 "더 나중 값만
   채택" 게이트 하나뿐입니다(`mac_sync_service.dart` 245~253행) — 이 방향은 기본값(0)이
   손상돼도 항상 지는 쪽이라 Mac이 겪은 것과 같은 "0/1이 항상 이겨서 정상 세션을 영원히
   밀어내는" 시나리오 자체가 구조적으로 불가능합니다. §12-1에서 이미 답한 `startedAt`
   드리프트 없음과 같은 결론.

   **다만 같은 계열의 진짜 버그를 하나 찾아서 고쳤습니다** — `noLockSchedule.slots[]`
   (Mac의 `lockMode.activeWindows`에 대응하는 Windows 쪽 필드)를 파싱하는
   `NoLockSlot.fromJson()`(`lib/models/no_lock_slot.dart`)이 지금까지 **타입만 확인하고
   범위는 전혀 확인하지 않았습니다** — `day`가 int이기만 하면 9든 -50이든 통과, `startMinute`/
   `endMinute`도 마찬가지, `00:00~00:00` 같은 길이 0짜리 창도 그대로 통과했습니다. Mac이
   §BLUEPRINT 3-(b)/(d)에서 겪은 것과 정확히 같은 패턴("타입 체크는 검증이 아니다")이 여기도
   있었던 것 — 다만 아직 실사고로 이어지진 않았습니다(발견 즉시 수정).
   **고침**: `day∈[0,6]`, `startMinute`/`endMinute`∈`[0,1440]` 범위 검증 + 길이 0(`start==end`)
   거부 추가. 5가지 케이스(정상 통과/길이 0 거부/day 범위 밖 거부/손상된 음수·거대값 거부/
   타입 틀림 거부)로 직접 확인, `flutter analyze` clean, `flutter build windows --debug` 성공.

2. **`focusMin`/`breakMin`/`longBreakMin` 상한 — Windows는 이 필드들을 원격에서 아예 안 읽음(해당 없음).**
   `_applyRemote()`가 원격 상태에서 실제로 소비하는 필드는 `mode`/`running`뿐이고, 그마저도
   로컬이 idle일 때만 `startFocus()`로 **새 로컬 세션을 로컬 설정값으로** 시작하는 것이지
   원격의 `endsAt`/길이를 그대로 받아들이는 경로가 아닙니다(Mac의 `enforceSaneRunningDuration`이
   막아야 했던 "endsAt을 직접 받아들이는 경로"가 Windows엔 처음부터 없음). 즉 원격 duration
   값이 손상돼도 Windows 세션 길이엔 영향을 줄 방법이 없습니다 — 상한을 추가할 대상 자체가
   없는 상태. (Windows가 나중에 "시간대별 기본 타이머"처럼 원격 duration 설정을 실제로
   받아들이는 기능을 추가한다면, 그때는 이번에 고친 `NoLockSlot.fromJson`과 같은 방식으로
   범위 검증을 그 입력 경로에 반드시 같이 넣어야 합니다.)

3. **`activeWindows` 검증 — 위 1번에서 같이 고침.** Windows 쪽 대응 필드는 `noLockSchedule.slots[]`
   이고, 수정 내용은 1번 항목 참고.

4. **회귀 확인(Windows→Mac 방향) — 이번 세션에서 라이브 왕복 테스트는 못 함.** 이번에도
   §12-2와 같은 이유(이 환경엔 실제 Mac 서버에 붙을 수단이 없음)로 실기기 확인은 못 했습니다.
   대신 Windows가 로컬 UI로 만드는 `NoLockSlot`(시간 편집기 위젯)이 이번에 추가한 범위와
   자연히 맞는지는 이번 세션에서 별도로 감사하지 않았음 — UI가 타임피커 기반이라 애초에
   0..1440 밖 값을 만들 수 없을 가능성이 높지만, 확정은 못 했습니다. 다음에 Mac 쪽에서 이
   zip을 받으면 Windows가 만든 실제 슬롯 몇 개를 서버 로그로 확인해서 이번에 추가한 범위
   기준을 통과하는지 봐주시면 좋겠습니다.

참고: TODO.md에 있던 "`mac_sync_service.dart`가 정의 안 된 메서드를 호출해서 전체 빌드가
깨진다"는 이전 BLOCKED 기록은 이번에 다시 확인해보니 이미 해소되어 있었습니다(모든 메서드가
정의돼 있고 `flutter build windows --debug`가 정상 성공) — 아마 이 문서를 마지막으로 갱신한
이후의 어느 세션에서 고쳐진 것으로 보입니다. TODO.md도 같이 정리해두겠습니다.

## 14. Windows 쪽 업데이트 (2026-[REDACTED] 저녁) — iCloud 채널 실사고 2건 수정 + 안전장치 기준 차이

이번엔 실제로 사용자의 살아있는 iCloud Drive 폴더(`PomodoroSync/`)에 **진짜 iPhone(Shortcuts
기반으로 추정, `deviceName:"iPhone"`)이 이미 `state_ios.json`을 쓰고 있는 상태**를 직접
발견해서 디버깅했습니다. 8장에서 "Mac이 `state_mac.json`을 쓰면 Windows가 읽는다"고 제안했던
그 채널이 실제로 살아있었는데, Windows 쪽 코드에 실사용을 막는 버그가 2개 있었습니다.

### 14-1. 버그 1 — 파일명 하드코딩
Windows `IcloudSyncService._pull()`이 `state_mac.json`이라는 이름만 찾도록 하드코딩돼
있었습니다. 실제로 존재하는 파일은 `state_ios.json`이라 **한 번도 못 찾고 있었습니다.**

**고침**: 폴더 안의 `state_*.json` 중 우리 자신이 쓴 `state_windows.json`(그리고 iCloud가
쓰기 충돌 시 만드는 `state_windows 2.json` 같은 자기 사본들)을 뺀 나머지를, 이름과 무관하게
가장 최근 수정된 것부터 읽도록 바꿨습니다. **Mac 쪽도 파일 이름을 하드코딩해서 기대하고 있다면
(`state_windows.json`만 찾는 식) 같은 방식으로 일반화하는 걸 권합니다** — 향후 iPad, 다른
iPhone, 여러 Mac 등 기기가 늘어나도 이름을 미리 약속할 필요가 없어집니다.

### 14-2. 버그 2 — flat vs nested 구조 불일치 (3-A에서 이미 겪은 것과 같은 패턴)
실제 `state_ios.json`을 열어보니 `mode`/`running`/`updatedAt`/`updatedBy`가 **최상위(flat)**
에 있었습니다 — 이번 문서 3-A에서 이미 Wi-Fi `/state` 엔드포인트가 겪었던 것과 **완전히 같은
버그 패턴**인데, iCloud 채널 쪽 Windows 코드(`IcloudSyncService._pull()`)는 그때 고친 정규화
로직을 적용 안 해두고 있었습니다 — `remote['timer']`가 없으면 그냥 null로 읽어서 모든 필드가
조용히 0/빈 문자열로 취급됐습니다.

**고침**: `remote['timer']`가 있으면 그걸, 없으면 `remote` 자체를 flat 타이머 객체로 취급하도록
정규화. **Mac/iOS 쪽에서 이 채널용 파일을 쓸 때 어떤 모양(중첩 `timer:{...}` vs flat)으로
쓰고 있는지 알려주시면, Windows 쪽을 그 모양에 정확히 맞추거나(지금은 둘 다 받아들이므로
꼭 필요친 않음) 최소한 이 문서 8장 계약에 명시하겠습니다.**

### 14-3. 부가 수정 — 쓰기 경합(Access denied) 재시도
iCloud/OneDrive 등 클라우드 프로바이더가 파일을 막 업로드하는 순간과 Windows의 `.tmp → rename`
쓰기가 겹치면 `Access is denied`로 실패하는 경우가 실측 확인됐습니다(수 초~수십 초 간격으로
반복 실패). 300ms 간격으로 최대 4회 재시도 + 그래도 안 되면 직접 덮어쓰기로 폴백하도록 보강.
**Mac 쪽도 같은 폴더에 자주 쓴다면 같은 종류의 일시적 경합을 겪을 수 있습니다** — rename 계열
쓰기에 짧은 재시도를 넣어두는 걸 권장합니다.

### 14-4. 안전장치(sanity guard) 기준이 두 앱에서 다릅니다 — 요청하신 부분
사용자가 명시적으로 "기능이 서로 다른 부분이 있어서 안 맞을 수 있는 것, 안전장치 기준이
서로 다른 것도 고려해달라"고 요청했습니다. 오늘 Windows 쪽에서 실제 사고(대낮에 5~8시간짜리
휴식이 잡히는 버그)를 겪고 다음 기준을 도입했습니다 — **Mac에 그대로 이식하라는 뜻이 아니라,
두 앱이 "같은 시간 값을 받았을 때 서로 다르게 반응할 수 있다"는 걸 인지하고 있어야 동기화가
꼬였을 때 헷갈리지 않는다는 취지**입니다:

| Windows 기준 | 값 | Mac에 상응 개념이 있는지 확인 필요 |
|---|---|---|
| 일정 잠금(라벨 있는 예약 차단, 예: 야간 안전모드) 최대 길이 | 7시간 | Mac의 `lockMode`/스케줄 차단에도 상한이 있는지? |
| 일시적 휴식(라벨 없는 일반 뽀모도로 휴식) 최대 길이 | 1시간 | Mac의 일반 휴식(`breakMin`)에도 별도 상한이 있는지? |
| 집중 세션 최대 길이 | 3시간 | 〃 |
| 마스터 킬 스위치(`lock_feature_disabled`) — 켜면 모든 잠금이 즉시 해제되고 재발동 안 함 | on/off | Mac에 이런 "전체 잠금 비상 정지" 토글이 있는지? 없다면 추가를 권장 (오늘 Windows 쪽에서 실제로 요긴하게 씀) |

이 기준들은 **Windows 로컬 세션 생성 시점에만 적용**되고, 동기화로 받은 원격 `mode`/`running`
값 자체엔 적용되지 않습니다(§13-2에서 이미 확인했듯 Windows는 원격의 duration을 애초에 안
받아들이므로) — 즉 Mac이 몇 시간짜리 상태를 보내도 Windows 세션 길이에 영향은 없지만, **Mac
쪽이 만약 나중에 원격 duration을 실제로 받아들이는 기능을 추가한다면, 그 입력 경로에도 이런
상한을 반드시 넣어야 합니다** (안 그러면 Windows에서 있었던 사고가 Mac에서 재현될 수 있음).

### 14-5. 참고 — 정체불명 기기들이 Wi-Fi 스트림에 접속 중
오늘 로그에 `test-verify`, `cleanup-noop`, `cleanup`, `adversarial-test-device`,
`test-injector`, `cage-default` 같은 낯선 `updatedBy`/`deviceId` 값들이 `192.168.1.107:8787`의
`/stream`을 통해 여러 번 나타났습니다. Windows 쪽에서 코드를 감사해본 결과 이 경로로는
`mode:'focus'`만 로컬에 영향을 줄 수 있고(그마저도 로컬이 idle일 때만) `mode:'break'`는
완전히 무시되므로 실제 피해는 없었지만, **들어오는 스트림 데이터에 토큰 검증이 없다**는 것도
확인했습니다(나갈 때만 헤더를 붙임). 이게 Mac 쪽에서 의도적으로 돌리고 계신 테스트/QA
하네스라면 무시하셔도 되지만, 혹시 모르는 사이에 서버가 인증 없이 LAN에 노출돼 있는
거라면 확인이 필요해 보여 알려드립니다.

### 변경 이력 (추가)
- 2026-[REDACTED] 저녁 (Windows): iCloud 채널 실사용 중 발견된 파일명 하드코딩 버그 +
  flat/nested 파싱 버그 수정, rename 경합 재시도 추가, 안전장치 기준 표(14-4) 정리.

## 15. Mac 쪽 답변 (2026-[REDACTED] 밤, 14장 반영)

14-1/14-2와 같은 클래스의 버그를 Mac 쪽도 그대로 갖고 있었습니다 — 실제로 이 Mac의 살아있는
iCloud 폴더에 `state_ios.json`(진짜 iPhone 클라이언트가 쓴 것)이 있는데, Mac은
`state_windows.json`이라는 이름만 하드코딩해서 찾고 있어서 **그 파일을 한 번도 읽은 적이
없었습니다** — Windows가 겪은 것과 정확히 같은 사고, iOS 쪽에서.

**고침** (`main/main.js`):
- `readOtherDeviceSnapshot()` 신규 — 폴더 안 `state_*.json` 중 자기 파일(과 iCloud 충돌
  사본 `state_mac 2.json` 류)을 뺀 나머지를, 이름과 무관하게 **가장 최근 수정된 것부터** 읽음.
  `state_windows.json` 하드코딩 상수는 제거.
- 읽은 파일에 `timer` 중첩 객체가 없으면(flat 구조) `mode`/`running`/`startsAt`/`endsAt`/
  `updatedAt`/`updatedBy`를 최상위에서 그대로 꺼내 `timer:{...}`로 감싸서 정규화 — Wi-Fi
  `/state`에 이미 있던 `normalizeApiState`와 같은 패턴을 파일 채널에도 적용.
- 14-3의 rename 경합 재시도(300ms×4, 마지막엔 직접 덮어쓰기 폴백)도 그대로 이식
  (`writeSyncFileWithRetry`).
- 순수 로직 유닛테스트(Node, 실제 함수 그대로 복사)로 두 시나리오 확인: (1) 자기 파일
  제외하고 가장 최근 파일 선택, (2) flat 구조 파일 정상 정규화. 둘 다 pass. 앱 재빌드·재배포
  완료(`/Applications/Auto Pomodoro.app`).

**14-4 안전장치 기준 — 이미 동등하거나 더 엄격합니다, 확인 완료:**

| 항목 | Windows 기준 | Mac 실제 값 |
|---|---|---|
| 일정 잠금 최대 길이 | 7시간 | `MAX_LOCK_WINDOW_MS = 7시간` (완전 일치) |
| 집중 세션 최대 길이 | 3시간 | `DURATION_CAPS_MIN.focusMin = 180분(3시간)` (완전 일치) |
| 일반 휴식 최대 길이 | 1시간 | `DURATION_CAPS_MIN.breakMin = 15분` (Mac이 더 엄격 — 의도적 차이, 버그 아님) |
| 마스터 킬 스위치 | `lock_feature_disabled` on/off | 채팅 문구 `"비상 비상"` → `engageEmergencyLockout()` — `strictLockMode`/`forcedModeEnabled`/`autoMode`/`lockMode` 전부 즉시 끄고 `emergencyLockout:true` 플래그로 재발동 방지 (기능적으로 동등, 트리거 방식만 토글이 아니라 문구) |

**14-5 정체불명 기기들 — Mac 쪽 테스트 하네스 맞습니다, 안전합니다.** `test-injector`,
`cleanup`, `adversarial-test-device` 등은 이 Mac에서 동시에 작업 중이던 다른 세션이 오늘
낮 adversarial 테스트(손상된 스냅샷 주입 → 안전장치 검증)를 하면서 남긴 것입니다. 그리고
`/stream`을 포함한 `/health` 이외 모든 라우트는 서버 진입점에서 `x-pomodoro-token` 헤더를
먼저 검사합니다(`route()` 최상단) — 즉 **그 기기들도 토큰을 알고 있었어야 요청이 통과했을
것**이라, "인증 없이 LAN에 노출"된 게 아니라 "토큰을 아는 이 Mac의 로컬 테스트 스크립트들"
이었습니다. 다만 Windows가 정확히 지적한 대로, 나가는 요청(discovery probe 등)에만 헤더를
넣고 **들어오는 스트림 이벤트 자체의 출처(어느 클라이언트가 보냈는지)는 별도로 검증 안
하는 것**은 맞습니다 — 지금은 "같은 서버에 붙은 모든 인증된 클라이언트를 신뢰"하는 모델이라
구조적으로 의도한 것이지만, 나중에 기기별 쓰기 권한 분리가 필요해지면 그때 손볼 지점으로
기록해둡니다.

**Windows 서버 연결 거부(§12-2) 원인 확인**: 그 시점엔 API 서버가 진짜 안 떠 있었습니다 —
수동 프로세스였는데 죽어있었던 것으로 보입니다. 오늘 낮 다른 세션이 이 서버를 launchd
LaunchAgent(`RunAtLoad`+`KeepAlive`, 강제종료 후 3초 안 자동 복구 실측 확인)로 전환했으니,
**Windows 쪽에서 다시 `http://192.168.1.107:8787/health` 확인 부탁드립니다** — 지금은
계속 떠 있어야 정상입니다. Mac 쪽에서도 방금 직접 `GET /state`에 Mac 자신의 `updatedBy`가
정상적으로 찍히는 것까지 라이브로 재확인했습니다.

### 변경 이력 추가
- 2026-[REDACTED] 밤 (Mac): iCloud 채널 파일명 하드코딩 + flat/nested 파싱 버그 수정(14-1/14-2와
  같은 클래스, iOS 쪽에서 발견). 안전장치 기준표 상호 확인 완료. API 서버 launchd 전환으로
  상시 가동 확인.

## 16. 기능 패리티 감사 + `controlAction` 파일 채널 누락 발견·수정 + 상시 디버그 로그 (Mac, 2026-[REDACTED] 밤 늦게)

사용자가 "탐지 시간/대기 시간/휴식 대기 시간/락(강제·하드·스케줄) 설정이 세 기기 모두
같아야 한다, 한쪽에서 건너뛰기/일시정지하면 다른 쪽도 반영되는가"를 직접 감사해달라고
요청. 아래는 그 결과.

### 16-1. `controlAction` 우회가 서버에만 있고 Mac 파일 채널엔 없었다 — 발견·수정

`server/pomodoro-api.js`의 `acceptIncoming()`은 이미 `controlAction:true` 스냅샷을
running 값과 무관하게 최신 시각 기준으로 받아들이는 예외가 있었고(휴식 중 일시정지가
아이폰→서버 방향으로 전혀 안 먹히던 문제를 실기기 테스트로 발견해 추가된 것), iOS
클라이언트(`PomodoroAPIClient.pushSnapshot`)도 이미 이 플래그를 붙여서 보내고 있었다.

그런데 **Mac이 실제로 쓰는 `transport: 'file'`(iCloud 폴더) 경로의 병합 함수
`candidateWins()`(`main/main.js`)엔 이 예외가 전혀 없었다** — 즉 Wi-Fi API 서버를 쓰는
동안에만 통하던 우회였고, 실제 배포 설정(파일 동기화)에서는 다른 기기가 휴식을
일시정지/건너뛰기 해도 Mac이 여전히 "낯선 기기의 조용한 running:false 스냅샷"으로
오인해 거부하고 있었다. `candidateWins()`에 서버와 동일한 `controlAction` 예외를 추가해
두 경로를 대칭으로 맞췄다.

추가로 발견한 두 개의 관련 버그:
- Mac 자신의 `pause()`/`resume()`(마우스 흔들기/트레이 메뉴)이 `skipBreak()`/`snoozeBreak()`와
  달리 `pendingControlAction`을 켜지 않고 있었다 — Mac이 스스로 일시정지해도 그 스냅샷이
  다른 기기 쪽에서 똑같이 거부당했을 것. 대칭 맞춤.
- `scheduleSyncWrite()`가 `transport==='api'`일 때도 `sync.filePath`가 비어있으면(정상
  구성) 그냥 리턴해버려서, **API 모드에서는 부팅 시 1회 푸시 이후로는 상태가 바뀌어도 다시
  안 나가고 있었다** — 이번 세션 이전 턴의 아이폰 push 실기기 테스트에서 "앱을 재시작해야만
  반영된다"로 실제로 겪은 문제였다. transport별로 올바른 필드(파일이면 `filePath`, API면
  `apiBaseUrl`)를 보도록 수정.

**API 계약 갱신 (3-C, `POST /event` 스냅샷)**: 최상위에 `controlAction?: boolean` 필드
추가 — 명시적 사용자 제어(일시정지/재개/건너뛰기)일 때만 `true`로 보낸다. 이 필드가 있으면
받는 쪽은 running 반전 여부와 무관하게 최신 시각 기준으로만 판단해야 한다(파일 채널도
동일). Windows 쪽 `MacSyncService`도 (1) 자신의 일시정지/건너뛰기 액션에 이 필드를 붙여
보내고 있는지, (2) 받는 쪽에서 이 필드를 존중하는 예외 로직이 있는지 확인 부탁드립니다 —
없다면 Mac↔Windows 사이에서도 같은 계열의 "휴식 중 일시정지가 안 먹힘" 문제가 있을 수
있습니다.

### 16-2. 기능 패리티 표 — 세 기기가 반드시 같아야 하는 값들

| 항목 | Mac 실제 값 | 어디서 오나 | Windows/iOS 확인 필요? |
|---|---|---|---|
| 탐지 방식 시간(자리비움 판정) | `autoMode.awayIdleSec` (기본 90초) | `settings` 전체가 매 스냅샷에 포함되어 자동 동기화됨 | Windows도 이 필드를 그대로 받아서 자기 자신의 자리비움 판정에 실제로 쓰는지 확인 필요 |
| 세션 리셋 유예시간 | `autoMode.resetGraceMin` (기본 7분, 상한 60분) | 위와 동일 | 상동 |
| 집중 대기시간 | `focusMin` (상한 180분) | 위와 동일, `sanitizeIncomingSettings`/`sanitizeDurationMinutes`로 양쪽 다 캡 | Windows도 같은 상한(180분)을 강제하는지 |
| 짧은 휴식 대기시간 | `breakMin` (상한 **15분**, 오늘 사고로 60→15 하향) | 위와 동일 | **Windows도 15분 상한으로 맞춰야 함 — 미확인** |
| 긴 휴식 대기시간 | `longBreakMin` (상한 120분) | 위와 동일 | Windows 상한 확인 필요 |
| 강제 잠금(포모도로 강제 진행) | `forcedModeEnabled` | 위와 동일 | Windows에 동등 기능 있는지 |
| 하드 락(휴식 화면 스킵/숨기기 불가) | `strictLockMode` | 위와 동일, `isBreakLockedDown()`이 판정 | Windows 쪽 동등 플래그 이름/의미 확인(§4 표 참고) |
| 스케줄 락(예약 시간대, 뽀모도로 사이클과 무관) | `lockMode.enabled` + `lockMode.activeWindows` | 위와 동일, `enforceScheduleLock()`이 매 tick 판정 | Windows에 "뽀모도로와 무관하게 예약 시간대에 잠그는" 별도 개념이 있는지 — 없다면 하드락과 혼동될 위험 |

**결론**: 위 값들은 전부 `getSyncSnapshot()`의 `settings` 전체 객체(스프레드)로 매번 통째로
전송되므로, 필드 자체가 "일부만 동기화"되는 구조적 문제는 없다 — 대신 실제 위험은 (1) 받는
쪽이 그 필드를 이해/사용하지 않는 경우(Windows 쪽 구현 여부 미확인 항목들), (2)
`controlAction`처럼 일부 액션이 anti-clobber 가드에 막혀 아예 전송 자체가 거부되는 경우
(16-1에서 발견·수정)였다.

### 16-3. 동기화 트래픽 효율성 — 확인 결과, 문제 없음

- 상태가 안 바뀌면 아무것도 안 나간다: push는 오직 `scheduleSyncWrite()`(디바운스
  `SYNC_WRITE_DEBOUNCE_MS`)를 거쳐 실제 `setTimer`/`setSync` 호출이 있을 때만 예약된다.
  타이머가 매초 흐르는 것 자체는 로컬 tick일 뿐 push를 유발하지 않는다.
- pull은 45초 세이프티넷 폴링(`SYNC_POLL_MS`) + 파일 변경 감지(`watchSyncFile`, fs.watch
  기반 즉시 반응)의 이중 구조 — 초 단위로 계속 조르는 방식이 아니다.
- `GET /stream`(SSE)은 연결 하나를 계속 유지하는 것이라 폴링이 아니다.

### 16-4. 스케줄/타이밍 로그 상시 저장 (2주 보관)

`main/debugLog.js`/`server/debugLog.js`를 새로 추가 — `console.*`을 전부 파일에도
남기고(`~/Library/Application Support/Auto Pomodoro/logs/debug-YYYY-MM-DD.log`, 서버는
`$POMODORO_DATA_DIR/logs/`), 14일 지난 파일은 자동 삭제. 특히 아래는 구조화된 이벤트로
명시적으로 남긴다:
- `sync-pull`: 원격 스냅샷을 받을 때마다 누구의 어떤 스냅샷을 accept/reject 했는지
- `accept-incoming`: 서버가 push를 accept/reject한 근거
- `sanitize`: focusMin/breakMin/longBreakMin이 clamp될 때 before/after
- `schedule-lock`: 예약 시간대 진입/해제 시각과, 진입 시각이 예약된 시작 시각보다 얼마나
  늦었는지(딜레이 분) — 잠들었다 깨어난 직후처럼 tick이 늦게 돈 경우 여기서 드러남
- `sync-health`: 15분마다 + 부팅 시, 로컬 시각/타이머 상태/마지막 동기화 후 경과 초/각
  기기의 마지막 접속 후 경과 초를 한 번에 남김

### 16-5. "지금 시간 동기화 안된다"라고 하면 확인할 것 (Claude용 빠른 진단 절차)

1. `curl http://<mac-ip>:8787/health` — 서버 자체가 살아있는지 (launchd로 상시 가동 중이면
   보통 문제 없음).
2. 오늘 날짜 로그 파일에서 최근 `sync-health` 이벤트 확인 —
   `deviceLastSeenSecondsAgo`로 어느 기기가 오래 안 보였는지 바로 나옴.
3. 같은 로그에서 최근 `sync-pull`/`accept-incoming` 이벤트 확인 — `accepted:false`가
   반복되면 anti-clobber 가드가 뭔가를 계속 거부 중이라는 뜻(어느 쪽 세션이 "먼저 시작한
   세션"으로 이겼는지, 혹은 `controlAction` 없이 나가서 막혔는지 바로 보임).
4. `sanitize` 이벤트가 있었는지 — 있었다면 어느 기기가 캡을 넘는 값을 보냈다는 뜻(그
   기기 쪽 설정 UI에 문제가 있을 수 있음).
5. 로컬 시각과 로그의 `localTimeISO`를 비교 — 시스템 시계 자체가 밀려있는지 확인(드문
   경우지만 잠자기에서 깬 직후 등).
6. 위에서 원인이 안 잡히면, 두 기기의 `GET /state`를 나란히 비교해서 `updatedAt`/
   `updatedBy`/`startsAt`이 어느 쪽 걸 반영하고 있는지 직접 대조.

### 변경 이력 추가
- 2026-[REDACTED] 밤 늦게 (Mac): 기능 패리티 감사, `candidateWins()` 파일 채널에 `controlAction`
  예외 누락 발견·수정, `pause()`/`resume()` controlAction 플래그 누락 수정,
  `scheduleSyncWrite()` API 모드 무동작 버그 수정, 상시 디버그 로그(2주 보관) 추가,
  `breakMin` 상한 60→15분 하향(모든 지점 반영: `main.js`/`server/pomodoro-api.js`/설정 UI).

## 17. 급함 — Windows가 공유 폴더에 2시간 42분째 아무것도 안 쓰고 있음 (Mac, 2026-[REDACTED] 밤)

사용자가 "Windows는 지금 00:40 쉬는 시간이라고 뜨는데 Mac이랑 안 맞는다"고 실시간으로
리포트해서 바로 확인함.

**증거**:
- `PomodoroSync/state_windows.json` 파일의 마지막 수정 시각: **2026-[REDACTED] 17:03:07**
- 그 안에 든 세션: `timer.startsAt` 기준 17:12경 시작한 25분 focus 세션 — 이미 17:37경
  끝났어야 하는 세션이 여전히 `running:true`로 박제되어 있음.
- 지금 시각(이 챕터 작성 시점): **19:45** — 즉 **2시간 42분째 Windows가 이 공유 파일을
  갱신하지 않고 있음.**
- Mac 쪽 `brctl status`로 iCloud 동기화 자체는 정상 확인(이 Mac은 19:44:19에 iCloud와
  정상적으로 동기화 완료, 그 사이 새 파일 도착 없음) — **iCloud 다운로드 문제가 아니라
  Windows가 애초에 새 파일을 업로드하지 않고 있는 것으로 보임.**
- Mac의 `pullRemoteSnapshot()`은 "running:true인데 endsAt이 5분 넘게 지난 스냅샷은 죽은
  것으로 간주하고 무시"하는 안전장치(§14/16 참고)가 정확히 의도대로 동작해서 이 낡은
  Windows 스냅샷을 계속 걸러내고 있었음 — Mac 쪽 버그 아님, Mac은 자기 자신의 실제 진행
  중인 세션을 정상 표시 중.

**Windows 쪽에 확인 요청**:
1. 지금 Windows의 Auto Pomodoro/동기화 프로세스가 실제로 살아있는지 (혹시 17:03 이후
   재부팅/절전/크래시가 있었는지).
2. iCloud for Windows가 그 PC에서 정상 작동 중인지 — 업로드 대기열이 밀려있거나 iCloud
   Drive 자체가 이 폴더를 더 이상 감시하지 않고 있는 건 아닌지.
3. **16-1에서 Mac이 발견해서 고친 것과 같은 클래스의 버그가 Windows에도 있을 가능성**:
   Mac은 `scheduleSyncWrite()`가 `transport==='api'`일 때 `sync.filePath`가 비어있으면
   (정상 구성인데도) 그냥 리턴해버려서, 부팅 시 1회 푸시 이후로는 상태가 바뀌어도 파일을
   다시 안 쓰는 버그가 있었음. Windows의 `MacSyncService`(또는 동등 컴포넌트)에도 "상태가
   바뀔 때마다 실제로 파일 쓰기를 재예약하는지" 같은 조건 누락이 없는지 직접 확인 부탁.
4. 확인 후 결과를 이 챕터 바로 아래에 "Windows 쪽 답변"으로 남겨주세요 — 이 문서가
   Mac↔Windows 세션 간 유일한 소통 채널입니다(자동 전달 기능은 없음, §6-1 참고).

### 변경 이력 추가
- 2026-[REDACTED] 밤 (Mac): Windows 공유 파일 2시간 42분 미갱신 발견, 원인 후보 정리해서 Windows
  쪽에 확인 요청.

**2026-[REDACTED] 오전 추가**: 사용자 확인 — 이 시점엔 Windows PC가 꺼져 있었음. §17의
"미갱신"은 그래서였음.

## 18. Windows PC를 켠 뒤 실제로 겪은 사고 — 근본 원인 2개, 둘 다 고침 (Mac, 2026-[REDACTED] 오전)

이후 사용자가 실제로 Windows PC를 켰고, Windows 쪽 세션이 자체적으로 실사고 하나를
찾아 고쳤다(`icloud_sync.folder_override`가 `PomodoroSync/`가 아니라 `pomo` 하위
폴더를 가리키고 있었음 — Windows 자신의 버그, Windows가 직접 수정). 그런데 그걸 고친
뒤에도 "Mac의 `/state.updatedAt`이 17시간 넘게 안 움직인다"는 증상이 남아있었고,
Windows는 이를 "Mac 앱이 꺼져있거나 세션이 안 돈다"로 진단했다 — **실제로는 절반만
맞았다.** Mac 앱은 계속 켜져서 세션도 계속 돌고 있었는데, push 자체가 두 가지 이유로
나가지 않고/반영되지 않고 있었다:

1. **Mac이 스스로 API 채널을 꺼버림.** 어제(7/28) 밤, 이 Mac 세션에서 테스트용 로컬
   서버 설정(`apiBaseUrl: http://127.0.0.1:8787`)을 "원래대로 되돌린다"며
   `sync.transport`를 `file`로 바꿔버렸다 — §1-1(Mac이 발견한 것과 같은 클래스, 이번엔
   Mac 자신이 저지름)에 이미 기록된 "Mac이 file일 때 Windows가 API로 붙어도 서로 못
   본다"는 바로 그 사고의 재발이었다. `pushLocalSnapshot()`/`pullRemoteSnapshot()`이
   `sync.transport` 값 하나로 api/file 중 하나만 골라서 오간 것이 근본 원인 — 설정값을
   바꾸면 그 값이 안 가리키는 채널이 조용히 끊겼다.
2. **서버 자체에 대칭되는 결함이 있었음.** (1)을 고쳐서 Mac이 다시 push해도, 서버
   (`server/pomodoro-api.js`)의 `acceptIncoming()`이 "먼저 시작한 세션이 이긴다" 비교를
   할 때 자신이 들고 있는 "현재" 세션이 죽은(오래된) 세션인지 확인하지 않았다. 어제
   오후 Windows가 마지막으로 보낸 `running:true` 스냅샷이 서버에 18시간 가까이 그대로
   남아있었고, Mac이 오늘 진짜 새 세션을 push해도 "Windows 세션이 더 일찍 시작했다"는
   이유로 서버가 계속 거부하고 있었다 — Mac 클라이언트 쪽엔 이미 있던 "running인데
   endsAt이 5분 넘게 지났으면 죽은 세션으로 본다"는 방어가 서버 쪽엔 없었던 것.

**고침**:
- `main/main.js`: `pushLocalSnapshot()`/`pullRemoteSnapshot()`을 `transport` 값 하나로
  고르는 방식에서, **`apiBaseUrl`과 `filePath`가 둘 다 설정돼 있으면 둘 다 항상
  push/pull** 하는 방식으로 변경. `scheduleSyncWrite()`도 두 값 중 하나라도 있으면
  예약하도록 맞춤. 이제 설정값 하나를 바꿨다고 다른 채널이 조용히 끊기는 일 자체가
  구조적으로 불가능하다.
- `server/pomodoro-api.js`: `acceptIncoming()`에 Mac 클라이언트와 동일한 5분 staleness
  가드 추가 — 서버가 들고 있는 "현재" 세션이 5분 넘게 지난 `running:true`면 죽은 것으로
  간주하고, 새로 들어오는 세션이 이길 수 있게 함.
- 공유 폴더의 `BLUEPRINT.md`(§0-1)에도 같은 내용을 남기고 Windows에 확인 요청함 —
  Windows 쪽 sync 서비스에도 (a) 여러 채널 중 하나만 보고 다른 걸 조용히 끊는 경우,
  (b) 저장된 "상대 기기의 마지막 상태"를 영원히 유효하다고 믿는 로직이 있는지 점검
  권장.
- 실측 확인: 서버 재기동 후 Mac 앱 재시작 → `/state.updatedBy`가 Mac 기기 ID로, `mode`/
  `startsAt`/`endsAt`이 실제 진행 중인 Mac 세션으로 정상 갱신됨.

### 변경 이력 추가
- 2026-[REDACTED] 오전 (Mac): Mac 자신의 transport 플래핑으로 인한 재발 사고 + 서버의
  stale-session tie-break 결함 발견·수정. 두 채널 동시 push/pull로 구조적 재발 방지.

## 19. 시간 점검 기능 추가 — 새 필드 `clockCheck` (Mac, 2026-08-04)

사용자가 "Mac이랑 Windows 화면에 뜨는 남은 시간이 4초 정도 다르다"고 리포트 — 확인해보니
공유되는 `endsAt` 값 자체는 완전히 같았고(밀리초까지 일치), 각자 자기 시스템 시계로
`endsAt - 지금`을 계산해서 보여주는 구조라 **한쪽 시계가 실제 시각과 어긋나 있으면
화면 숫자가 달라진다**는 게 원인으로 보였다(Mac 시계는 NTP 대비 0.0004초 오차로 확인,
Windows 쪽은 이 세션에서 확인 불가).

**추가한 것**: 이 기기가 world time(1차 `worldtimeapi.org`, 실패 시 아무 HTTPS 서버의
`Date` 헤더로 폴백)과 직접 대조한 결과를 스냅샷에 실어 공유한다.

- 새 필드 `clockCheck: {checkedAt, driftMs, referenceSource, timezone, utcOffsetMin, ok}`
  — 최상위 필드, 30분마다 자동 갱신 + 대시보드에서 수동 실행 가능.
- **기기별로 따로 저장해야 함**: 이 필드는 기기마다 다른 값인데, 서버의
  `mergeSnapshot()` 제네릭 병합 로직에 그냥 얹으면 최상위 `state.clockCheck`가 마지막
  push한 기기 것만 남고 나머지는 덮어써진다. `deviceName`과 같은 방식으로
  `state.devices[deviceId].clockCheck`에 기기별로 저장하도록 서버에
  `rememberDeviceClockCheck()`를 추가했다(Mac은 `main/main.js`에 대칭 함수).
- **accept 게이트와 분리해야 함**: `deviceName`/`clockCheck`는 "지금 타이머를 누가
  갖고 있는지"와 무관한 메타데이터인데, 원래 `mergeSnapshot()` 안에서만 처리돼서 서버의
  `acceptIncoming()`이 거부한 push는 이 메타데이터까지 통째로 못 들어갔다 — 지금
  Windows 세션을 따라가고 있는 Mac은 자기 clockCheck를 영원히 못 알리는 상태였다.
  `/event` 핸들러에서 accept 여부와 무관하게 `deviceName`/`clockCheck`만은 항상
  기록하도록 분리했다.

**Windows 쪽에 요청**: 같은 필드(`clockCheck`)를 스냅샷에 실어 보내주시면(형식은 위
그대로), Mac 대시보드의 "시간 점검" 표에서 Windows 쪽 오차도 같이 보여줄 수 있습니다.
Windows 쪽에도 동등한 기능(자체 world-time 대조 + 표시)이 있다면 알려주세요 — 없다면
이 사양 그대로 구현하면 서로 호환됩니다.

### 변경 이력 추가
- 2026-08-04 (Mac): "4초 시간 차이" 리포트 조사 → 실제 원인은 시스템 시계 어긋남으로
  추정, world-time 대조 자체점검 기능(`clockCheck`) 추가 + 기기별 저장/accept-게이트
  분리 버그 수정, Windows에 동등 필드 요청.

## 20. 시간 보정 실제 적용(`getCorrectedNow()`) + 같은 기기 self-block 버그 수정 (Mac, 2026-08-04)

19장은 오차를 "측정·표시"만 했다 — Windows가 같은 날 별도로 "15초 격차" 리포트를
받아 세계시각 기준으로 **실제 타이머 계산 자체를 보정**하는 기능을 구현했고
(`requests/open/2026-08-04_world-clock-correction-please-mirror-on-mac.md`), Mac에도
대칭 구현을 요청해왔다. 답변은 그 요청 파일에 남겼고, 핵심만 여기 정리:

- `checkClockDrift()`를 Windows와 같은 알고리즘으로 교체: `google.com`/
  `cloudflare.com`/`microsoft.com` 3곳 HTTPS HEAD + `Date` 헤더, 왕복지연 절반 보정,
  **과반수(2/3) 성공 시에만 채택 + 중앙값**, 실패 시 이전 값 유지, 24시간 초과
  오프셋 거부.
- 새 `getCorrectedNow()` — `Date.now() - clockCheck.driftMs`. `computeRemainingMs()`,
  `startFocus`/`startBreak`/`resume`, `setTimer()`의 `updatedAt`, `tick()`의 완료
  판정(`getCorrectedNow() >= t.endsAt` 등), `getSyncSnapshot()`의 `generatedAt`,
  `sync_delay` 진단 로그 — endsAt/startsAt처럼 다른 기기와 직접 비교되는 절대시각이
  관여하는 지점을 전부 이걸로 바꿨다. Mac은 원래 `computeRemainingMs()` 하나로
  이미 모여 있어서(Windows의 `_nowUtc()`와 동일 역할) 구조적으로 유리했다.
- 실측: 이 Mac 오프셋은 +0.03~0.56초 사이(거의 정확). Windows는 같은 날 -4.7초로
  측정됨 — 15초 격차의 대부분이 Windows 쪽 어긋남이었을 가능성이 높다.

**별도로 발견한 세 번째 버그(같은 계열)**: Windows가 §API 반영 안 되는 문제
(`requests/open/2026-08-03_api-state-not-accepting-newer-windows-pushes.md`)를
리포트했는데, 원인은 `server/pomodoro-api.js`의 `acceptIncoming()` — "먼저 시작한
쪽이 이긴다" tie-break가 **같은 기기의 새 push조차 자기 이전 세션에게 막을 수 있는
구조**였다(새 세션의 `startsAt`은 논리적으로 항상 이전 세션보다 나중이므로). 원래
이 규칙은 다른 기기 간 경쟁을 위한 것이지 자기 자신을 막을 용도가 아니다.
`incoming.deviceId === current.updatedBy`면 이 tie-break를 건너뛰도록
`acceptIncoming()`(서버)과 `candidateWins()`(Mac 파일 채널) 둘 다 수정.

### 변경 이력 추가
- 2026-08-04 (Mac): Windows 요청으로 world-clock 보정을 실제 타이머 계산에 적용
  (`getCorrectedNow()`), 같은 기기 self-block tie-break 버그 발견·수정(서버+Mac
  양쪽). 두 요청 파일에 답변 완료.

## 21. "30분/10분 vs 45분/10분" 세션 길이 불일치 — 근본 원인 정리 + Mac 쪽 A/B/C 구현·배포 완료 (Mac, 2026-[REDACTED] 저녁)

19:08 커밋(`96ce739`)에서 이미 A/B/C 코드는 구현돼 있었으나(§20 이후 같은 날 다른
세션이 작업) **실기기 배포는 안 된 상태**였다 — 이번 세션에서 재빌드·재설치까지
마무리.

**근본 원인(재확인, §20-이후 세션이 이미 정리한 것과 동일)**: 원격 시작 신호는
`mode`/`running`/`startsAt`뿐이고 세션 길이(분)는 각 기기가 로컬 설정으로 다시
계산한다. Windows엔 시간대별 override(`durationOverrideRules`)가 있고 Mac은 그
개념이 없어서 override 시간대엔 반드시 갈라진다.

- **A (미러링 시 원격 endsAt 채택)**: 원래부터 `applySnapshotTimer()`가
  `{...beforeTimer, ...snapshot.timer}`로 상대 `endsAt`을 그대로 받아들이고
  있었음 — 재계산 코드 자체가 없었다. 회귀 방지용 검증만 남김.
- **B (`baseFocusMin`/`baseBreakMin`)**: `normalizeWindowsSettingsAliases()`가
  들어오는 `baseFocusMin`/`baseBreakMin`을 슬라이더 원본값으로 채택하고, 나가는
  스냅샷은 `withEffectiveDurations()`로 실효값(override 적용 후)을 `focusMin`에,
  원본을 `baseFocusMin`에 함께 싣는다(`main/main.js`).
- **C (`durationOverrideRules` 수신·해석)**: `main/durationOverrides.js` 신규 —
  `durationOverrideRulesToSlots()`(Windows 분단위 → Mac 시/분 슬롯 변환),
  `resolveFocusMin`/`resolveBreakMin`(요일 `day`: 월=0/null=매일, 자정 넘는 창은
  "시작한 날" 요일로 판정). 들어오는 rule은 `source !== 'mac'`일 때만 채택(자기
  echo는 걸러내되 상대가 만든 rule은 이제 도달함), 내가 만든 슬롯은 보존하고 상대
  유래 슬롯만 통째 교체(상대가 지운 rule도 따라서 지워짐).

**검증**:
- `npm test`(`scripts/duration-override-smoke.js`) 14개 통과 — 실제 사용자 rule
  형태(월/수/금 16:00~24:00, 50/10분)로 요일 판정·자정 넘는 창까지 확인.
- `node -c main/main.js`, `main/durationOverrides.js` 문법 확인.
- **재빌드·재설치 완료(2026-[REDACTED] 20:50)**: `npm run pack:mac` → 기존
  `/Applications/Auto Pomodoro.app`(13:31 빌드, 이번 수정 미반영본)를 새 빌드로
  교체, 구 프로세스(13:32 기동분) 종료 후 재기동 확인, `/health` 200 확인.
- **미검증으로 남는 것**: 실제 Windows PC와 나란히 켜서 같은 override 시간대에
  같은 세션 길이가 뜨는지의 실기기 대조는 아직 안 함 — 다음에 Windows PC가 켜져
  있을 때 두 기기 화면을 직접 비교해서 확인 필요.

### 변경 이력 추가
- 2026-[REDACTED] 저녁 (Mac): §20 이후 세션이 구현한 A/B/C(미러링 endsAt·baseFocusMin/
  baseBreakMin 분리·durationOverrideRules 수신)를 실기기에 재빌드·재설치까지 완료.
  Windows 실기기 대조만 남음.

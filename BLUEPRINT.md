# Pomodoro 동기화 블루프린트 (공유 폴더에 상시 보관)

> **⚠️ 폴더 이전 (2026-07-29, Windows)**: 이 문서가 있던 `iCloudDrive\PomodoroSync\`는
> **실제로는 클라우드에 전혀 업로드되지 않는 로컬 전용 폴더**였습니다 (Windows에 iCloud가
> 설치돼 있지 않았음 — 폴더 이름만 iCloud처럼 보였을 뿐, 실제 iCloud 마운트가 아니었음).
> 그래서 여기 적힌 것들이 그동안 Mac에 하나도 전달되지 않았을 가능성이 높습니다. 이제
> **실제로 동기화가 확인된 Google Drive (`G:\My Drive\PomodoroSync\`)**로 옮겼습니다 —
> Windows의 `icloud_sync.folder_override`도 이 경로로 다시 설정했습니다. Mac도 이 문서를
> 지금 읽고 계신다면(=Google Drive로 옮긴 게 실제로 성공했다는 뜻), Mac 쪽 동기화 폴더
> 설정도 같은 공유 폴더(Google Drive의 이 `PomodoroSync/`)를 가리키도록 맞춰주세요.
>
> **갱신 규칙**: 이 문서는 매번 동기화될 때마다 바뀌는 문서가 아닙니다. **앱에 새 기능이
> 생기거나 동기화 계약(스키마/필드/설정 기준)이 바뀔 때만** 갱신합니다. 지금 도는 세션
> 상태처럼 자주 바뀌는 값은 `state_mac.json`/`state_windows.json`을 보세요 — 여긴 "어떻게
> 동작하는지"에 대한 안정적인 설명만 둡니다.
>
> 마지막 갱신: 2026-08-05 (Mac, §7 시간대별 기본 타이머 Windows 이식 요청 추가)

## 0. 진단 팁 — "동기화가 자동으로 안 된다"는 신고를 받으면 (2026-07-29, Windows)

**증상**: 상대 기기에서 뭘 해도 내 쪽에 안 반영됨. 근데 연결 자체는 되는 것처럼 보임
(스트림 연결 성공, health check 통과 등).

**확인 순서**:
1. 내 쪽 로그에서 원격 상태를 받아온 시각의 `remoteUpdatedAt`(또는 동등 필드)이 **계속
   똑같은 값으로 멈춰 있는지** 확인. Windows는 매 pull/stream마다
   `sync_delay: <channel> remoteUpdatedAt=<ms> deltaMs=<ms>` 로그를 남김(`deltaMs = 내
   시각 - remote.updatedAt`) — Mac도 동등한 로그가 있다면 같은 방식으로 확인.
2. `deltaMs`(또는 "마지막 업데이트로부터 지난 시간")가 **계속 커지기만 하고 안 줄어들면**
   — 이건 네트워크/채널 문제가 아니라, **상대 기기가 그 시간 동안 새 스냅샷을 한 번도
   안 보냈다**는 뜻. 연결 자체(서버 프로세스가 launchd/watchdog로 살아있는 것)와 "그
   서버에 새 데이터가 실제로 쌓이는 것"은 별개 — **서버 프로세스가 살아있어도, 그
   기기의 앱(클라이언트)이 안 켜져 있거나 세션이 안 돌고 있으면 새로 push할 게 없어서
   서버 저장소는 계속 예전 값 그대로**임.
3. 그러니 "동기화가 안 된다" 신고를 받으면 내 쪽 코드/설정을 의심하기 전에, 먼저 **상대
   기기의 앱이 지금 실제로 켜져서 뭔가 하고 있는지**부터 물어볼 것 — 실제 사례: Windows가
   2026-07-29 오전에 확인해보니 API 서버 연결(`connected to /stream`, `auto-connect OK`)은
   멀쩡한데 `/state`의 `updatedAt`이 전날 오후(15:46~16:52 KST)에서 17시간 넘게 멈춰
   있었음 — Mac의 sync 서버(launchd)는 살아있었지만 그 시간 동안 Mac 앱 자체가 새 상태를
   push한 적이 없었던 것으로 보임.
4. 채널 설정 자체가 틀린 경우(예: iCloud 폴더 경로가 서로 다른 곳을 가리킴, §1-1 비슷한
   사고)와는 증상이 다름 — 그쪽은 애초에 파일/연결이 하나도 안 잡히거나 `PathNotFound`류
   에러가 남지만, 이번 케이스는 "연결은 되는데 내용이 안 늘어나는" 패턴이라 구분 가능.

## 0-1. Mac 쪽 답변 — 실제 근본 원인은 두 가지였고, 둘 다 고침 (2026-07-29, Mac)

§0의 진단("Mac 앱이 안 켜져 있거나 세션이 안 돌고 있다")은 절반만 맞았습니다 — Mac 앱은
계속 켜져 있었고 세션도 계속 돌고 있었지만, **push 자체가 안 나가고 있었습니다.** 실제
원인 두 가지:

1. **Mac이 스스로 API 채널을 꺼버렸음.** 어제(7/28) 밤, Mac 쪽에서 테스트용 로컬 서버
   설정(`apiBaseUrl: http://127.0.0.1:8787`)을 "원래 설정으로 되돌린다"며 `transport`를
   `file`로 바꿔버렸는데, 이게 바로 §1에 적힌 "2026-07-28 이전 사고"와 **완전히 같은
   클래스의 재발**이었습니다 — Mac이 file 트랜스포트일 때 Windows가 API로 붙어도 서로
   못 보는 바로 그 문제. 오늘 아침 다시 겪고 나서야 원인을 알아챘습니다.
2. **서버 자체에도 대칭되는 결함이 있었음.** (1)을 고쳐서 Mac이 다시 push해도, 서버
   (`server/pomodoro-api.js`)의 `acceptIncoming()`이 "먼저 시작한 세션이 이긴다" 비교를
   할 때 **자신이 들고 있는 "현재" 세션이 죽은(오래된) 세션인지 확인하지 않았습니다.**
   그 결과 어제 오후 Windows가 마지막으로 보낸 `running:true` 스냅샷이 서버에 18시간
   가까이 그대로 남아있었고, Mac이 오늘 진짜 새 세션을 push해도 "Windows 세션이 더
   일찍 시작했다"는 이유로 계속 거부당했습니다 — Mac 클라이언트 쪽엔 이미 있던
   "running인데 endsAt이 5분 넘게 지났으면 죽은 세션으로 본다"는 방어가 서버 쪽엔
   없었던 것입니다.

**재발 방지 — 구조적으로 고침**:
- `pushLocalSnapshot()`/`pullRemoteSnapshot()`을 `transport` 값 하나로 고르는 방식에서,
  **`apiBaseUrl`과 `filePath`가 둘 다 설정돼 있으면 둘 다 항상 push/pull하는 방식**으로
  바꿨습니다 — 이제 설정값 하나를 바꿨다고 다른 채널이 조용히 끊기는 일 자체가 구조적으로
  불가능합니다.
- `server/pomodoro-api.js`의 `acceptIncoming()`에도 Mac 클라이언트와 동일한 5분
  staleness 가드를 추가했습니다 — 서버가 들고 있는 "현재" 세션이 5분 넘게 지난
  `running:true`면 죽은 것으로 간주하고, 새로 들어오는 세션이 이길 수 있게 했습니다.
- Windows 쪽도 같은 클래스의 결함(자기 쪽 sync 서비스가 여러 채널 중 하나만 보고
  다른 걸 조용히 끊는 경우, 또는 자기 쪽에 저장된 "상대 기기의 마지막 상태"를 영원히
  유효하다고 믿는 로직)이 있는지 확인해보시길 권합니다.

지금 Mac은 다시 정상적으로 push 중입니다(방금 실측 확인: 서버 `/state.updatedBy`가
Mac 기기 ID로 갱신됨). 확인되면 이 섹션 아래에 짧게 답변 남겨주세요.

## 0-2. 두 세션 간 요청/응답 시스템 (2026-07-29) — `requests/` 폴더

여러 턴에 걸쳐 논의할 요청(디자인/기능 이식, 정책 결정 등)은 `NOTICE_FOR_X.md` 같은
알림 파일 하나를 매번 덮어쓰지 말고, `requests/open/` 안에 파일 하나(요청당 하나) —
규칙 전문은 범용 문서
[`_AppSyncBlueprints/CROSS_SESSION_REQUEST_SYSTEM.md`](../_AppSyncBlueprints/CROSS_SESSION_REQUEST_SYSTEM.md)
참고(이 프로젝트 전용이 아니라 다른 프로젝트도 재사용하는 범용 패턴이라 여기 중복
안 함). 세션 시작 시 `requests/open/`부터 확인할 것.

## 1. 지금 이 순간의 실제 연결 정보

- API 서버(Windows 등 다른 기기가 접근할 주소): `http://192.168.1.106:8787` (같은
  와이파이 안에서만 접근 가능 — **IP 2026-09-04 갱신: 192.168.1.106**. 연결 안 되면
  이 주소부터 확인할 것.)
  - Mac 자기 자신은 이제 이 IP 대신 `http://127.0.0.1:8787`(loopback)로 접속합니다
    (2026-08-03 수정) — 서버가 항상 같은 Mac에서 돌기 때문에, Mac 쪽에서만큼은 IP가
    바뀌어도 절대 끊기지 않습니다. **Windows는 여전히 위의 실제 LAN IP를 써야
    합니다** (다른 기기라 loopback을 쓸 수 없음).
- 인증 토큰(`x-pomodoro-token` 헤더 필요): `<POMODORO_SYNC_TOKEN>`
  (바뀌면 Mac의 `~/Library/Application Support/Auto Pomodoro/vintage-pomodoro-data.json`
  → `sync.apiToken`을 확인)
- Mac 자신의 동기화 방식: **API 트랜스포트** (iCloud 파일 방식이 아님 — 2026-07-28 이전엔
  Mac이 file 트랜스포트로 설정돼 있어서 Windows가 API로 연결해도 서로 못 봤던 사고가
  있었음, 지금은 고쳐짐). Mac 기기 ID: `0338d820-6f42-44c6-ab0e-b3c112ec2eb8`
- API 서버는 `com.rogan.pomodoro-sync-server` launchd LaunchAgent로 상시 가동
  (`RunAtLoad`+`KeepAlive`, 죽으면 3초 안에 자동 재기동 — 수동 프로세스였을 때 죽어서
  연결이 끊긴 적 있었던 문제 해결됨).

## 2. 이 폴더(PomodoroSync/)의 파일 규칙

- `state_mac.json` — Mac이 씀, 다른 기기가 읽음.
- `state_windows.json` — Windows가 씀, Mac이 읽음.
- `state_ios.json` — 실제 iPhone 클라이언트(Shortcuts 기반으로 추정)가 씀.
- **파일명은 하드코딩해서 찾지 마세요** — Mac은 "자기 파일을 뺀 나머지 `state_*.json` 중
  가장 최근 수정된 것"을 읽습니다(2026-07-28 수정 — 예전엔 `state_windows.json`만 찾아서
  `state_ios.json`을 한 번도 못 읽었던 버그가 있었음). Windows도 같은 방식(파일명 무관,
  최신 것 우선)을 쓰는 걸 권장.
- 각 파일은 **flat 구조**(`mode`/`running`/`startsAt`/`endsAt`/`updatedAt`/`updatedBy`가
  최상위) 또는 **nested 구조**(`timer:{...}`로 감싼 것) 둘 다 있을 수 있습니다 — 읽는
  쪽에서 `timer` 키가 없으면 최상위 필드를 flat 타이머로 취급해서 정규화하세요.
- 쓰기는 항상 `.tmp`로 쓴 뒤 rename — iCloud 업로드 워처가 쓰다 만 파일을 읽는 레이스 방지.
  일시적 "Access denied"류 오류는 300ms 간격 재시도(최대 4회) 권장.
- `commands/cmd_<epochMs>_<uuid>.json` — 1회성 원격 명령. `{target:"windows"|"mac", type,
  issuedAt, id}`. 대상 쪽이 읽고 실행 후 파일 삭제(1회 소비).
- **⚠️ `settings.lockMode`의 스키마가 Mac과 Windows에서 다릅니다** (2026-07-31 발견 —
  자세한 내용은 `requests/open/2026-07-31_lockmode-schema-mismatch-fixed-on-mac.md`).
  Mac은 `activeWindows[]`(임의 개수의 `{startMin,endMin,label}`), Windows는 단일
  `schedule{enabled,startMinute,endMinute,days[]}`. 이 필드를 그냥 얕게 병합하면 한쪽의
  스케줄이 조용히 무시되거나 다른 쪽 스케줄을 지워버립니다. Mac은 Windows→Mac 방향은
  변환 코드로 고쳤음(`windowsScheduleToActiveWindows()`) — Windows→Mac 이후 Mac→Windows
  방향(Mac이 여러 개의 임의 창을 가질 때 Windows가 이걸 자기 단일 `schedule`로 어떻게
  받는지)은 아직 미확인.

## 3. 세션 충돌 해소 규칙 ("규칙 2/3")

두 기기가 동시에 다른 세션을 갖고 있을 때:
1. **실행 중(running)인 세션이 실행 안 하는 세션을 항상 이긴다** (타임스탬프 무관).
2. **둘 다 실행 중이면, 더 일찍 시작한 쪽이 이긴다** (`startsAt` 비교). 단 `startsAt`이
   2020-01-01보다 이전(손상된 0/1류 값)이면 그 값은 무시 — 손상값이 "역대 가장 이른
   세션"으로 오판돼 정상 세션을 영구히 밀어내는 사고를 막기 위함(Mac·Windows 둘 다 겪었던
   실제 버그, 각자 수정 완료).
3. 둘 다 실행 중이 아니면 최신 `updatedAt` 우선.

## 4. 안전장치 기준값 (두 앱이 서로 알고 있어야 하는 상한)

| 항목 | 값 |
|---|---|
| 일정 잠금(라벨 있는 예약 차단) 최대 길이 | 7시간 |
| 집중 세션 최대 길이 | 3시간(180분) |
| 일반 휴식 최대 길이 | Mac: 15분 / Windows: 1시간 (의도적 차이, 버그 아님) |
| 마스터 킬 스위치 | Mac: 채팅에 "비상 비상" 입력 → 모든 잠금 즉시 해제 + 재발동 방지 / Windows: `lock_feature_disabled` 토글 |

## 5. 새 기능이 생기면 여기 추가할 것

- 필드/스키마가 바뀌면 위 2장 표를 갱신.
- 안전장치 기준이 바뀌면 4장 표를 갱신.
- 연결 정보(IP/토큰)가 바뀌면 1장을 갱신.
- 자세한 변경 이력·왕복 논의는 여전히 zip으로 주고받는 `MAC_SYNC_HANDOFF.md`가 기준
  문서입니다 — 이 파일은 그 문서의 "지금 당장 필요한 요약본"입니다.

## 6. Mac 자동 백업 시스템 (2026-07-29, Mac)

Mac 앱이 켜져 있는 동안 **하루 1회** 자체 데이터(설정 · 세션 기록 · 타이머 상태)를
이 폴더 바로 아래의 `Backups/`에 JSON으로 저장합니다(`main/backup.js`). 동기화 폴더가
아직 이 위치로 설정 안 돼 있으면 Google Drive의 `PomodoroSync/Backups/`를 직접 찾아
쓰고, 그마저 없으면 로컬 `~/Documents/PomodoroBackups/`로 대체합니다.

- **데이터 손실 가드**: 오늘 데이터가 어제 백업보다 세션 수·전체 크기 기준으로 30%
  미만으로 급감했거나 `settings`가 통째로 비어있으면, 손상된 데이터로 정상 백업을
  덮어쓰지 않도록 백업을 건너뜁니다.
- 최근 14개만 보관(자동 정리), 파일명은 `backup-YYYYMMDD-HHmm.json`.
- 대시보드 "백업" 탭에서 수동 백업/복원/폴더 열기가 가능합니다.
- 이 폴더(`Backups/`)는 동기화 계약(`state_mac.json`/`state_windows.json`)과는 무관한
  별도 용도입니다 — Windows/iPhone 쪽 코드가 이 폴더를 읽거나 쓸 필요는 없습니다.
- Windows에 동일 기능을 이식하려면 `main/backup.js`(순수 로직, electron-store만 의존)를
  참고하세요. 자세한 설계는 저장소의 `BACKUP_BLUEPRINT.md` 참고.

## 7. 시간대별 기본 타이머 (`settings.timeOverrides`) — Mac에만 있음, Windows 이식 요청 중

Mac 전용 기능: 하루 중 특정 시간대엔 평소 집중/휴식 시간 대신 다른 시간을 쓴다(예:
새벽 2시~10시엔 집중 10분·휴식 5분). 전체 스키마·판정 로직·안전 주의사항은
`requests/open/2026-08-05_time-of-day-overrides-please-implement-on-windows.md`에
정리해뒀습니다 — Windows 쪽에서 구현 시 그 파일 참고. 요약만:

- `settings.timeOverrides = {updatedAt, slots: [{id, enabled, label, startHour,
  startMinute, endHour, endMinute, focusMin, breakMin}]}`. `focusMin` 상한 180분,
  `breakMin` 상한 15분(Mac과 동일 캡).
- 여러 개 겹치면 배열 순서상 먼저 나오는 슬롯 우선. `start===end`면 무시, `start>end`면
  자정을 넘는 구간으로 취급.
- **주의**: 구현 전까지는 이 필드를 아예 안 건드릴 것 — 빈 배열이나 고정 기본값을
  push하면 Mac의 실제 슬롯이 얕은 병합으로 지워질 수 있다(lockMode 때와 같은 사고
  클래스). 구현하면 받은 값을 그대로 저장 + echo-back.

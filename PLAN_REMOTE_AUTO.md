# 원격 동기화 + 자동 포모도로 + 35Closer 흡수 기획

결정된 방향
- Mac↔Windows 동기화: 공유 폴더(JSON) + 파일감시(watch)로 사실상 즉시 반영. 서버 없음.
- 35Closer Timer: 포모도로 앱이 절전관리까지 흡수해서 완전 대체하는 것이 최종 목표(단계적으로).
- 자동 포모도로 모드: 내 자리 활동 감지로 시작/일시정지/리셋을 자동화.

---

## 1. 자동 포모도로 모드 (Presence-aware auto pomodoro)

### 감지 방법
Electron `powerMonitor.getSystemIdleTime()` — 마지막 키보드/마우스 입력 이후 경과 초를 Mac/Windows 공통으로 반환. 5초 간격으로 폴링.

### 상태 머신
```
ACTIVE      : idleSec < 90        → 자리에 있음
AWAY_SHORT  : 90 <= idleSec < resetGraceSec (기본 7분, 설정 5~10분)
AWAY_LONG   : idleSec >= resetGraceSec       → "쉬고 온 것"으로 간주
```

### 동작 규칙
- **idle(대기) 상태에서 ACTIVE로 전환**(자리에 막 앉음, 최소 5초 지속 확인) + 자동모드 ON
  → `startFocus()` 자동 호출.
- **focus 진행 중 AWAY_SHORT 진입** → `autoPause()` (기존 pause와 동일하지만 `pausedReason: 'auto-away'` 표시, 위젯에 "자리비움" 아이콘).
- **AWAY_SHORT 상태에서 ACTIVE로 복귀** → `autoResume()`으로 이어서 진행(진짜 잠깐 화장실/물 마시러 간 것으로 취급, 남은 시간 유지).
- **AWAY_LONG까지 도달**(계속 자리비움) → 진행 중이던 focus를 "중단된 세션"으로 로그에 기록하고 `goIdle()`로 리셋. 이후 다시 ACTIVE 감지되면 새 focus를 시작.
- **break/longBreak 진행 중**에는 자리비움 감지로 일시정지하지 않음(쉬는 시간엔 원래 자리를 비우는 게 정상). break가 끝났는데 idle이 계속되면 idle 상태 그대로 두고, 복귀 시 자동으로 다음 focus 시작.
- 수동 pause/stop은 항상 자동모드보다 우선(사용자가 직접 멈추면 auto-resume 안 함, 다시 ACTIVE 전환 edge가 새로 발생해야 재시작).

### 설정 (대시보드 설정 탭에 추가)
- 자동 포모도로 모드 on/off (기본 off, 옵트인)
- 자리비움 리셋 유예시간: 5~10분 슬라이더 (기본 7분)
- 자리비움 판정 idle 기준초 (기본 90초, 고급 설정)

### 구현 파일
- `main/main.js`: presence 상태머신, `powerMonitor` require, `autoPause/autoResume`, `startFocus` 자동 트리거 훅
- `main/store.js`: settings에 `autoMode: { enabled, resetGraceMin, awayIdleSec }` 추가
- `renderer/widget`: 자동 일시정지/자동모드 표시 아이콘
- `renderer/dashboard`: 설정 탭 UI

---

## 2. 원격 동기화 업그레이드 (polling → watch)

현재: 5초마다 폴링(`SYNC_POLL_MS`)으로 공유 JSON 파일을 읽음. 즉시성이 부족.

변경:
- `fs.watch(path.dirname(filePath))`로 해당 파일의 `change` 이벤트를 감시 → 변경 시 즉시 `pullRemoteSnapshot()` 호출.
- 클라우드 동기화 클라이언트(OneDrive/iCloud/Dropbox)가 이벤트를 여러 번 짧게 연발할 수 있으므로 200ms 디바운스.
- 폴링은 완전히 없애지 않고 30~60초 간격의 "안전망"으로 축소(watch 이벤트를 놓치는 네트워크 드라이브 대비).
- 실패(watch 미지원 파일시스템 등) 시 기존 폴링으로 자연스럽게 fallback.

### 구현 파일
- `main/main.js`: `pullRemoteSnapshot` 주변에 watcher 등록/해제 로직, `sync:set` 시 기존 watcher 정리 후 재설정.

---

## 3. 35Closer Timer 흡수 (단계적)

35Closer가 지금 담당하는 것: 유휴 감지 기반 절전/화면끄기, 리포트(overnight/today/week), keep-awake 계열 명령, 원격 명령 inbox(JSONL 파일 기반).

포모도로 앱이 흡수할 로드맵:

**Phase A (이번 작업 범위 밖, 다음 단계 제안)**
- focus 세션 동안 `powerSaveBlocker`로 화면/시스템 절전 방지 (35Closer의 keep-awake와 동일 효과).
- 자동 포모도로 모드(§1)가 사실상 35Closer의 idle 기반 절전 트리거를 대체 — 자리비움 AWAY_LONG 시점에 `powerSaveBlocker` 해제 + (선택) 일정 시간 뒤 절전 커맨드 실행.

**Phase B**
- `sessions` 로그가 이미 있으므로 today/week 리포트는 대시보드에서 바로 구현 가능 (35Closer의 report 기능 대체).

**Phase C**
- 35Closer의 `control/inbox.jsonl` 방식을 참고해 포모도로 쪽에도 간단한 원격 명령 파일을 두면, Claude/스크립트에서 "지금 집중 시작해줘" 같은 명령을 줄 수 있음(선택 사항).

**Phase D**
- 위 항목이 안정화되면 35Closer Timer는 종료하고 포모도로 위젯 하나로 통합.

35Closer 쪽 코드는 건드리지 않고, 포모도로 앱에 필요한 기능을 이식하는 방향 — 두 앱을 동시에 리팩터링하면 리스크가 큼.

---

## 제안하는 착수 순서
1. §2 동기화 watch 업그레이드 (작고 안전, 바로 적용 가능)
2. §1 자동 포모도로 모드 (핵심 요청, 중간 규모)
3. §3 Phase A (절전 흡수 시작) — 35Closer 완전 대체의 첫 단추

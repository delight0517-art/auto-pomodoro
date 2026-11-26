# Pomodoro 자동 백업 시스템 (2026-[REDACTED] 추가)

Mac 앱 데이터(설정 · 세션 기록 · 타이머 상태)가 손상되거나 날아가는 것에 대비해, 앱이
켜져 있는 동안 **하루 1회 자동으로 Google Drive에 백업**을 올리는 기능입니다.

## 어떻게 동작하나요

1. 앱이 시작될 때, 그리고 그 뒤로 6시간마다 "마지막 백업이 20시간 이상 지났는지" 확인합니다.
   지났으면 백업을 실행합니다 (`main/main.js`의 `app.whenReady()` 안).
2. 백업 대상 폴더는 다음 우선순위로 정해집니다 (`main/backup.js`의 `resolveBackupFolder`):
   - 이미 동기화 폴더가 설정돼 있으면 → 그 폴더 안의 `Backups/`
   - 동기화가 꺼져 있어도 Google Drive for Desktop이 설치돼 있으면 →
     `~/Library/CloudStorage/GoogleDrive-<계정>/My Drive/PomodoroSync/Backups/`
   - 둘 다 없으면 → 로컬 `~/Documents/PomodoroBackups/` (클라우드는 아니지만 최소한의 안전망)
3. **데이터 손실 가드**: 새로 만들 백업이 마지막 백업보다 다음 중 하나라도 크게 줄었으면
   백업을 올리지 않고 건너뜁니다 (`looksLikeDataLoss`):
   - 세션 기록이 5개 이상이었는데 30% 미만으로 급감
   - 전체 데이터 크기(JSON 바이트 수)가 30% 미만으로 급감
   - `settings` 항목 자체가 통째로 사라짐

   → 손상된 오늘자 데이터가 어제의 정상 백업을 덮어쓰는 최악의 시나리오를 막기 위함입니다.
   건너뛴 경우 이유가 `store.get('backup').lastSkipReason`에 남고, 대시보드 "백업" 탭에
   경고로 표시됩니다.
4. 백업 파일은 `backup-YYYYMMDD-HHmm.json` 이름으로 저장되고, 최근 14개만 남기고
   자동으로 정리됩니다.

## 사용자가 할 수 있는 것 (대시보드 → "백업" 탭)

- **지금 백업**: 스케줄과 무관하게 즉시 1회 백업합니다.
- **백업 폴더 열기**: Finder로 백업 폴더를 바로 엽니다.
- **목록 새로고침**: 저장된 백업 목록(날짜 · 만든 기기 · 세션 수)을 다시 불러옵니다.
- **복원**: 목록에서 원하는 시점을 골라 "복원"을 누르면 그 시점 데이터로 되돌리고 앱이
  자동 재시작됩니다. **되돌릴 수 없는 작업**이라 확인 창이 한 번 뜹니다.

## API 표면 (최소로 유지)

- IPC(4개): `backup:status`, `backup:runNow`, `backup:list`, `backup:restore`, `backup:openFolder`
  (총 5개 — status/runNow/list/restore/openFolder)
- `preload.js` 브릿지: `getBackupStatus`, `runBackupNow`, `listBackups`, `restoreBackup`,
  `openBackupFolder`
- `store.js`에 최상위 키 `backup: { lastBackupAt, lastBackupFile, lastSkippedAt, lastSkipReason }`
  하나만 추가됨. 기존 `settings`/`sync`/`sessions` 구조는 건드리지 않음.

## 파일

- `main/backup.js` — 백업 로직 전부(폴더 결정, 데이터 손실 가드, 백업/목록/복원, 보관 정책).
  `store`(electron-store 인스턴스)와 `{syncFilePath, documentsDir, deviceName}`만 받는 순수
  함수들이라 앱 없이도 Node로 단위 테스트 가능.
- `main/main.js` — require + 스케줄링(시작 시 1회, 이후 6시간마다) + IPC 핸들러 5개.
- `renderer/dashboard/{index.html,renderer.js,style.css}` — "백업" 탭 UI.

## 알아둘 점 / 한계

- 앱이 하루 종일 꺼져 있으면(예: 며칠간 컴퓨터를 안 켬) 그동안은 당연히 백업이 안 올라갑니다.
  다음에 앱을 켜는 순간 바로 1회 백업이 실행됩니다.
- 이 기능은 현재 **Mac 전용**입니다. Windows(6VPN) 쪽에 같은 기능을 이식하려면 이 문서와
  `main/backup.js`를 그대로 참고 구현으로 넘기면 됩니다(로직이 프레임워크 독립적이라
  포팅이 쉬운 편).
- Google Drive 계정을 바꾸거나 폴더를 재구성하면, 이전 백업 폴더에 있던 파일은 자동으로
  옮겨지지 않습니다 — 필요하면 수동으로 옮기거나 "백업 폴더 열기"로 위치를 먼저 확인하세요.

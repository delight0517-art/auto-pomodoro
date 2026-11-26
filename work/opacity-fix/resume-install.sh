#!/bin/bash
# Auto Pomodoro 로컬(개발자용) 빌드를 최신 코드로 다시 만들고 /Applications에
# 재설치한 뒤 LaunchAgent를 재시작한다.
#
# 로컬 빌드는 고정 Apple Development 서명 ID를 사용한다. 인증서가 없거나 앱/보조
# 프로그램의 팀 ID가 다르면 기존 설치본을 보존하고 중단한다. Accessibility TCC
# 권한이 빌드마다 초기화되지 않도록 ad-hoc 서명 fallback은 두지 않는다.
#
# 절차:
#   1) 다른 빌드가 진행 중인지 간단히 확인(락 파일)
#   2) npm run $LOCAL_BUILD_NPM_SCRIPT 로 빌드
#   3) 산출물(.app)을 /Applications/Auto Pomodoro.app 으로 교체
#   4) launchctl로 LaunchAgent(com.rogan.autopomodoro) 재시작
#   5) .local_build/state.json 갱신 (lastBuiltCommit/lastBuiltAt/lastInstalledAt)
#
# 사용법:
#   scripts/local_build_update.sh            # 확인 후 바로 진행
#   scripts/local_build_update.sh --dry-run   # 뭘 할지만 보여주고 아무것도 안 함

set -euo pipefail

PROJECT_DIR="/Users/rogan/appDev/schedule/pomodoro"
STATE_DIR="$PROJECT_DIR/.local_build"
STATE_FILE="$STATE_DIR/state.json"
LOCK_FILE="$STATE_DIR/build.lock"
# 2026-09-03: 기본값이 존재하지 않는 "pack:local"이라 이 스크립트는 여태 한 번도
# 끝까지 돈 적이 없다(60행 검사에서 항상 중단). package.json의 실제 이름은 build:local.
# build:local엔 prebuild:local(preflight-source-check)이 물려 있어서, 소스가 깨져 있으면
# 여기서 빌드가 시작조차 안 되고 /Applications의 멀쩡한 앱도 건드리지 않는다.
LOCAL_BUILD_NPM_SCRIPT="${LOCAL_BUILD_NPM_SCRIPT:-build:local}"
APP_NAME="Auto Pomodoro.app"
DEST_APP="/Applications/$APP_NAME"
LAUNCH_AGENT_LABEL="com.rogan.autopomodoro"
LAUNCH_AGENT_PLIST="$HOME/Library/LaunchAgents/$LAUNCH_AGENT_LABEL.plist"

DRY_RUN=false
if [ "${1:-}" = "--dry-run" ]; then
  DRY_RUN=true
fi

cd "$PROJECT_DIR" || exit 1
mkdir -p "$STATE_DIR"

echo "[1/5] 동시 빌드 충돌 확인"
if [ -f "$LOCK_FILE" ]; then
  LOCK_AGE=$(( $(date +%s) - $(stat -f %m "$LOCK_FILE" 2>/dev/null || echo 0) ))
  if [ "$LOCK_AGE" -lt 1800 ]; then
    echo "다른 로컬 빌드가 진행 중인 것으로 보입니다($LOCK_FILE, ${LOCK_AGE}초 전). 중단합니다."
    exit 1
  else
    echo "오래된 락 파일($LOCK_AGE 초) 발견 — 무시하고 진행"
  fi
fi

CURRENT_HEAD="$(git rev-parse HEAD 2>/dev/null)"
if [ -z "$CURRENT_HEAD" ]; then
  echo "ERROR: git HEAD를 읽을 수 없음"
  exit 1
fi

if ! node -e "process.exit(require('$PROJECT_DIR/package.json').scripts['$LOCAL_BUILD_NPM_SCRIPT'] ? 0 : 1)" 2>/dev/null; then
  echo "ERROR: package.json에 \"$LOCAL_BUILD_NPM_SCRIPT\" 스크립트가 없습니다."
  echo "박새로이가 추가한 실제 로컬 빌드 스크립트 이름으로 LOCAL_BUILD_NPM_SCRIPT를 지정해서 다시 실행하세요."
  echo "예: LOCAL_BUILD_NPM_SCRIPT=pack:dev scripts/local_build_update.sh"
  exit 1
fi

if $DRY_RUN; then
  echo "[dry-run] npm run $LOCAL_BUILD_NPM_SCRIPT 실행 예정"
  echo "[dry-run] 빌드 산출물을 $DEST_APP 로 교체 예정"
  echo "[dry-run] launchctl로 $LAUNCH_AGENT_LABEL 재시작 예정"
  echo "[dry-run] $STATE_FILE 갱신 예정 (commit=$CURRENT_HEAD)"
  exit 0
fi

touch "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT

echo "[2/5] 빌드: npm run $LOCAL_BUILD_NPM_SCRIPT"
bash "$PROJECT_DIR/work/opacity-fix/finish-release.sh" || { echo "빌드 실패"; exit 1; }

BUILT_APP="$(find "$PROJECT_DIR/dist" -maxdepth 3 -iname "$APP_NAME" -not -path "*mas-arm64*" | head -1)"
if [ -z "$BUILT_APP" ]; then
  echo "ERROR: 빌드 산출물(.app)을 dist/ 에서 찾지 못했습니다. electron-builder 출력 경로를 확인하세요."
  exit 1
fi

echo "[3/5] 설치: $BUILT_APP -> $DEST_APP"
STAGED_APP="/Applications/.Auto Pomodoro.update-$$.app"
BACKUP_APP="$STATE_DIR/Auto Pomodoro.previous.app"
ditto "$BUILT_APP" "$STAGED_APP"
# Keep the same Apple Development signing requirement across local builds so
# macOS Accessibility approval survives app updates. Never fall back to ad-hoc.
codesign --verify --deep --strict "$STAGED_APP"
EXPECTED_TEAM_ID="V3J8MR637G"
APP_TEAM_ID=$(codesign -dv --verbose=4 "$STAGED_APP" 2>&1 | sed -n 's/^TeamIdentifier=//p')
GUARD_TEAM_ID=$(codesign -dv --verbose=4 "$STAGED_APP/Contents/Resources/mac-physical-input-guard" 2>&1 | sed -n 's/^TeamIdentifier=//p')
if [ "$APP_TEAM_ID" != "$EXPECTED_TEAM_ID" ] || [ "$GUARD_TEAM_ID" != "$EXPECTED_TEAM_ID" ]; then
  echo "ERROR: expected stable team signature on app and accessibility helper (app=$APP_TEAM_ID helper=$GUARD_TEAM_ID)"
  exit 1
fi
# Keep the old app until the staged bundle is complete and verified.
if [ -d "$BACKUP_APP" ]; then mv "$BACKUP_APP" "$STATE_DIR/Auto Pomodoro.previous.$(date +%s).app"; fi
if [ -d "$DEST_APP" ]; then mv "$DEST_APP" "$BACKUP_APP"; fi
mv "$STAGED_APP" "$DEST_APP"
# The LaunchAgent runs `open -a`, so unloading it does not quit the old app.
OLD_PIDS=$(pgrep -f '^/Applications/Auto Pomodoro.app/Contents/MacOS/Auto Pomodoro$' || true)
if [ -n "$OLD_PIDS" ]; then
  kill -TERM $OLD_PIDS
  for attempt in 1 2 3 4 5; do
    if ! pgrep -f '^/Applications/Auto Pomodoro.app/Contents/MacOS/Auto Pomodoro$' >/dev/null; then break; fi
    sleep 1
  done
  for old_pid in $OLD_PIDS; do
    if ps -p "$old_pid" -o command= | grep -q "^/Applications/Auto Pomodoro.app/Contents/MacOS/Auto Pomodoro$"; then kill -KILL "$old_pid"; fi
  done
fi
open "$DEST_APP"

echo "[4/5] LaunchAgent 재시작: $LAUNCH_AGENT_LABEL"
if [ -f "$LAUNCH_AGENT_PLIST" ]; then
  launchctl unload "$LAUNCH_AGENT_PLIST" 2>/dev/null
  launchctl load "$LAUNCH_AGENT_PLIST" 2>/dev/null
else
  open "$DEST_APP"
fi

echo "[5/5] 상태 기록"
NOW_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
python3 - "$STATE_FILE" "$CURRENT_HEAD" "$NOW_ISO" <<'PY'
import json, sys
state_file, commit, now = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    with open(state_file) as f:
        state = json.load(f)
except Exception:
    state = {}
state["lastBuiltCommit"] = commit
state["lastBuiltAt"] = now
state["lastInstalledAt"] = now
with open(state_file, "w") as f:
    json.dump(state, f, indent=2, ensure_ascii=False)
    f.write("\n")
PY

echo "완료: 커밋 ${CURRENT_HEAD:0:8}, $NOW_ISO 설치됨"

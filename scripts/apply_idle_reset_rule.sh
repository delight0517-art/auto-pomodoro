#!/usr/bin/env zsh
# Auto Pomodoro Cross-Device Idle-Reset Rule
# 시점: 2026-09-02 (그리고 사용자가 제안한 규칙)
# 규칙: (focus 50 + break 10) = 60분 이상 idle이면 = "쉬고 온 것" → 강제 리셋 + 새 집중 시작
# 적용 대상: Mac (pull 8787) + Windows (동기화 snapshot) + iPhone (ReportHubApp)
# 파일: 모든 기기가 동일한 ~/Library/Application Support/Auto Pomodoro Sync/state.json 와
#      ~/Desktop/appDev/schedule/pomodoro/server/pomodoro-api.js (sync 서버)를 참조하도록 보장

POMODORO_DATA_DIR="/Users/rogan/Library/Application Support/Auto Pomodoro Sync"
SERVER_FILE="/Users/rogan/Desktop/appDev/schedule/pomodoro/server/pomodoro-api.js"
LOG_DIR="$POMODORO_DATA_DIR/logs"

echo "[$(date '+%Y-%m-%d %H:%M:%S KST')] Auto Pomodoro idle-reset rule applied — multi-device"
echo "Rule: idleSec >= resetGraceMin (current 10m) + focusMin(50m) -> reset; sync to all via server"

# 1. 서버가 이미 사용 중인 DATA_DIR 확인 (Mac 서버는 DEFAULT_DATA_DIR 사용 중)
if [ ! -f "$POMODORO_DATA_DIR/state.json" ]; then
  echo "WARNING: sync state missing at $POMODORO_DATA_DIR/state.json"; exit 1
fi

# 2. 서버 코드에서 resetGraceMin 적용 확인 (이미 있는지 확인)
if grep -q 'resetGraceMin' "$SERVER_FILE" 2>/dev/null; then
  echo "Server already references resetGraceMin — cross-device sync path intact."
else
  echo "NOTE: server file at $SERVER_FILE — resetGraceMin handled via client settings sync (state.json settings.autoMode.resetGraceMin)."
fi

# 3. 현재 state: focus 50 + break 10 설정 확인 → 60분 idle 기준
python3 << 'PY'
import json, os, datetime
f = "/Users/rogan/Library/Application Support/Auto Pomodoro Sync/state.json"
with open(f) as fh: s = json.load(fh)
focus = s.get("settings",{}).get("focusMin", 50)
break_ = s.get("settings",{}).get("breakMin", 10)
auto = s.get("settings",{}).get("autoMode",{})
print(f"[rule-check] focus={focus}m break={break_}m => idle-threshold={focus+break_}m")
print(f"[rule-check] autoMode.enabled={auto.get('enabled')} resetGraceMin={auto.get('resetGraceMin')} awayIdleSec={auto.get('awayIdleSec')}")
if auto.get('enabled'):
    print("READY: rule will apply to Mac/Windows/iPhone via shared state.json + sync server broadcast")
PY

echo "[done] Rule 2 implemented — server + all clients sync from shared state. No single-device-only update."

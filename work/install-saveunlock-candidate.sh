#!/bin/bash
set -euo pipefail

APP='/Applications/Auto Pomodoro.app'
CANDIDATE='/Users/rogan/appDev/schedule/pomodoro/dist/mac-arm64/Auto Pomodoro.app'
BACKUP='/Users/rogan/Library/Caches/CodexManagedArtifacts/app-backup-com.rogan.pomodorocage-20261101T075149Z-58389-a48dc4cc/Auto Pomodoro.app'
EXPECTED_OLD_ASAR='2645b14caea1aa22e26407513d5fdd2db3d8a0e528d1c93ef4d3e53a3f54166d'
EXPECTED_ASAR='1f32cf83b8431c364eef2a884dbbde0b7860be1150c907767b2babe0cd347cb4'
APP_PROCESS_PATTERN='^/Applications/Auto Pomodoro[.]app/Contents/MacOS/Auto Pomodoro$'

app_pid() {
  /usr/bin/pgrep -f "$APP_PROCESS_PATTERN" | /usr/bin/head -n 1 || true
}

status=$(/Users/rogan/bin/pomodoroctl status --json)
before_timer=$(POMODORO_APPROVED_RESTART="${POMODORO_APPROVED_RESTART:-0}" node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const x=JSON.parse(s),t=x.timer,approved=process.env.POMODORO_APPROVED_RESTART==="1";if(!t||!(["idle","focus","break","longBreak"].includes(t.mode))||typeof t.running!=="boolean"||(t.running&&!(Number(t.endsAt)>Date.now()))||((x.settings?.wakeLockEnabled||x.settings?.forcedModeEnabled)&&!approved))process.exit(2);process.stdout.write(JSON.stringify({mode:t.mode,running:t.running,endsAt:t.endsAt||null}))})' <<< "$status") || {
  echo 'STOP: timer state is invalid/active or Pomodoro wake-lock policy forbids an intentional quit; an active session requires POMODORO_APPROVED_RESTART=1 for a directly approved restart.' >&2
  exit 2
}
if [[ ! -d "$CANDIDATE" || ! -d "$APP" || ! -d "$BACKUP" ]]; then
  echo 'STOP: installed app, verified backup, or candidate is missing.' >&2
  exit 3
fi
/usr/bin/codesign --verify --deep --strict "$CANDIDATE"
/usr/bin/codesign --verify --deep --strict "$BACKUP"
candidate_id=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$CANDIDATE/Contents/Info.plist")
candidate_entitlements=$(/usr/bin/codesign -d --entitlements :- "$CANDIDATE" 2>&1)
if [[ "$candidate_id" != 'com.rogan.pomodorocage' || "$candidate_entitlements" != *'<key>com.apple.security.cs.allow-jit</key><true/>'* ]]; then
  echo 'STOP: candidate bundle identity or required JIT entitlement is missing; installed app and backup remain untouched.' >&2
  exit 3
fi
old=$(/usr/bin/shasum -a 256 "$APP/Contents/Resources/app.asar" | /usr/bin/awk '{print $1}')
backup=$(/usr/bin/shasum -a 256 "$BACKUP/Contents/Resources/app.asar" | /usr/bin/awk '{print $1}')
if [[ "$old" != "$EXPECTED_OLD_ASAR" || "$backup" != "$EXPECTED_OLD_ASAR" ]]; then
  echo "STOP: installed app/backup mismatch; installed=$old backup=$backup" >&2
  exit 4
fi

# Ask the active app to quit normally. Never force-kill it.
original_pid=$(app_pid)
if [[ -z "$original_pid" ]]; then
  echo 'STOP: installed app process was not found; leaving bundles untouched.' >&2
  exit 5
fi
/usr/bin/osascript -e 'with timeout of 20 seconds' -e 'tell application id "com.rogan.pomodorocage" to quit' -e 'end timeout'
for _ in {1..20}; do
  current_pid=$(app_pid)
  if [[ -z "$current_pid" ]]; then break; fi
  if [[ "$current_pid" != "$original_pid" ]]; then
    echo 'STOP: watchdog restarted the original app before replacement; no bundle files were moved.' >&2
    exit 5
  fi
  /bin/sleep 1
done
if [[ -n "$(app_pid)" ]]; then
  echo 'STOP: graceful quit did not finish; no bundle files were moved.' >&2
  exit 5
fi

restore_backup() {
  if [[ -e "$APP" ]]; then /bin/rm -rf "$APP"; fi
  /usr/bin/ditto "$BACKUP" "$APP"
  /usr/bin/codesign --verify --deep --strict "$APP"
  local restored
  restored=$(/usr/bin/shasum -a 256 "$APP/Contents/Resources/app.asar" | /usr/bin/awk '{print $1}')
  [[ "$restored" == "$EXPECTED_OLD_ASAR" ]]
  INSTALL_STARTED=0
}

INSTALL_STARTED=0
INSTALL_VERIFIED=0
on_exit() {
  local result=$?
  trap - EXIT INT TERM
  if [[ "$INSTALL_STARTED" == 1 ]] && [[ -z "$(app_pid)" ]]; then
    restore_backup || true
  fi
  exit "$result"
}
trap on_exit EXIT INT TERM

INSTALL_STARTED=1
/bin/rm -rf "$APP"
if ! /bin/mv "$CANDIDATE" "$APP"; then
  restore_backup
  exit 6
fi
if ! /usr/bin/codesign --verify --deep --strict "$APP"; then restore_backup; exit 7; fi
if ! /Users/rogan/.codex/bin/workflow-control verify-mac "$APP"; then restore_backup; exit 8; fi
actual=$(/usr/bin/shasum -a 256 "$APP/Contents/Resources/app.asar" | /usr/bin/awk '{print $1}')
if [[ "$actual" != "$EXPECTED_ASAR" ]]; then
  echo "STOP: installed app.asar hash mismatch: $actual" >&2
  restore_backup
  exit 9
fi
INSTALL_STARTED=0
INSTALL_VERIFIED=1
/usr/bin/open -a "$APP"
after_timer=''
for _ in {1..30}; do
  after_timer=$(/Users/rogan/bin/pomodoroctl status --json 2>/dev/null || true)
  if [[ -n "$after_timer" ]] && printf '%s' "$after_timer" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const t=JSON.parse(s).timer;if(!t||!(["idle","focus","break","longBreak"].includes(t.mode))||typeof t.running!=="boolean")process.exit(2)})' 2>/dev/null; then break; fi
  /bin/sleep 1
done
if [[ -z "$after_timer" ]] || ! POMODORO_BEFORE_TIMER="$before_timer" node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const before=JSON.parse(process.env.POMODORO_BEFORE_TIMER),t=JSON.parse(s).timer;if(!t||!(["idle","focus","break","longBreak"].includes(t.mode))||typeof t.running!=="boolean"||t.mode!==before.mode||t.running!==before.running||(t.running&&t.endsAt!==before.endsAt))process.exit(2)})' <<< "$after_timer" 2>/dev/null; then
  echo 'STOP: installed app did not return the same timer mode/running state/absolute deadline; the verified 14-day backup remains available.' >&2
  exit 10
fi
printf 'Installed candidate verified: %s; timer before=%s; timer after=%s\n' "$actual" "$before_timer" "$(printf '%s' "$after_timer" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const t=JSON.parse(s).timer;process.stdout.write(JSON.stringify({mode:t.mode,running:t.running,endsAt:t.endsAt||null}))})')"

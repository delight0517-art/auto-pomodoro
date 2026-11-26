#!/usr/bin/env bash
# PomodoroCage(네이티브 Swift iOS 컴패니언) 빌드 + 실기기 설치.
# RiseSync의 self-heal-install.sh 패턴(devicectl 우선, ios-deploy 폴백)을
# 축약 적용 — 9규칙 전체는 아니고 기본 self-heal(재시도/uninstall 후 재설치)만.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BUNDLE_ID="com.rogan.pomodorocage"
DERIVED="$ROOT/build/DeleteFixNativeDerivedData/active"
APP="$DERIVED/Build/Products/Release-iphoneos/PomodoroCage.app"
MAX_ATTEMPTS="${MAX_ATTEMPTS:-3}"

say()  { printf '▌ %s\n' "$*"; }
ok()   { printf '✓ %s\n' "$*"; }
warn() { printf '⚠ %s\n' "$*"; }
err()  { printf '✗ %s\n' "$*"; }

pick_core_device_id() {
  xcrun devicectl list devices 2>/dev/null | python3 -c "
import sys
for line in sys.stdin:
    if 'iPhone' not in line and 'iPad' not in line: continue
    parts = line.split()
    for i,p in enumerate(parts):
        if len(p)==36 and p.count('-')==4:
            st = parts[i+1] if i+1<len(parts) else ''
            if st.lower() in ('connected','available'):
                print(p); raise SystemExit
"
}

say "PomodoroCage 설치 시작"
CORE_DEVICE_ID="${CORE_DEVICE_ID:-$(pick_core_device_id || true)}"
if [[ -z "$CORE_DEVICE_ID" ]]; then
  err "연결된 iPhone 없음 — USB/무선 연결 후 다시 실행."
  exit 1
fi
ok "기기: $CORE_DEVICE_ID"

VERSION_ARGS=()
if [[ -n "${POMODORO_BUILD_NUMBER:-}" ]]; then
  [[ "$POMODORO_BUILD_NUMBER" =~ ^[0-9]+$ ]] || { err "Invalid build number"; exit 1; }
  VERSION_ARGS=("CURRENT_PROJECT_VERSION=$POMODORO_BUILD_NUMBER")
fi
say "xcodebuild (generic/platform=iOS, Release)"
BUILD_LOG="${TMPDIR:-/tmp}/pomodorocage_build_$(date +%H%M%S).log"
xcodebuild -project PomodoroCage.xcodeproj -scheme PomodoroCage \
  -configuration Release -destination "generic/platform=iOS" \
  -derivedDataPath "$DERIVED" \
  -allowProvisioningUpdates -allowProvisioningDeviceRegistration \
  CODE_SIGNING_ALLOWED=YES "${VERSION_ARGS[@]}" \
  build 2>&1 | tee "$BUILD_LOG" | grep -E "error:|BUILD SUCCEEDED|BUILD FAILED" | tail -10
RC=${PIPESTATUS[0]}
if [[ $RC -ne 0 ]]; then
  err "빌드 실패 — 로그: $BUILD_LOG"
  exit 1
fi
ok "빌드 성공"

[[ -d "$APP" ]] || { err "산출물 없음: $APP"; exit 1; }

# 2026-09-07 사고 재발 방지: project.yml의 dependencies가 비어 있으면
# PomodoroScreenTimeExtension이 조용히 앱 번들에서 빠진 채로 설치까지
# 진행돼버린 적이 있다(자동 시작 감지가 원천 불가능해짐). 확장이 실제로
# 임베드됐고 서명·프로비저닝이 붙어 있는지 여기서 막는다.
EXT_APPEX="$APP/PlugIns/PomodoroScreenTimeExtension.appex"
say "preflight: ScreenTime 확장 임베드 확인"
if [[ ! -d "$EXT_APPEX" ]]; then
  err "PomodoroScreenTimeExtension.appex가 빌드 산출물에 없음 — project.yml의"
  err "PomodoroCage 타깃 dependencies에 embed:true로 걸려 있는지 확인할 것."
  exit 1
fi
for target in "$APP" "$EXT_APPEX"; do
  if ! codesign -dv "$target" >/dev/null 2>&1; then
    err "서명 확인 실패: $target"
    exit 1
  fi
  [[ -f "$target/embedded.mobileprovision" ]] || { err "provisioning profile 없음: $target"; exit 1; }
done
ok "확장 임베드 + 서명 + provisioning 확인됨"

say "설치 (devicectl)"
for attempt in $(seq 1 "$MAX_ATTEMPTS"); do
  if xcrun devicectl device install app --device "$CORE_DEVICE_ID" "$APP" 2>&1; then
    ok "설치 성공 (시도 $attempt)"
    exit 0
  fi
  warn "설치 실패 ($attempt/$MAX_ATTEMPTS) — 기존 앱과 데이터를 보존한 채 재시도"
  sleep 3
done
err "설치 실패 — USB 재연결·기기 잠금 해제 후 다시 실행."
exit 1

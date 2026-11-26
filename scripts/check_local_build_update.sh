#!/bin/bash
# Auto Pomodoro 로컬(개발자용) 빌드가 최신 소스를 반영하고 있는지 확인한다.
# API 호출 0회, git만 사용 — iOS용 tool/phone_update_scan.sh와 같은 판단 로직을
# 이 맥 로컬 Electron 앱에 그대로 재사용한 것. 코드 변경 감지는 git HEAD 커밋
# 해시 비교로 한다(이 프로젝트는 git 저장소이므로 mtime보다 정확·안정적이다).
#
# 상태 파일: .local_build/state.json
#   { "lastBuiltCommit": "<git hash>", "lastBuiltAt": "<ISO8601>",
#     "lastInstalledAt": "<ISO8601>" }
# 이 파일이 없으면 "한 번도 로컬 빌드를 안 한 것"(NEW)으로 취급한다.
#
# 사용법:
#   scripts/check_local_build_update.sh            # 사람이 읽는 한 줄 요약
#   scripts/check_local_build_update.sh --status    # UPDATED / CURRENT / NEW 만 출력 (스크립트용)
#
# 판정:
#   상태 파일 없음                        → NEW      (한 번도 로컬 빌드한 적 없음)
#   git HEAD != state.json.lastBuiltCommit → UPDATED  (빌드 이후 코드가 바뀜)
#   git HEAD == state.json.lastBuiltCommit → CURRENT  (최신, 다시 빌드할 필요 없음)
#
# 주의: git에 커밋되지 않은 변경(작업 중인 파일)은 이 스크립트가 못 잡는다.
# "커밋된 코드 기준"으로 판단한다 — 아직 커밋 전이면 커밋부터 하는 게 원칙.

set -uo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_FILE="$PROJECT_DIR/.local_build/state.json"

MODE="summary"
if [ "${1:-}" = "--status" ]; then
  MODE="status"
fi

cd "$PROJECT_DIR" || exit 1

CURRENT_HEAD="$(git rev-parse HEAD 2>/dev/null)"
if [ -z "$CURRENT_HEAD" ]; then
  echo "ERROR: git 저장소가 아니거나 HEAD를 읽을 수 없음" >&2
  exit 1
fi

if [ ! -f "$STATE_FILE" ]; then
  if [ "$MODE" = "status" ]; then
    echo "NEW"
  else
    echo "NEW — 한 번도 로컬 빌드를 만든 적이 없습니다. (현재 커밋: ${CURRENT_HEAD:0:8})"
  fi
  exit 0
fi

LAST_BUILT_COMMIT="$(python3 -c "import json;print(json.load(open('$STATE_FILE')).get('lastBuiltCommit',''))" 2>/dev/null)"
LAST_BUILT_AT="$(python3 -c "import json;print(json.load(open('$STATE_FILE')).get('lastBuiltAt',''))" 2>/dev/null)"

if [ "$CURRENT_HEAD" = "$LAST_BUILT_COMMIT" ]; then
  if [ "$MODE" = "status" ]; then
    echo "CURRENT"
  else
    echo "CURRENT — 마지막 로컬 빌드($LAST_BUILT_AT, 커밋 ${LAST_BUILT_COMMIT:0:8})가 최신 코드와 같습니다. 다시 빌드할 필요 없음."
  fi
else
  if [ "$MODE" = "status" ]; then
    echo "UPDATED"
  else
    echo "UPDATED — 마지막 로컬 빌드($LAST_BUILT_AT, 커밋 ${LAST_BUILT_COMMIT:0:8}) 이후 코드가 바뀌었습니다(현재 커밋 ${CURRENT_HEAD:0:8}). 재빌드 필요."
  fi
fi

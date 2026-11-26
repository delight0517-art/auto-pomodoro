#!/bin/bash
# One entry point for normal Auto Pomodoro shutdown, data-preserving reinstall,
# and the existing destructive uninstall flow.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_PROCESS_PATTERN='^/Applications/Auto Pomodoro\.app/Contents/MacOS/Auto Pomodoro$'

usage() {
  cat <<'USAGE'
Usage: bin/pomodoro-lifecycle.sh <command>

  shutdown                 Ask Auto Pomodoro to quit normally; keep settings and timers.
  reinstall [--dry-run]    Build and reinstall through the signed updater; keep app data.
  uninstall --delete-data  Remove the installed app and its local settings/history.
  help                     Show this help.

Uninstall is destructive and requires the explicit --delete-data flag.
USAGE
}

command_name="${1:-help}"
case "$command_name" in
  help|-h|--help)
    [ "$#" -le 1 ] || { usage >&2; exit 2; }
    usage
    ;;
  shutdown)
    [ "$#" -eq 1 ] || { usage >&2; exit 2; }
    if ! pgrep -f "$APP_PROCESS_PATTERN" >/dev/null 2>&1; then
      echo "Auto Pomodoro is already stopped."
      exit 0
    fi
    node "$PROJECT_DIR/bin/pomodoroctl.js" app quit
    for _ in $(seq 1 40); do
      pgrep -f "$APP_PROCESS_PATTERN" >/dev/null 2>&1 || {
        echo "Auto Pomodoro shut down normally; app data was retained."
        exit 0
      }
      sleep 0.5
    done
    echo "Auto Pomodoro did not finish normal shutdown within 20 seconds; no force quit was attempted." >&2
    exit 2
    ;;
  reinstall)
    [ "$#" -le 2 ] && { [ "$#" -eq 1 ] || [ "${2:-}" = "--dry-run" ]; } || { usage >&2; exit 2; }
    exec /bin/bash "$PROJECT_DIR/scripts/local_build_update.sh" "${2:-}"
    ;;
  uninstall)
    [ "$#" -eq 2 ] && [ "$2" = "--delete-data" ] || { usage >&2; exit 2; }
    exec node "$PROJECT_DIR/bin/pomodoroctl.js" uninstall --yes
    ;;
  *)
    echo "Unknown lifecycle command: $command_name" >&2
    usage >&2
    exit 2
    ;;
esac

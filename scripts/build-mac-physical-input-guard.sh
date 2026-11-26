#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
swiftc -O -framework ApplicationServices -framework CoreGraphics \
  "$ROOT/main/mac-physical-input-guard.swift" \
  -o "$ROOT/main/mac-physical-input-guard"
chmod 755 "$ROOT/main/mac-physical-input-guard"
# Accessibility consent is scoped to the responsible code identity. Keep the
# helper's designated identifier equal to the host app so its HID event tap
# uses the permission granted to Auto Pomodoro. The app packager replaces this
# ad-hoc signature with the configured distribution signature.
codesign --force --sign - --identifier com.rogan.pomodorocage \
  "$ROOT/main/mac-physical-input-guard"
clang -O2 -framework ApplicationServices -framework CoreGraphics \
  "$ROOT/main/mac-user-presence.c" -o "$ROOT/main/mac-user-presence"
chmod 755 "$ROOT/main/mac-user-presence"

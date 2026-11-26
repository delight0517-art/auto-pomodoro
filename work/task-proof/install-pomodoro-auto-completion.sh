#!/bin/zsh
set -euo pipefail
BUILD='/Users/rogan/appDev/schedule/pomodoro/dist/mac-arm64/Auto Pomodoro.app'
DEST='/Applications/Auto Pomodoro.app'
STAGE='/Applications/.Auto Pomodoro.staging-pomodoro-auto-completion-20261103'
DATA="$HOME/Library/Application Support/Auto Pomodoro"
test -d "$BUILD"
test ! -e "$DEST"
test ! -e "$STAGE"
test ! -e "$DATA"
pgrep -f '^/Applications/Auto Pomodoro.app/Contents/MacOS/Auto Pomodoro$' >/dev/null && exit 12 || true
ditto "$BUILD" "$STAGE"
codesign --verify --deep --strict "$STAGE"
BUILD_HASH=$(/usr/bin/shasum -a 256 "$BUILD/Contents/Resources/app.asar" | /usr/bin/awk '{print $1}')
STAGE_HASH=$(/usr/bin/shasum -a 256 "$STAGE/Contents/Resources/app.asar" | /usr/bin/awk '{print $1}')
test "$BUILD_HASH" = "$STAGE_HASH"
mv "$STAGE" "$DEST"
codesign --verify --deep --strict "$DEST"
/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$DEST/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$DEST/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$DEST/Contents/Info.plist"
printf 'app.asar sha256 %s\n' "$STAGE_HASH"

#!/bin/bash
# Only create a downloadable build when Developer ID signing and notarization pass.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [ "${1:-}" != "--storage-guarded" ]; then
  exec "$HOME/bin/storage-guard" run --task pomodoro-mac-release --peak-gib 3 --target "$ROOT" -- /bin/bash "$ROOT/scripts/package-mac-release.sh" --storage-guarded "$@"
fi
mkdir -p "$ROOT/dist"
RELEASE_LOCK="$ROOT/dist/.mac-release.lock"
/usr/bin/shlock -p "$$" -f "$RELEASE_LOCK" || { echo "Another Mac release is running; retry after it finishes." >&2; exit 1; }
trap '/bin/unlink "$RELEASE_LOCK"' EXIT
source "${APPLE_SIGNING_ENV:-$HOME/appDev/tools/apple-signing.env}"
python3 "$HOME/appDev/tools/check-apple-signing.py"
: "${MAC_DEVELOPER_IDENTITY:?Set MAC_DEVELOPER_IDENTITY to the installed Developer ID Application certificate name}"
: "${NOTARYTOOL_PROFILE:?Set NOTARYTOOL_PROFILE to a stored notarytool keychain profile}"
case "$MAC_DEVELOPER_IDENTITY" in
  "Developer ID Application:"*) SIGNING_QUALIFIER="${MAC_DEVELOPER_IDENTITY#Developer ID Application: }" ;;
  *) echo "Refusing release: identity must be Developer ID Application." >&2; exit 1 ;;
esac
if [[ -n "${CSC_KEYCHAIN:-}" ]]; then
  INSTALLED_IDENTITIES="$(security find-identity -v -p codesigning "$CSC_KEYCHAIN")"
else
  INSTALLED_IDENTITIES="$(security find-identity -v -p codesigning)"
fi
printf '%s\n' "$INSTALLED_IDENTITIES" | grep -Fq "\"$MAC_DEVELOPER_IDENTITY\"" || {
  echo "Refusing release: the requested Developer ID certificate is not installed." >&2
  exit 1
}

cd "$ROOT"
npm run check
npm run build:mac-input-guard
npx electron-builder --mac --dir -c.mac.identity="$SIGNING_QUALIFIER"

APP="$ROOT/dist/mac-arm64/Auto Pomodoro.app"
ZIP="$ROOT/dist/release/Auto-Pomodoro-mac-arm64.zip"
test -d "$APP"
python3 "$HOME/appDev/tools/check-apple-signing.py" "$APP"
mkdir -p "$(dirname "$ZIP")"
rm -f "$ZIP"
ditto -c -k --sequesterRsrc --keepParent "$APP" "$ZIP"
xcrun notarytool submit "$ZIP" --keychain-profile "$NOTARYTOOL_PROFILE" --keychain "$CSC_KEYCHAIN" --wait
xcrun stapler staple "$APP"
xcrun stapler validate "$APP"
spctl --assess --type execute --verbose=2 "$APP"
rm -f "$ZIP"
ditto -c -k --sequesterRsrc --keepParent "$APP" "$ZIP"
echo "Notarized release ready: $ZIP"

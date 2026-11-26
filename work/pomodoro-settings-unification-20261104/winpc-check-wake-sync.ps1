$ErrorActionPreference='Stop'
$repo='C:\Users\delig\Documents\Codex\2026-11-01\new-chat-5\work\ff-full-delta-candidate'
Push-Location $repo
try {
  flutter test --no-pub test/shared_settings_conflict_persistence_test.dart
  if($LASTEXITCODE -ne 0){throw "focused test failed exit=$LASTEXITCODE"}
  git diff --check -- lib/services/settings_service.dart test/shared_settings_conflict_persistence_test.dart
  if($LASTEXITCODE -ne 0){throw "diff check failed exit=$LASTEXITCODE"}
  git status --short -- lib/services/settings_service.dart test/shared_settings_conflict_persistence_test.dart
  git diff --stat -- lib/services/settings_service.dart test/shared_settings_conflict_persistence_test.dart
} finally { Pop-Location }

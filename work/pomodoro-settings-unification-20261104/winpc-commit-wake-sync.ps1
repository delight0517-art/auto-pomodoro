$ErrorActionPreference='Stop';$repo='C:\Users\delig\Documents\Codex\2026-11-01\new-chat-5\work\ff-full-delta-candidate';Push-Location $repo
try {
  git add -- lib/services/settings_service.dart test/shared_settings_conflict_persistence_test.dart
  if($LASTEXITCODE -ne 0){throw 'git add failed'}
  git diff --cached --check
  if($LASTEXITCODE -ne 0){throw 'staged diff check failed'}
  git commit -m "fix(pomodoro): sync wake protection preferences"
  if($LASTEXITCODE -ne 0){throw 'commit failed'}
  Write-Output ('head='+ (git rev-parse HEAD))
  Write-Output ('status='+ (git status --short))
  Write-Output ('files='+ (git show --format= --name-only HEAD))
} finally { Pop-Location }

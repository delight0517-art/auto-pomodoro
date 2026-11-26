$ErrorActionPreference='Stop'
$repo='C:\Users\delig\Documents\Codex\2026-11-01\new-chat-5\work\ff-full-delta-candidate'
Write-Output ('head='+ (git -C $repo rev-parse HEAD)); git -C $repo log -4 --format='%h %s'
Write-Output '--- exact status ---';git -C $repo status --short -- lib/services/settings_service.dart test/shared_settings_conflict_persistence_test.dart .codex/tasks
Write-Output '--- exact staged paths ---';git -C $repo diff --cached --name-only
Write-Output '--- current shared fields ---';git -C $repo diff -- lib/services/settings_service.dart test/shared_settings_conflict_persistence_test.dart
Write-Output '--- Windows active task metadata ---';$f=Join-Path $repo '.codex\tasks\vintage-pomodoro-restore-archived-settings-20261103-01.json'; if(Test-Path $f){$j=Get-Content -Raw -LiteralPath $f|ConvertFrom-Json; 'taskId='+$j.taskId; 'status='+$j.status; 'checkpoint='+$j.checkpoint; 'ownedPaths='+($j.ownedPaths -join ', '); 'lastCheckpoint='+$j.lastCheckpoint.checkpoint}

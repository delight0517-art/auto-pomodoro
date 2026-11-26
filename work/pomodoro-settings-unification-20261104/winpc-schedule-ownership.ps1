$ErrorActionPreference='Stop'
$repo='C:\Users\delig\Documents\Codex\2026-11-01\new-chat-5\work\ff-full-delta-candidate'
git -C $repo status --short -- lib/models/pomodoro_schedule.dart lib/services/pomodoro_schedule_sync_service.dart lib/services/settings_service.dart lib/services/mac_sync_service.dart lib/services/cloud_account_service.dart lib/screens/schedules
Write-Output '--- active task checkpoint ---'
$guard=Join-Path $repo '.codex\tasks\pomodoro-schedule-controls-windows-20261104-01.json'
if(Test-Path $guard){$j=Get-Content -Raw -LiteralPath $guard|ConvertFrom-Json; $j | ConvertTo-Json -Depth 5}

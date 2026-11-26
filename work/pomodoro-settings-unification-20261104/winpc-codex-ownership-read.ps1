$ErrorActionPreference='Stop'
$repo='C:\Users\delig\Documents\Codex\2026-11-01\new-chat-5\work\ff-full-delta-candidate'
$tasks=Join-Path $repo '.codex\tasks'
Write-Output '--- task checkpoint names ---'
Get-ChildItem -LiteralPath $tasks -File -Force | Select-Object -ExpandProperty Name
$boundary=Join-Path $repo '.codex\task-boundary.json'
if(Test-Path $boundary){Write-Output '--- boundary status for settings_service.dart ---';$raw=Get-Content -Raw -LiteralPath $boundary; $raw -split "`n" | Select-String -Pattern 'pomodoro-schedule-controls|settings_service.dart' | ForEach-Object {$_.Line}}

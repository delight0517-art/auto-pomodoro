$ErrorActionPreference='Stop'
$repo='C:\Users\delig\Documents\Codex\2026-11-01\new-chat-5\work\ff-full-delta-candidate'
Write-Output ('head='+(git -C $repo rev-parse HEAD))
git -C $repo status --short -- lib/services/settings_service.dart test/shared_settings_conflict_persistence_test.dart
$task=Join-Path $repo '.codex\tasks\pomodoro-schedule-controls-windows-20261104-01.json'
Write-Output ('taskCheckpointExists='+(Test-Path $task))
$leaseRoot=Join-Path $env:USERPROFILE '.codex\workflow\file-claims'
if(Test-Path $leaseRoot){Get-ChildItem -LiteralPath $leaseRoot -File | Where-Object {$_.Name -match 'pomodoro|schedule-controls'} | Select-Object -ExpandProperty Name}
$proc=Get-CimInstance Win32_Process | Where-Object {$_.Name -eq 'vintage_pomodoro.exe'} | Select-Object -First 1
if($proc){$v=(Get-Item -LiteralPath $proc.ExecutablePath).VersionInfo;Write-Output ('installed='+$v.ProductVersion+';pid='+$proc.ProcessId)}

$ErrorActionPreference = 'Stop'
$repo = 'C:\Users\delig\Documents\Codex\2026-11-01\new-chat-5\work\ff-full-delta-candidate'
Write-Output "repoExists=$([bool](Test-Path $repo))"
if (Test-Path $repo) {
  Write-Output "repo=$repo"
  Write-Output (git -C $repo rev-parse --abbrev-ref HEAD)
  Write-Output (git -C $repo rev-parse HEAD)
  if (Test-Path (Join-Path $repo 'pubspec.yaml')) { Get-Content (Join-Path $repo 'pubspec.yaml') | Select-String '^version:' | ForEach-Object { Write-Output $_.Line } }
  git -C $repo status --short -- lib main scripts test 2>$null | Select-Object -First 60
  Get-ChildItem (Join-Path $repo 'lib') -Filter '*.dart' -Recurse -ErrorAction SilentlyContinue |
    Select-String -Pattern 'settingsUpdatedAt|settingsUpdatedBy|pomodoroLastUsedAt|cloud snapshot|lockSchedule|noLockSchedule|timeOverrides|Bluecloud|BlueCloud' -List |
    Select-Object -First 35 | ForEach-Object { Write-Output ("source=" + $_.Path.Replace($repo + '\','') + ":" + $_.LineNumber + ":" + $_.Line.Trim().Substring(0,[Math]::Min(180,$_.Line.Trim().Length))) }
}
$procs = Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'Vintage|Pomodoro|Auto' -or $_.ExecutablePath -match 'pomodoro|Pomodoro' }
foreach ($p in $procs) { Write-Output ("process=" + $p.ProcessId + ";" + $p.Name + ";" + $p.ExecutablePath) }

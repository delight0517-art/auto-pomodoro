$ErrorActionPreference = 'Stop'
$root = 'C:\Users\delig\Desktop\app dev\timer1'
if (-not (Test-Path $root)) { Write-Output 'PROJECT_MISSING'; exit 2 }
Write-Output '--- VERSION ---'
Get-Content (Join-Path $root 'pubspec.yaml') -TotalCount 18
Write-Output '--- SOURCE MATCHES ---'
Get-ChildItem (Join-Path $root 'lib') -Recurse -Filter '*.dart' -File |
  Where-Object { $_.FullName -notmatch '\\(build|\.dart_tool|\.git)\\' } |
  Select-String -Pattern 'wakeLock|wakeEvent|wakeMorningBreak|RiseSync|risesync-nap-awake|user-confirmed' |
  ForEach-Object { '{0}:{1}: {2}' -f $_.Path, $_.LineNumber, $_.Line.Trim() }
Write-Output '--- GIT STATUS ---'
git -C $root status --short
Write-Output '--- PROCESSES ---'
Get-Process | Where-Object { $_.ProcessName -match 'pomodoro|timer1' } | Select-Object ProcessName, Id

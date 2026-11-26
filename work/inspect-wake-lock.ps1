$ErrorActionPreference = 'Stop'
$repo = 'C:\Users\delig\Desktop\app dev\timer1'
Set-Location $repo
Write-Output '--- AGENTS ---'
if (Test-Path AGENTS.md) { Get-Content AGENTS.md }
Write-Output '--- STATUS ---'
git status --short | Select-Object -First 40
Write-Output '--- WAKE AND LOCK REFERENCES ---'
rg -n "wake|Wake|lockSchedule|scheduledBreakRules|BreakLock|block" lib test -g '*.dart' | Select-Object -First 160

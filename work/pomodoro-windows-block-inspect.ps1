$ErrorActionPreference = 'Stop'
$root = 'C:\Users\delig\Desktop\app dev\timer1'
Write-Output '--- BLOCKING SOURCE INDEX ---'
Get-ChildItem (Join-Path $root 'lib') -Recurse -Filter '*.dart' -File |
  Where-Object { $_.FullName -notmatch '\\(build|\.dart_tool|\.git)\\' } |
  Select-String -Pattern 'Process\.run|Process\.start|terminate|kill|blocked|block(ed|ing)?|exempt|allow(list)?|essential|FamilyActivity|ScreenTime|FocusFilter|applicationTokens|appBlock|selectedApps|packageName|exePath' |
  ForEach-Object { '{0}:{1}: {2}' -f $_.Path, $_.LineNumber, $_.Line.Trim() }
Write-Output '--- WINDOWS APP VERSION ---'
Get-Content (Join-Path $root 'pubspec.yaml') | Select-String '^version:'
Write-Output '--- PROCESS DETAILS ---'
Get-CimInstance Win32_Process -Filter "ProcessId = 24164" | Select-Object ProcessId, ExecutablePath, CommandLine

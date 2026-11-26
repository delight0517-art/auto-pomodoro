$ErrorActionPreference='Stop'
$repo='C:\Users\delig\Documents\Codex\2026-11-01\new-chat-5\work\ff-full-delta-candidate'
Write-Output '--- repository guard locations ---'
Get-ChildItem -LiteralPath $repo -Force | Select-Object -ExpandProperty Name
foreach($rel in @('.codex','.work','.agent','.mcp')){$p=Join-Path $repo $rel;if(Test-Path $p){Write-Output ('--- '+$rel+' ---');Get-ChildItem -LiteralPath $p -Force | Select-Object -ExpandProperty Name}}
foreach($rel in @('.codex\bin\agent-coord.exe','.codex\bin\agent-coord','.codex\bin\app-integration-guard','.codex\bin\body-mod-guard','.codex\tasks\pomodoro-schedule-controls-windows-20261104-01.json')){Write-Output ($rel+'='+(Test-Path (Join-Path $env:USERPROFILE $rel)))}
$flutter=Get-CimInstance Win32_Process | Where-Object {$_.Name -match 'flutter|dart|vintage_pomodoro'} | Select-Object Name,ProcessId,CreationDate
Write-Output ('activeFlutterOrVintageProcesses='+($flutter|ConvertTo-Json -Compress))

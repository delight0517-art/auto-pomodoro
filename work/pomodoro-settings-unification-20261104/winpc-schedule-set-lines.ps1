$ErrorActionPreference='Stop'
$repo='C:\Users\delig\Documents\Codex\2026-11-01\new-chat-5\work\ff-full-delta-candidate'
$p=Join-Path $repo 'lib\models\pomodoro_schedule.dart';$a=Get-Content -LiteralPath $p;for($i=140;$i -lt [Math]::Min(310,$a.Count);$i++){Write-Output ('{0}:{1}' -f ($i+1),$a[$i].Trim())}

$ErrorActionPreference='Stop'
$repo='C:\Users\delig\Documents\Codex\2026-11-01\new-chat-5\work\ff-full-delta-candidate'
foreach($rel in @('lib\models\pomodoro_schedule.dart','lib\services\pomodoro_schedule_sync_service.dart')){$p=Join-Path $repo $rel;if(Test-Path $p){Write-Output ('--- '+$rel+' ---');$a=Get-Content -LiteralPath $p;$n=[Math]::Min(140,$a.Count);for($i=0;$i -lt $n;$i++){Write-Output ('{0}:{1}' -f ($i+1),$a[$i].Trim())}}}

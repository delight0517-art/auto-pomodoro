$ErrorActionPreference='Stop'
$repo='C:\Users\delig\Documents\Codex\2026-11-01\new-chat-5\work\ff-full-delta-candidate'
Write-Output ('head='+(git -C $repo rev-parse HEAD))
$paths=@('lib\services\pomodoro_schedule_sync_service.dart','lib\models\pomodoro_schedule.dart','lib\services\settings_service.dart','lib\services\cloud_account_service.dart')
foreach($rel in $paths){$p=Join-Path $repo $rel;if(Test-Path $p){Write-Output ('--- '+$rel+' ---');$a=Get-Content -LiteralPath $p;for($i=0;$i -lt $a.Count;$i++){if($a[$i] -match 'pomodoro_schedules_v1_json|class PomodoroSchedule|updatedAt|buildSnapshot|applyRemote|schedule|sharedKeys|applySharedSettings'){ $lo=[Math]::Max(0,$i-1);$hi=[Math]::Min($a.Count-1,$i+2);for($j=$lo;$j -le $hi;$j++){Write-Output ('{0}:{1}' -f ($j+1),$a[$j].Trim())}}}}}
$guard=Join-Path $repo '.codex\tasks\pomodoro-schedule-controls-windows-20261104-01.json';if(Test-Path $guard){Write-Output '--- active task checkpoint ownership ---';Get-Content -LiteralPath $guard | Select-Object -First 100}

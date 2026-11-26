$ErrorActionPreference = 'Stop'
$repo='C:\Users\delig\Documents\Codex\2026-11-01\new-chat-5\work\ff-full-delta-candidate'
foreach($relative in @('lib\services\settings_service.dart','lib\services\mac_sync_service.dart')){
$file=Join-Path $repo $relative
if(!(Test-Path $file)){continue}
$lines=Get-Content -LiteralPath $file
foreach($pattern in @('kAutoTimerThresholdMin','auto_timer_threshold_min','kWakeLockCutoffMinute','wake_lock_cutoff_minute')){
$hits=@(); for($i=0;$i -lt $lines.Count;$i++){if($lines[$i].Contains($pattern)){$hits+=$i}}
foreach($i in ($hits | Select-Object -First 3)){Write-Output ('---'+$relative+':'+($i+1)+'---');for($j=[Math]::Max(0,$i-2);$j -lt [Math]::Min($lines.Count,$i+4);$j++){Write-Output (($j+1).ToString()+':'+$lines[$j].Trim().Substring(0,[Math]::Min(150,$lines[$j].Trim().Length)))}}
}
}

$ErrorActionPreference = 'Stop'
$repo = 'C:\Users\delig\Documents\Codex\2026-11-01\new-chat-5\work\ff-full-delta-candidate'
Write-Output ('sourceHead=' + (git -C $repo rev-parse HEAD))
Write-Output ('sourceBranch=' + (git -C $repo branch --show-current))
Write-Output ('sourceDirtyCount=' + @((git -C $repo status --porcelain)).Count)
(Get-Content (Join-Path $repo 'pubspec.yaml') | Select-String '^version:' | Select-Object -First 1).Line | ForEach-Object { Write-Output ('sourceVersion=' + $_.Trim()) }
$settingsService = Join-Path $repo 'lib\services\settings_service.dart'
if (Test-Path $settingsService) {
  $settingsLines = Get-Content -LiteralPath $settingsService
  Write-Output '--- settings key constants ---'
  for ($i=150; $i -lt [Math]::Min($settingsLines.Count,245); $i++) { Write-Output (($i+1).ToString()+':'+$settingsLines[$i].Trim()) }
  for ($i=0; $i -lt $settingsLines.Count; $i++) {
    if ($settingsLines[$i].Contains('static const Map<String, String> sharedKeys')) {
      Write-Output '--- sharedKeys map ---'
      for ($j=$i; $j -lt [Math]::Min($settingsLines.Count,$i+45); $j++) {
        Write-Output (($j+1).ToString()+':'+$settingsLines[$j].Trim())
      }
      break
    }
  }
  foreach ($needle in @('longBreakMin','sessionsUntilLongBreak','pomodoroCommitmentLevel','strictLockMode','wakeLockEnabled','wakeLockMinutes','wakeLockCutoffEnabled','wakeLockCutoffMinute','autoTimerThresholdMin')) {
    $hits = Select-String -LiteralPath $settingsService -Pattern $needle | Select-Object -First 2
    foreach ($hit in $hits) { Write-Output ('settingsKeyRef=' + $hit.LineNumber + ':' + $hit.Line.Trim().Substring(0,[Math]::Min(180,$hit.Line.Trim().Length))) }
  }
  Write-Output '--- snapshot/read/apply implementation ---'
  for ($i=475; $i -lt [Math]::Min($settingsLines.Count,635); $i++) {
    if ($i -ge 475 -and $i -lt 530 -or $i -ge 580 -and $i -lt 635) {
      Write-Output (($i+1).ToString()+':'+$settingsLines[$i].Trim())
    }
  }
}
$testRefs = @(& git -C $repo grep -n -E 'sharedSettingsSnapshot|applySharedSettings|newerSharedSettingStamps' -- test 2>$null)
foreach ($line in ($testRefs | Select-Object -First 20)) { Write-Output ('sharedSettingsTestRef=' + $line) }
$testFile = Join-Path $repo 'test\shared_settings_conflict_persistence_test.dart'
if (Test-Path $testFile) {
  $testLines=Get-Content -LiteralPath $testFile
  foreach ($range in @(@(35,75),@(265,310),@(350,400))) {
    Write-Output ('--- test lines '+$range[0]+'-'+$range[1]+' ---')
    for ($i=$range[0]-1; $i -lt [Math]::Min($testLines.Count,$range[1]); $i++) { Write-Output (($i+1).ToString()+':'+$testLines[$i].Trim()) }
  }
}
$wakeRefs = @(& git -C $repo grep -n -i -E 'wake_lock_enabled|wake_lock_minutes|wakeLockEnabled|wakeLockMinutes|wake_lock_cutoff_enabled|wake_lock_cutoff_minute|wakeLockCutoff' -- lib 2>$null)
foreach ($line in ($wakeRefs | Select-Object -First 25)) { Write-Output ('wakeFeatureRef=' + $line) }
$proc = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'vintage_pomodoro.exe' } | Select-Object -First 1
if ($proc) {
  $v=(Get-Item -LiteralPath $proc.ExecutablePath).VersionInfo
  Write-Output ('installed=' + $v.FileVersion + ';product=' + $v.ProductVersion + ';pid=' + $proc.ProcessId)
}

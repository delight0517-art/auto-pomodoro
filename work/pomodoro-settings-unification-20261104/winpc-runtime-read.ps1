$ErrorActionPreference = 'Stop'
$repo = 'C:\Users\delig\Documents\Codex\2026-11-01\new-chat-5\work\ff-full-delta-candidate'
$paths = @(
  'lib\services\settings_service.dart',
  'lib\services\mac_sync_service.dart',
  'lib\services\cloud_account_service.dart',
  'lib\screens\tabs\settings_tab.dart'
)
foreach ($relative in $paths) {
  $file = Join-Path $repo $relative
  if (Test-Path $file) {
    Write-Output "file=$relative"
    Select-String -Path $file -Pattern 'SharedPreferences|File\(|getApplicationSupportDirectory|settingsUpdatedAt|settingsUpdatedBy|revision|lockSchedule|noLockSchedule|durationOverrideRules|timeOverrides|push.*snapshot|pull.*snapshot|MacTimeOverridesReadOnlyList' |
      Select-Object -First 28 | ForEach-Object { Write-Output ("line=" + $_.LineNumber + ":" + $_.Line.Trim().Substring(0,[Math]::Min(170,$_.Line.Trim().Length))) }
  }
}
$proc = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'vintage_pomodoro.exe' } | Select-Object -First 1
if ($proc) {
  $ver = (Get-Item -LiteralPath $proc.ExecutablePath).VersionInfo
  Write-Output ("installed=" + $ver.FileVersion + ";product=" + $ver.ProductVersion + ";pid=" + $proc.ProcessId)
  Write-Output ("started=" + (Get-Process -Id $proc.ProcessId).StartTime.ToUniversalTime().ToString('o'))
}
$roots = @((Join-Path $env:APPDATA 'VintagePomodoro'),(Join-Path $env:LOCALAPPDATA 'VintagePomodoro'),(Join-Path $env:APPDATA 'vintage_pomodoro'),(Join-Path $env:LOCALAPPDATA 'vintage_pomodoro'))
foreach ($root in $roots) {
  if (Test-Path $root) {
    Write-Output "dataRoot=$root"
    Get-ChildItem $root -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 25 | ForEach-Object { Write-Output ("dataFile=" + $_.FullName.Replace($root,'') + ";bytes=" + $_.Length + ";mtime=" + $_.LastWriteTimeUtc.ToString('o')) }
  }
}

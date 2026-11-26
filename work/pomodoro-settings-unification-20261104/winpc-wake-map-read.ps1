$ErrorActionPreference = 'Stop'
$repo='C:\Users\delig\Documents\Codex\2026-11-01\new-chat-5\work\ff-full-delta-candidate'
foreach ($relative in @('lib\services\settings_service.dart','lib\services\mac_sync_service.dart')) {
 $file=Join-Path $repo $relative
 if (!(Test-Path $file)) { continue }
 Write-Output ('file='+$relative)
 Select-String -LiteralPath $file -Pattern 'wake_lock_enabled|wake_lock_minutes|wakeLockEnabled|wakeLockMinutes|wake_lock_cutoff|sharedSetting|sharedKeys|SharedSetting' |
  Select-Object -First 24 | ForEach-Object { $line=$_.Line.Trim(); Write-Output ('line='+$_.LineNumber+':'+$line.Substring(0,[Math]::Min(180,$line.Length))) }
}

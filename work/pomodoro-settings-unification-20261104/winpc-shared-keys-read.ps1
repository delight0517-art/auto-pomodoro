$ErrorActionPreference = 'Stop'
$file='C:\Users\delig\Documents\Codex\2026-11-01\new-chat-5\work\ff-full-delta-candidate\lib\services\settings_service.dart'
$lines=Get-Content -LiteralPath $file
for($i=417;$i -lt [Math]::Min($lines.Count,448);$i++){ $line=$lines[$i].Trim(); Write-Output ('line='+($i+1)+':'+$line) }

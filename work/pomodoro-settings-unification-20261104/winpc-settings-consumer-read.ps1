$ErrorActionPreference = 'Stop'
$repo = 'C:\Users\delig\Documents\Codex\2026-11-01\new-chat-5\work\ff-full-delta-candidate'
foreach ($relative in @('lib\services\settings_service.dart','lib\services\mac_sync_service.dart')) {
  $file = Join-Path $repo $relative
  if (!(Test-Path $file)) { continue }
  $lines = Get-Content -LiteralPath $file
  foreach ($needle in @('applySharedSettings(', 'Future<void> applyRemoteSharedSettings(', 'final Map<String, Object?> settings')) {
    $indices = @()
    for ($i=0; $i -lt $lines.Count; $i++) { if ($lines[$i].Contains($needle)) { $indices += $i } }
    foreach ($i in $indices | Select-Object -First 2) {
      Write-Output ('--- ' + $relative + ':' + ($i+1) + ' ---')
      for ($j=[Math]::Max(0,$i-4); $j -lt [Math]::Min($lines.Count,$i+55); $j++) {
        $line=$lines[$j].Trim()
        Write-Output ($j+1).ToString() + ':' + $line.Substring(0,[Math]::Min(200,$line.Length))
      }
    }
  }
}

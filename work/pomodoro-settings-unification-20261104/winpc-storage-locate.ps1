$ErrorActionPreference = 'Stop'
$repo = 'C:\Users\delig\Documents\Codex\2026-11-01\new-chat-5\work\ff-full-delta-candidate'
$file = Join-Path $repo 'lib\services\settings_service.dart'
if (Test-Path $file) {
  Write-Output 'source=settings_service.dart'
  $lines = Get-Content -LiteralPath $file
  for ($i=0; $i -lt [Math]::Min($lines.Count,220); $i++) {
    if ($lines[$i] -match 'SharedPreferences|File\(|Database|sqlite|ApplicationSupport|path_provider|settings|load|save|read|write') {
      $line = $lines[$i].Trim()
      Write-Output ('sourceLine=' + ($i+1) + ':' + $line.Substring(0,[Math]::Min(180,$line.Length)))
    }
  }
}
$roots = @((Join-Path $env:APPDATA 'com.vintagepomodoro'),(Join-Path $env:APPDATA 'Vintage Pomodoro'),(Join-Path $env:LOCALAPPDATA 'com.vintagepomodoro'),(Join-Path $env:LOCALAPPDATA 'Vintage Pomodoro'))
foreach ($root in $roots) {
  if (Test-Path $root) {
    Write-Output ('dataRoot=' + $root)
    Get-ChildItem -LiteralPath $root -Force -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 40 | ForEach-Object {
      Write-Output ('file=' + $_.FullName.Replace($root,'') + ';bytes=' + $_.Length + ';mtime=' + $_.LastWriteTimeUtc.ToString('o'))
    }
  }
}

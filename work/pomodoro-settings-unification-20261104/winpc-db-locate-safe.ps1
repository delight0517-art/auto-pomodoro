$ErrorActionPreference = 'Stop'
Write-Output ('appData=' + $env:APPDATA)
Write-Output ('localAppData=' + $env:LOCALAPPDATA)
$roots = @($env:APPDATA,$env:LOCALAPPDATA) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
foreach ($root in $roots) {
  Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match 'vintage|pomodoro' } |
    ForEach-Object {
      Write-Output ('candidateRoot=' + $_.FullName)
      Get-ChildItem -LiteralPath $_.FullName -File -Recurse -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match 'pomodoro.*\.db|\.db$' } |
        Select-Object -First 8 |
        ForEach-Object { Write-Output ('candidateDb=' + $_.FullName + ';bytes=' + $_.Length + ';mtime=' + $_.LastWriteTimeUtc.ToString('o')) }
    }
}

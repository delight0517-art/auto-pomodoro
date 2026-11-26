$ErrorActionPreference = 'Stop'
$dirs = @($env:APPDATA,$env:LOCALAPPDATA) | Where-Object { Test-Path $_ }
foreach ($root in $dirs) {
  Get-ChildItem $root -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'pomodoro|vintage' } | ForEach-Object {
    Write-Output ("appDataDir=" + $_.FullName)
    Get-ChildItem $_.FullName -File -Recurse -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -match 'preferences|settings|state|config' -and $_.Length -lt 5000000 } |
      Select-Object -First 12 | ForEach-Object {
        Write-Output ("candidateFile=" + $_.FullName + ";bytes=" + $_.Length + ";mtime=" + $_.LastWriteTimeUtc.ToString('o'))
        if ($_.Extension -eq '.json') {
          try {
            $obj = Get-Content -Raw -LiteralPath $_.FullName | ConvertFrom-Json
            $keys = @('focusMin','focusMinutes','baseFocusMin','breakMin','breakMinutes','baseBreakMin','longBreakMin','sessionsUntilLongBreak','pomodoroCommitmentLevel','strictLockMode','wakeLockEnabled','wakeLockMinutes','autoMode','lockSchedule','noLockSchedule','durationOverrideRules','timeOverrides','settingsUpdatedAt','settingsUpdatedBy','revision')
            foreach ($k in $keys) {
              $prop = $obj.PSObject.Properties[$k]
              if ($prop) {
                $v = $prop.Value
                if ($v -is [System.Array]) { Write-Output ("setting=" + $k + ";count=" + $v.Count) }
                elseif ($v -is [System.Collections.IDictionary]) { Write-Output ("setting=" + $k + ";keys=" + (($v.Keys | Sort-Object) -join ',')) }
                else { Write-Output ("setting=" + $k + ";value=" + [string]$v) }
              }
            }
          } catch { Write-Output 'jsonRead=not-json' }
        }
      }
  }
}

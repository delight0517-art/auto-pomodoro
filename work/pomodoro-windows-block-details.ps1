$ErrorActionPreference = 'Stop'
$root = 'C:\Users\delig\Desktop\app dev\timer1'
Write-Output '--- SERVICE FILES ---'
Get-ChildItem (Join-Path $root 'lib/services') -File | Select-Object -ExpandProperty Name
foreach ($file in @('lib/services/keyboard_block_service.dart','lib/services/settings_service.dart','lib/services/timer_engine.dart','lib/screens/tabs/settings_tab.dart','lib/services/call_exemption_service.dart')) {
  $path = Join-Path $root $file
  if (-not (Test-Path $path)) { continue }
  Write-Output ('--- ' + $file + ' ---')
  Select-String -Path $path -Pattern '^class |^enum |static const|static final|SharedPreferences|packageInfo|windowTitle|foreground|Process\.|GetForegroundWindow|block(ed|ing)?(Apps|Apps|List)?|application|exempt|whitelist|allowlist|lockComputer|strictLock|breakMin|wake' -Context 1,1 |
    Select-Object -First 90 |
    ForEach-Object { '{0}: {1}' -f $_.LineNumber, $_.Line.Trim() }
}

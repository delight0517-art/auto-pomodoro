$ErrorActionPreference = 'Stop'
$db = Join-Path $env:APPDATA 'Vintage Pomodoro\vintage_pomodoro.db'
$source = 'C:\Users\delig\Documents\Codex\2026-11-01\new-chat-5\work\ff-full-delta-candidate\lib\services\settings_service.dart'
if (Test-Path $source) {
  Write-Output 'settingsServiceRelevantLines:'
  $lines = Get-Content -LiteralPath $source
  for ($i=0; $i -lt [Math]::Min($lines.Count,200); $i++) {
    if ($lines[$i] -match 'static const|CREATE TABLE|SELECT|INSERT|UPDATE|settings|updated_at|shared_settings|load\(|save\(') {
      $line = $lines[$i].Trim()
      Write-Output ('sourceLine=' + ($i+1) + ':' + $line.Substring(0,[Math]::Min(180,$line.Length)))
    }
  }
}
foreach ($name in @('py','python','python3','sqlite3')) {
  $cmd = Get-Command $name -ErrorAction SilentlyContinue
  if ($cmd) { Write-Output ('command=' + $name + ';path=' + $cmd.Source) }
}
if (Get-Command py -ErrorAction SilentlyContinue) {
  py -3 -c "import sqlite3,sys; print('python=' + sys.version.split()[0])" 2>$null
  if ($LASTEXITCODE -eq 0) {
    py -3 -c 'import sqlite3,os; p=os.path.join(os.environ["APPDATA"],"Vintage Pomodoro","vintage_pomodoro.db"); c=sqlite3.connect("file:"+p+"?mode=ro",uri=True); names=[r[0] for r in c.execute("select name from sqlite_master where type=?",("table",))]; print("tables="+",".join(names)); [print("columns="+n+":"+",".join(x[1] for x in c.execute("pragma table_info("+n+")"))) for n in names]; c.close()' 2>$null
  }
}

$ErrorActionPreference = 'Stop'
$python = @'
import os, sqlite3
from pathlib import Path
p = Path(os.environ['APPDATA']) / 'Vintage Pomodoro' / 'Vintage Pomodoro' / 'vintage_pomodoro.db'
print('dbExists=' + str(p.exists()).lower())
if not p.exists(): raise SystemExit(2)
uri = p.resolve().as_uri() + '?mode=ro'
c = sqlite3.connect(uri, uri=True, timeout=2)
c.execute('PRAGMA query_only=ON')
names = [r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
print('tables=' + ','.join(names))
for name in names:
    safe = name.replace('"', '""')
    columns = [r[1] for r in c.execute('PRAGMA table_info("' + safe + '")')]
    print('columns=' + name + ':' + ','.join(columns))
    if name.lower() in ('settings', 'app_settings', 'kv_store') and {'key','value'} <= set(columns):
        keys = [r[0] for r in c.execute('SELECT "key" FROM "' + safe + '" ORDER BY "key"')]
        selected = [k for k in keys if any(x in str(k).lower() for x in ('focus','break','schedule','duration','updatedat','updatedby','lock','override'))]
        print('sharedSettingKeys=' + ','.join(map(str, selected)))
c.close()
'@
$encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($python))
py -3 -c "import base64;exec(base64.b64decode('$encoded'))"
if ($LASTEXITCODE -ne 0) { throw 'read-only SQLite inspection failed' }

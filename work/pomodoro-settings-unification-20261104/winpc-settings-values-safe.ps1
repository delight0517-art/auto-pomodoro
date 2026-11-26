$ErrorActionPreference = 'Stop'
$python = @'
import os, sqlite3, hashlib, json
from pathlib import Path
p=Path(os.environ['APPDATA'])/'Vintage Pomodoro'/'Vintage Pomodoro'/'vintage_pomodoro.db'
c=sqlite3.connect(p.resolve().as_uri()+'?mode=ro',uri=True,timeout=2)
c.execute('PRAGMA query_only=ON')
keys=('focus_duration_sec','break_duration_sec','wake_lock_enabled','wake_lock_minutes','wake_lock_cutoff_enabled','shared_setting_updated_at:focus_duration_sec','shared_setting_updated_at:break_duration_sec','scheduled_break_rules_updated_at','duration_override_rules_updated_at','scheduled_break_rules_json','duration_override_rules_json','mac_time_overrides_json','pomodoro_schedules_v1_json.rogan2534')
rows=dict(c.execute('SELECT key,value FROM settings WHERE key IN ('+','.join('?' for _ in keys)+')',keys))
for key in keys[:9]:
 if key in rows: print(key+'='+str(rows[key]))
for key in keys[9:]:
 if key not in rows: continue
 raw=rows[key]
 try:
  obj=json.loads(raw); shape=type(obj).__name__
  items=obj if isinstance(obj,list) else next((obj.get(k) for k in ('rules','slots','entries') if isinstance(obj.get(k),list)),[]) if isinstance(obj,dict) else []
  count=len(items) if isinstance(items,(list,dict)) else -1
 except Exception:
  obj=None; items=[]; shape='non-json'; count=-1
 print(key+'_summary='+json.dumps({'shape':shape,'count':count,'sha256':hashlib.sha256(str(raw).encode()).hexdigest()},separators=(',',':')))
 if key in ('scheduled_break_rules_json','duration_override_rules_json'):
  for row in items:
   if not isinstance(row,dict): continue
   start=row.get('startMin',row.get('startMinute')); end=row.get('endMin')
   if end is None and start is not None and row.get('durationMin') is not None: end=(start+row['durationMin'])%1440
   print(key+'_rule='+json.dumps({'id':row.get('id'),'start':start,'end':end,'days':len(row.get('days',[])) if isinstance(row.get('days'),list) else None,'enabled':row.get('enabled'),'source':row.get('source')},separators=(',',':')))
c.close()
'@
$encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($python))
py -3 -c "import base64;exec(base64.b64decode('$encoded'))"
if ($LASTEXITCODE -ne 0) { throw 'read-only settings value inspection failed' }

$ErrorActionPreference='Stop';$repo='C:\Users\delig\Documents\Codex\2026-11-01\new-chat-5\work\ff-full-delta-candidate'
foreach($pattern in @('PomodoroScheduleSyncService','pomodoroSchedules','kPomodoroSchedulesJson','agent schedule')){Write-Output ('--- '+$pattern+' ---');git -C $repo grep -n -i -E $pattern -- lib test | Select-Object -First 24}

$ErrorActionPreference='Stop';$repo='C:\Users\delig\Documents\Codex\2026-11-01\new-chat-5\work\ff-full-delta-candidate'
foreach($pattern in @('durationOverrideRules','scheduledBreakRules','noLockSchedule','pomodoro_schedules_v1_json','mac_time_overrides_json')){
  Write-Output ('--- '+$pattern+' ---')
  git -C $repo grep -n -i -E $pattern -- lib/services lib/models lib/screens 2>$null | Select-Object -First 18
}

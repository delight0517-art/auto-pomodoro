$ErrorActionPreference='Stop';$repo='C:\Users\delig\Documents\Codex\2026-11-01\new-chat-5\work\ff-full-delta-candidate'
Write-Output '--- staged status ---';git -C $repo status --short
Write-Output '--- current task checkpoints ---';Get-ChildItem (Join-Path $repo '.codex\tasks') -Filter '*pomodoro*' | ForEach-Object { Write-Output ('FILE '+$_.Name); Get-Content -Raw -LiteralPath $_.FullName }
Write-Output '--- conflicting checkpoint ---';$f=Join-Path $repo '.codex\tasks\vintage-pomodoro-restore-archived-settings-20261103-01.json';if(Test-Path $f){Get-Content -Raw -LiteralPath $f}else{Write-Output 'not found'}
Write-Output '--- related guard docs ---';git -C $repo grep -n -i -E 'Body Mod Guard|task baseline|baseline refresh' -- .codex scripts 2>$null | Select-Object -First 30

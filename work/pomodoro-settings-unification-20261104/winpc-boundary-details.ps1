$ErrorActionPreference='Stop'
$repo='C:\Users\delig\Documents\Codex\2026-11-01\new-chat-5\work\ff-full-delta-candidate'
$tasks=Join-Path $repo '.codex\tasks'
Write-Output ('taskFileCount='+(Get-ChildItem -LiteralPath $tasks -File -Force | Measure-Object).Count)
$boundary=Join-Path $repo '.codex\task-boundary.json'
if(Test-Path $boundary){Write-Output ('boundaryBytes='+(Get-Item -LiteralPath $boundary).Length); Get-Content -LiteralPath $boundary}
Write-Output '--- guard-related scripts ---'
Get-ChildItem -LiteralPath (Join-Path $repo 'scripts') -File -Recurse | Where-Object {$_.Name -match 'guard|task|body'} | Select-Object -ExpandProperty FullName

$ErrorActionPreference='Stop'
$queue=& codex queue --help 2>&1 | Out-String
$resume=& codex resume --help 2>&1 | Out-String
@{queue=$queue.Substring(0,[Math]::Min(5000,$queue.Length));resume=$resume.Substring(0,[Math]::Min(5000,$resume.Length))}|ConvertTo-Json -Compress

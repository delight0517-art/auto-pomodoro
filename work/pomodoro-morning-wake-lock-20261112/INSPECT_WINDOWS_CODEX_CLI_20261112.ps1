$ErrorActionPreference='Stop'
$command=Get-Command codex -ErrorAction SilentlyContinue
if(-not $command){@{found=$false;reason='codex command not found'}|ConvertTo-Json -Compress;exit 0}
$version=& codex --version 2>&1 | Out-String
$help=& codex --help 2>&1 | Out-String
@{found=$true;source=$command.Source;version=$version.Trim();help=$help.Substring(0,[Math]::Min(10000,$help.Length))}|ConvertTo-Json -Compress

$ErrorActionPreference='Stop'
$repo='C:\Users\delig\Documents\Codex\2026-11-01\new-chat-5\work\ff-full-delta-candidate'
$f=Join-Path $repo 'lib\services\settings_service.dart'; $l=Get-Content -LiteralPath $f
foreach($range in @(@(230,250),@(410,465),@(480,530),@(595,630))){Write-Output ('--- settings '+$range[0]+'-'+$range[1]+' ---'); for($i=$range[0]-1;$i -lt [Math]::Min($l.Count,$range[1]);$i++){Write-Output (($i+1).ToString()+':'+$l[$i])}}
$t=Join-Path $repo 'test\shared_settings_conflict_persistence_test.dart';$l=Get-Content -LiteralPath $t
foreach($range in @(@(1,40),@(265,305))){Write-Output ('--- test '+$range[0]+'-'+$range[1]+' ---');for($i=$range[0]-1;$i -lt [Math]::Min($l.Count,$range[1]);$i++){Write-Output (($i+1).ToString()+':'+$l[$i])}}

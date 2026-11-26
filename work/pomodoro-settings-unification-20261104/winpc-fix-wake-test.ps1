$ErrorActionPreference='Stop'
$repo='C:\Users\delig\Documents\Codex\2026-11-01\new-chat-5\work\ff-full-delta-candidate'
$settings=Join-Path $repo 'lib\services\settings_service.dart';$test=Join-Path $repo 'test\shared_settings_conflict_persistence_test.dart';$utf8=New-Object System.Text.UTF8Encoding($false)
$s=[IO.File]::ReadAllText($settings); if(([regex]::Matches($s,[regex]::Escape("kWakeLockEnabled: 'wake_lock_enabled'"))).Count -ne 1 -or ([regex]::Matches($s,[regex]::Escape('    kWakeLockEnabled,') )).Count -ne 1){throw 'Wake shared map incomplete or duplicated'}
$t=[IO.File]::ReadAllText($test);$nl=if($t.Contains("`r`n")){"`r`n"}else{"`n"}
$start=$t.IndexOf("    'contract-v4 snapshot seeds per-key clocks")
$end=$t.IndexOf("    'different-key concurrent edits keep local field and apply remote field")
if($start -lt 0 -or $end -le $start){throw 'Scoped test case not found'}
$prefix=$t.Substring(0,$start);$block=$t.Substring($start,$end-$start);$suffix=$t.Substring($end)
function Replace-Once([string]$Text,[string]$Old,[string]$New,[string]$Name){$count=([regex]::Matches($Text,[regex]::Escape($Old))).Count;if($count -ne 1){throw "Expected one $Name anchor, found $count"};return $Text.Replace($Old,$New)}
$block=Replace-Once $block "      await repository.setSetting(SettingsService.kFocusDurationSec, '3600');$nl      await repository.setSetting(SettingsService.kThemeMode, 'dark');" "      await repository.setSetting(SettingsService.kFocusDurationSec, '3600');$nl      await repository.setSetting(SettingsService.kWakeLockEnabled, '1');$nl      await repository.setSetting(SettingsService.kWakeLockMinutes, '120');$nl      await repository.setSetting(SettingsService.kThemeMode, 'dark');" 'test setup'
$block=Replace-Once $block "      expect(snapshot['focus_duration_sec'], 3600);$nl      expect(snapshot['theme_mode'], 'dark');$nl      expect(stamps['focus_duration_sec'], greaterThan(0));" "      expect(snapshot['focus_duration_sec'], 3600);$nl      expect(snapshot['wake_lock_enabled'], isTrue);$nl      expect(snapshot['wake_lock_minutes'], 120);$nl      expect(snapshot['theme_mode'], 'dark');$nl      expect(stamps['focus_duration_sec'], greaterThan(0));$nl      expect(stamps['wake_lock_enabled'], greaterThan(0));$nl      expect(stamps['wake_lock_minutes'], greaterThan(0));" 'test snapshot'
$old="      expect(snapshot, isNot(contains(SettingsService.kWidgetX)));$nl    },"
$new="      expect(snapshot, isNot(contains(SettingsService.kWidgetX)));$nl$nl      await settings.applySharedSettings(<String, Object?>{$nl        'contractVersion': 4,$nl        'updatedAt': 2000000000000,$nl        'updatedAtByKey': <String, int>{$nl          'wake_lock_enabled': 2000000000000,$nl          'wake_lock_minutes': 2000000000000,$nl        },$nl        'wake_lock_enabled': false,$nl        'wake_lock_minutes': 45,$nl      });$nl      expect(await settings.getBool(SettingsService.kWakeLockEnabled, true), isFalse);$nl      expect(await settings.getInt(SettingsService.kWakeLockMinutes, 0), 45);$nl    },"
$block=Replace-Once $block $old $new 'test remote apply'
[IO.File]::WriteAllText($test,$prefix+$block+$suffix,$utf8)
Write-Output ('settings_sha256='+ (Get-FileHash -Algorithm SHA256 -LiteralPath $settings).Hash.ToLower())
Write-Output ('test_sha256='+ (Get-FileHash -Algorithm SHA256 -LiteralPath $test).Hash.ToLower())

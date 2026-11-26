#!/usr/bin/env python3
"""Limit generated installer rollback bundles; never touch source or app data."""
import argparse
import json
import re
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKUP_NAME = re.compile(r"Auto Pomodoro\.(?:previous\.(\d+)|rollback-prior-(\d{8}))\.app")


def old_backups(directory, keep=1):
    bundles = []
    for path in directory.iterdir():
        match = BACKUP_NAME.fullmatch(path.name)
        if match and path.is_dir() and not path.is_symlink():
            bundles.append((int(match[1] or match[2]), path))
    return [path for _, path in sorted(bundles, reverse=True)[keep:]]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["check", "prune"])
    args = parser.parse_args()
    if args.action == "check":
        subprocess.run([str(Path.home() / 'bin/storage-guard'), 'preflight',
                        '--task', 'pomodoro-mac-preflight', '--peak-gib', '3',
                        '--target', str(ROOT)], check=True)
        return

    installed = "/Applications/Auto Pomodoro.app"
    subprocess.run(["codesign", "--verify", "--deep", "--strict", installed], check=True)
    subprocess.run([str(Path.home() / ".codex/bin/workflow-control"), "verify-mac", installed], check=True)
    directory = ROOT / ".local_build"
    if not directory.exists() or directory.is_symlink():
        return
    immediate_rollback = directory / "Auto Pomodoro.previous.app"
    has_immediate_rollback = immediate_rollback.is_dir() and not immediate_rollback.is_symlink()
    report = {
        "retained_rollback": immediate_rollback.name if has_immediate_rollback else None,
        "retained_timestamped_backups": 0 if has_immediate_rollback else 1,
        "removed": [],
        "skipped": [],
    }
    for path in old_backups(directory, keep=0 if has_immediate_rollback else 1):
        opened = subprocess.run(["/usr/sbin/lsof", "-t", "+D", str(path)],
                                capture_output=True, text=True)
        if opened.returncode != 1 or opened.stdout.strip():
            report["skipped"].append(path.name)
            continue
        shutil.rmtree(path)
        report["removed"].append(path.name)
    (directory / "storage-cleanup.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report))


if __name__ == "__main__":
    main()

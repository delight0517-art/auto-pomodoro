# Windows start — final-seventh stop protection

On the next Windows Codex task start, read the current `MOASIS_FEATURE_INBOX.json` entry for `pomodoro-final-seventh-windows-stop-guard-20261105`, then read the linked contract and this start file.

Inspect the canonical Windows Pomodoro checkout, branch/revision, dirty paths, active task leases, running timer/process, and installed version before editing. `lib/utils/forced_lock_ring_style.dart` already carries the recorded v3 ring color; find every timer mutation entrypoint and implement the shared manual-action guard from the contract. Preserve active user state and Windows-only changes. Use a narrow production-path regression test first. Build a separate candidate; installation and visible/runtime validation are separate gates.

Return a receiver receipt with the exact Windows source path, base revision, changed files and hashes, focused test/analyzer/build results, installed version if installation is safe and authorized, and the observed timer/ring/action behavior. If the same source is actively owned or the timer cannot be safely preserved, record that blocker and leave the user's source/runtime untouched. Do not claim `APPLIED` or `VERIFIED` from a queued task, Drive read, test alone, or build alone.

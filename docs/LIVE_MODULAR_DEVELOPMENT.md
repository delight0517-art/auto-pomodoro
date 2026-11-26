# Auto Pomodoro live development and modular evolution

This document adapts the [Windows App Evolution Standard](https://github.com/delight0517/windows-app-evolution-standard) to Auto Pomodoro's Electron source. It is a source-development contract; it does not download or execute code from Google Drive, and it does not turn the installed production app into a hot-reload runtime.

## Current source boundaries

- `main/main.js` is the Electron process and still owns substantial orchestration. Focus, schedule, sync, cloud, lock, wake, AI and policy helpers imported by it are catalogued in `evolution/module-manifest.json`.
- The renderer has five separately loaded surfaces: dashboard, break, widget, compact widget and agent-return. Their HTML, JavaScript and CSS are listed in that manifest. Shared widget appearance is centralized in `renderer/shared/widgetSkins.js`.
- This inventory is not a dynamic plugin loader. Feature extraction happens one behavior slice at a time, retaining existing APIs and persisted settings. Do not label a catalog entry a replaceable plugin until its lifecycle and callers are actually isolated.
- `evolution/module-manifest.json` maps the same feature genres used by the Windows Drive catalog—timer/session, planning, AI, protection, sync, activity, presentation, settings, diagnostics, and shell/platform—to the Mac source boundaries and their actual reload class. A module may be independently owned in source while still requiring a development-app restart at runtime.

## Mac source hot reload

Run `npm run dev:hmr` from the canonical checkout. The launcher is Mac-only, refuses to start when Auto Pomodoro is already running, and delegates to `scripts/start-verified-electron.js`. It sets `AUTO_POMODORO_HMR=1` and `AUTO_POMODORO_DEV_PROFILE=1`; the watcher remains off in ordinary and installed app launches. Before any persistent store loads, the development app uses `~/Library/Application Support/Auto Pomodoro Dev`, a distinct app name and separate single-instance test profile. Dev does not register the production `autopomodoro://` handler, login item, watchdog, shared usage monitor, physical-input guard, machine-wide shortcut, or keep-awake assertion. The installed process and its data stay separate. The launcher refuses concurrent execution while the installed app is running.

- CSS changes update the matching stylesheet.
- HTML or renderer JavaScript changes reload only windows that use the changed resource.
- Font and image changes reload a renderer only when it references that asset.
- Dirty forms or a focused editable field defer reload until it is safe to apply.
- Main-process JavaScript changes require a normal safe restart. Native dependency and persistence-schema changes require rebuild and restart.

The Dev profile owns its own timer and settings state. Renderer edits can apply in that Dev process. Main-process edits require a normal restart of the Dev app; its separate persisted state is recovered by the existing timer deadline logic. Do not restart the installed app or alter its active focus session to satisfy a source watcher.

## One-owner integration rule

1. Make one narrow feature slice in the canonical repository and claim the exact files before editing.
2. Keep unrelated existing changes in place. Do not create a second working version of the same feature, cherry-pick unknown hunks, or bundle another owner's dirty files.
3. Check the slice against the current base, run its focused check, then integrate that slice before starting another overlapping change.
4. Record source revision and hashes in any Drive handoff. Drive records are reviewable proposals, never executable modules; a receiver must validate, apply, and report runtime evidence separately.

The manifest smoke check ensures all direct feature imports from `main/main.js` and every renderer surface stay accounted for. It does not prove that every feature has been extracted, that a live reload succeeded, or that another platform applied the source.

## Acceptance for a future replaceable feature

A feature may be declared reloadable only after its ownership, public interface, dependencies, persistence effects, and cleanup lifecycle are explicit. Candidate application must be based on the canonical source revision, reject stale or unlisted files, preserve timer/settings/drafts and in-flight provider work, and support rollback. Validate the apply and stop-during-apply paths in an isolated harness before enabling automatic reload. Runtime acceptance requires the running process to report the loaded source revision and the affected UI behavior to be observed.

## Platform boundary

This Mac implementation does not modify the Windows application. The Windows repository supplies reusable SOP, templates and a manifest validator, not an app runtime. Cross-platform parity requires a separate Windows-side apply/build/runtime acknowledgement; Drive readback alone is not that acknowledgement.

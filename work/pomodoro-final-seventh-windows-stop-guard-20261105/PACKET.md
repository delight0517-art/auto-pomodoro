# Handoff packet — Windows final-seventh stop guard

- Task key: `pomodoro-final-seventh-windows-stop-guard-20261105`
- Feature: `focus-ring-final-seventh/v3` plus manual timer action protection.
- Source of truth for policy: `CONTRACT.md`; Windows execution steps: `WINDOWS_START.md`.
- Mac canonical checkout at preparation: `/Users/rogan/appDev/schedule/pomodoro`, branch `main`, HEAD `261b6d919a18cb6430c4e6d2d5da056bd2a95d1e`.
- Existing project record: `CROSS_PLATFORM_PARITY.md`, section `2026-11-05 — focus_ring_final_seventh_v3`.
- Existing related backlog item: `61c3c32d7dfb`.

## State at handoff

The Mac source has the v3 final-seventh ring color contract and common manual-action guard. Existing Mac focused source checks are recorded in `CROSS_PLATFORM_PARITY.md`. The same parity record says Windows has the v3 charcoal ring policy and a `0.2.9+159` candidate, while installed Windows was previously read as `0.2.9+158`; the recorded Windows candidate has no proof of the final-seventh stop guard being installed or active.

This Mac task did not edit application source or the running timer. A fresh read-only `ssh winpc` attempt returned `Host is down`; the current Windows source, process, leases, and installed version therefore remain unknown. This handoff contains no source patch because the Windows source is not available here and guessing a patch against another task's staging tree would risk overwriting that owner's work.

## Requested receiver work

Windows Codex should inspect its current canonical checkout and ownership first, then implement the contract in the central timer action path, add a focused regression test, and build a separate candidate. Preserve the active user's timer. Return an ACK and a receiver receipt with source revision/files, test/analyzer/build results, installed version if safely installed, and actual ring/action observations. Keep queued, applied, built, installed, and runtime-verified states distinct.

## Files

- `CONTRACT.md` — shared user-visible behavior and acceptance checks.
- `WINDOWS_START.md` — concise receiver instructions.
- `PACKET.md` — task state and evidence boundaries.
- `MANIFEST.json` — hashes and Drive IDs for the handoff artifacts.

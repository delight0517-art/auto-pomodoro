# Local agent-control transport integration

Task: `pomodoro-agent-transport-integration-20261103`
Canonical source: `/Users/rogan/appDev/schedule/pomodoro` on `main`, based on `bc7e9508b9f93329cab4b281b5478a52264cf276`.

## Contract

- Accept one newline-delimited JSON object per local connection and dispatch it once.
- Count request and response limits as UTF-8 bytes; decode split multibyte input correctly.
- On macOS, serialize cooperating starts with the existing `shlock` PID lease. Reject live endpoints and preserve files, symlinks, unknown leases, and changed endpoint identities. Recover only an owned stale socket after a refused connection while holding the lease.
- Restrict the socket directory and socket permissions to the current user. Expose startup readiness and make stop safe and repeatable.
- Keep the default endpoint unchanged. The client accepts an explicit address only for isolated tests; mutation requests are never automatically retried.

## Source proof

`test/agentControl.test.js` passes 11 focused scenarios: concurrent and legacy live endpoint preservation, regular-file and symlink preservation, symlinked-parent rejection, split UTF-8, byte limits, stale socket recovery, unknown lease preservation, stop-before-ready idempotency, and a client round-trip. `scripts/agent-control-epipe-smoke.js` verifies a client disconnect while dispatch is running. Node syntax checks and `git diff --check` pass.

All socket tests use newly created temporary paths and remove them in `finally`. The installed Auto Pomodoro endpoint was not inspected or contacted. No app process was started, restarted, built, installed, or modified.

## Limits and next integration

This commit integrates the transport producer and focused regression checks only. The full main-process dispatcher, CLI/MCP command allowlist, app startup/resume lifecycle, and native policy consumers remain separate uncommitted work and are not enabled by importing this module. The transport does not authorize commands or guarantee durable exactly-once execution. Windows named-pipe lifecycle/security and runtime parity remain unverified; iOS does not consume this local desktop endpoint. Do not retry a command after timeout or an unknown outcome without a read-only status check.

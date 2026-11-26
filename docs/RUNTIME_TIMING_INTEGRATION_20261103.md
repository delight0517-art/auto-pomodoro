# Main-loop runtime timing source integration

Task `pomodoro-runtime-timing-integration-20261103` under M-Oasis portfolio ownership.
Canonical source: this repository's existing main branch, base `97ad042`.

The accepted source records elapsed milliseconds for exactly three existing
synchronous operations: timer tick, public state creation and state broadcast.
Asynchronous work started by those operations is not timed through completion. The
implementation remains in `main/runtimeDiagnostics.js`; `main/debugLog.js`
provides its optional bridge. The three thin main wrappers preserve the
existing function implementations and return/error behavior. Unrelated
working main edits are outside this accepted change.

Timing samples use the existing app-owned runtime JSONL path, one-minute
sampler, daily byte cap and retention. Unknown labels, negative and
non-finite durations are discarded. Only count, total and maximum are
recorded per label and sample. These are inclusive wall-clock durations;
nested timings overlap and do not establish CPU attribution or improvement.
No request text, account data, file paths or remote upload is added.

Focused checks: `node --test test/runtimeDiagnostics.test.js
test/runtimeTimingWiring.test.js test/debugLogSignalDedup.test.js`.
The first uses temporary runtime files; the second executes the actual
wrappers with controlled callbacks, and the third preserves prior log
deduplication behavior. All temporary fixtures must be removed.

Source integration does not install a new app. Actual installed timings,
resource comparison, complete normal-function acceptance and the separate
due-time schedule candidate remain pending. The due-time feature includes
unintegrated `main/agentSchedules.js` and other main changes; this change
does not mark backlog `7c313a2b8884` complete.

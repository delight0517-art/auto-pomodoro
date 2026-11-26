'use strict';

const assert = require('assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { endpoint, startAgentControl, writeResponse } = require('../main/agentControl');

async function run() {
  if (process.platform === 'darwin') {
    assert.strictEqual(endpoint(), path.join(os.homedir(), 'Library', 'Application Support', 'Auto Pomodoro', 'control.sock'));
  }
  let endCalls = 0;
  writeResponse({ destroyed: true, writableEnded: false, writable: true, end() { endCalls += 1; } }, 'ignored');
  assert.strictEqual(endCalls, 0, 'do not write after a client socket is destroyed');
  writeResponse({ destroyed: false, writableEnded: false, writable: true, end() { const error = new Error('closed'); error.code = 'EPIPE'; throw error; } }, 'ignored');

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-pomodoro-agent-control-'));
  const address = path.join(directory, 'control.sock');
  let dispatchStarted;
  let dispatchFinished;
  const started = new Promise((resolve) => { dispatchStarted = resolve; });
  const finished = new Promise((resolve) => { dispatchFinished = resolve; });
  let stop;
  try {
    stop = startAgentControl(async () => {
      dispatchStarted();
      await new Promise((resolve) => setTimeout(resolve, 80));
      dispatchFinished();
      return { ok: true };
    }, { address });
    await stop.ready;

    assert(fs.existsSync(address), 'isolated control socket should start');

    const client = net.createConnection(address);
    await new Promise((resolve, reject) => {
      client.once('connect', resolve);
      client.once('error', reject);
    });
    client.end(`${JSON.stringify({ action: 'smoke' })}\n`);
    await started;
    client.destroy();
    await finished;
  } finally {
    if (stop) await stop();
    fs.rmSync(directory, { recursive: true, force: true });
  }

  console.log('Agent control tolerates a client disconnect while dispatch is pending.');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

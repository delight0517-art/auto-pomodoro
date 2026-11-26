'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { sendAgentRequest, startAgentControl } = require('../main/agentControl');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fixture(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'apom-control-'));
  const address = path.join(directory, 'control.sock');
  const stops = [];
  const cleanups = [];
  const start = dispatch => { const stop = startAgentControl(dispatch, { address }); stops.push(stop); return stop; };
  try { await run({ directory, address, start, cleanups }); }
  finally {
    for (const stop of stops.reverse()) await stop();
    for (const cleanup of cleanups.reverse()) await cleanup();
    await delay(20);
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
async function ready(stop) { if (stop.ready) await stop.ready; else await delay(20); }
function request(address, bytes, splitAt) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(address);
    socket.setEncoding('utf8');
    socket.setTimeout(1500, () => socket.destroy(new Error('fixture response timeout')));
    let reply = '';
    socket.once('error', reject);
    socket.once('connect', async () => {
      if (splitAt) { socket.write(bytes.subarray(0, splitAt)); await delay(10); socket.write(bytes.subarray(splitAt)); }
      else socket.write(bytes);
    });
    socket.on('data', chunk => {
      reply += chunk;
      if (!reply.includes('\n')) return;
      socket.destroy();
      try { resolve(JSON.parse(reply.slice(0, reply.indexOf('\n')))); } catch (error) { reject(error); }
    });
    socket.once('close', () => { if (!reply.includes('\n')) reject(new Error('fixture closed without response')); });
  });
}
const line = value => Buffer.from(JSON.stringify(value) + '\n');

test('a competing start and its stop preserve the original live endpoint', async () => fixture(async ({ address, start }) => {
  const first = start(async () => ({ owner: 'first' })); await ready(first);
  const identity = fs.lstatSync(address).ino;
  const second = start(async () => ({ owner: 'second' }));
  if (second.ready) await assert.rejects(second.ready, /in use|busy|lease/i); else await ready(second);
  assert.deepEqual(await request(address, line({ type: 'status' })), { owner: 'first' });
  assert.equal(fs.lstatSync(address).ino, identity);
  await second();
  assert.deepEqual(await request(address, line({ type: 'status' })), { owner: 'first' });
}));

test('startup preserves a regular file at the endpoint', async () => fixture(async ({ address, start }) => {
  fs.writeFileSync(address, 'preserve this file');
  const stop = start(async () => ({ ok: true }));
  if (stop.ready) await assert.rejects(stop.ready, /socket|endpoint/i); else await ready(stop);
  assert.equal(fs.lstatSync(address).isFile(), true);
  assert.equal(fs.readFileSync(address, 'utf8'), 'preserve this file');
}));

test('startup preserves a symlink and its target', async () => fixture(async ({ directory, address, start }) => {
  const target = path.join(directory, 'target'); fs.writeFileSync(target, 'keep'); fs.symlinkSync(target, address);
  const stop = start(async () => ({ ok: true }));
  if (stop.ready) await assert.rejects(stop.ready, /socket|endpoint/i); else await ready(stop);
  assert.equal(fs.lstatSync(address).isSymbolicLink(), true);
  assert.equal(fs.readFileSync(target, 'utf8'), 'keep');
}));

test('startup refuses a symlinked socket directory without touching its target', async () => fixture(async ({ directory }) => {
  const real = path.join(directory, 'real'); fs.mkdirSync(real);
  const linked = path.join(directory, 'linked'); fs.symlinkSync(real, linked);
  const address = path.join(linked, 'control.sock');
  const direct = startAgentControl(async () => ({ ok: true }), { address });
  try {
    await assert.rejects(direct.ready, /directory/i);
    assert.equal(fs.existsSync(path.join(real, 'control.sock')), false);
  } finally { await direct(); }
}));

test('split UTF-8 characters arrive unchanged', async () => fixture(async ({ address, start }) => {
  const stop = start(async payload => payload); await ready(stop);
  const payload = { type: 'echo', tag: '한글 집중' }; const bytes = line(payload);
  const splitAt = bytes.indexOf(Buffer.from('한')) + 1;
  assert.deepEqual(await request(address, bytes, splitAt), payload);
}));

test('request limit counts UTF-8 bytes before dispatch', async () => fixture(async ({ address, start }) => {
  let calls = 0; const stop = start(async () => { calls += 1; return { ok: true }; }); await ready(stop);
  const reply = await request(address, line({ type: 'echo', tag: '가'.repeat(22000) }));
  assert.equal(reply.error, 'request_too_large');
  assert.equal(calls, 0);
}));

test('startup recovers only an owned stale socket and applies private permissions', async () => fixture(async ({ address, start }) => {
  const child = spawnSync(process.execPath, ['-e', `const net=require('net'); const s=net.createServer(); s.listen(process.argv[1],()=>process.exit(0));`, address], { timeout: 2000 });
  assert.equal(child.status, 0, child.stderr?.toString());
  assert.equal(fs.lstatSync(address).isSocket(), true);
  const stop = start(async payload => payload); await ready(stop);
  assert.equal(fs.statSync(address).mode & 0o777, 0o600);
  assert.deepEqual(await request(address, line({ type: 'status' })), { type: 'status' });
}));

test('a live legacy endpoint without a lease is preserved', async () => fixture(async ({ address, start, cleanups }) => {
  const legacy = net.createServer(socket => socket.on('data', () => socket.end(`${JSON.stringify({ owner: 'legacy' })}\n`)));
  await new Promise((resolve, reject) => { legacy.once('error', reject); legacy.listen(address, resolve); });
  cleanups.push(() => new Promise(resolve => legacy.close(resolve)));
  const inode = fs.lstatSync(address).ino;
  const competing = start(async () => ({ owner: 'new' }));
  await assert.rejects(competing.ready, /in use/i);
  assert.equal(fs.lstatSync(address).ino, inode);
  assert.deepEqual(await request(address, line({ type: 'status' })), { owner: 'legacy' });
  await competing();
}));

test('unrecognized lease files are preserved and prevent startup', async () => fixture(async ({ address, start }) => {
  const lease = `${address}.pid`;
  fs.writeFileSync(lease, 'not-a-process-id');
  const competing = start(async () => ({ owner: 'new' }));
  await assert.rejects(competing.ready, /unrecognized endpoint lease/i);
  assert.equal(fs.readFileSync(lease, 'utf8'), 'not-a-process-id');
  assert.equal(fs.existsSync(address), false);
  await competing();
}));

test('stop called immediately before startup is safe and idempotent', async () => fixture(async ({ address, start }) => {
  const stop = start(async () => ({ ok: true }));
  const first = stop();
  assert.equal(stop(), first);
  await first;
  await assert.rejects(stop.ready, /stopped before startup/i);
  assert.equal(fs.existsSync(address), false);
}));

test('agent client round-trips through an explicit fixture address', async () => fixture(async ({ address, start }) => {
  const stop = start(async payload => ({ ok: true, received: payload })); await ready(stop);
  assert.deepEqual(await sendAgentRequest({ action: 'status', label: '한글' }, 1000, { address }), {
    ok: true,
    received: { action: 'status', label: '한글' },
  });
}));

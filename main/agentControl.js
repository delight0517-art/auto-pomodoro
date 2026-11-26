'use strict';

const net = require('net');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

function statOrNull(file) {
  try { return fs.lstatSync(file); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function ownedByUser(stat) {
  return typeof process.getuid !== 'function' || stat.uid === process.getuid();
}

function sameFile(a, b) {
  return a && b && a.dev === b.dev && a.ino === b.ino;
}

function acquireEndpointLease(address) {
  if (process.platform !== 'darwin') return () => {};
  const file = `${address}.pid`;
  const existing = statOrNull(file);
  if (existing && (!existing.isFile() || !ownedByUser(existing)
      || !/^\s*[1-9]\d*\s*$/.test(fs.readFileSync(file, 'utf8')))) throw new Error('unrecognized endpoint lease; preserve it');
  const result = spawnSync('/usr/bin/shlock', ['-p', String(process.pid), '-f', file], { timeout: 5000 });
  if (result.error || result.status !== 0) throw new Error('local agent endpoint lease is busy or unavailable');
  const identity = fs.lstatSync(file);
  fs.chmodSync(file, 0o600);
  return () => {
    if (sameFile(statOrNull(file), identity) && fs.readFileSync(file, 'utf8').trim() === String(process.pid)) fs.unlinkSync(file);
  };
}

async function prepareEndpoint(address) {
  if (process.platform === 'win32') return;
  const original = statOrNull(address);
  if (!original) return;
  if (!original.isSocket() || !ownedByUser(original)) throw new Error('existing endpoint is not an owned socket; preserve it');
  if (process.platform !== 'darwin') throw new Error('existing endpoint is in use or needs verified stale recovery');
  const stale = await new Promise((resolve, reject) => {
    const probe = net.createConnection(address);
    const finish = (error, value) => { probe.destroy(); if (error) reject(error); else resolve(value); };
    probe.once('connect', () => finish(null, false));
    probe.once('error', error => finish(['ECONNREFUSED', 'ENOENT'].includes(error.code) ? null : error, true));
    probe.setTimeout(500, () => finish(new Error('endpoint probe timed out; preserve it')));
  });
  if (!stale) throw new Error('local agent endpoint is already in use');
  const current = statOrNull(address);
  if (!current) return;
  if (!sameFile(original, current) || !current.isSocket()) throw new Error('endpoint changed during startup; preserve it');
  fs.unlinkSync(address);
}

function endpoint() {
  if (process.platform === 'win32') {
    const name = String(process.env.USERNAME || 'user').replace(/[^a-z0-9_-]/gi, '_').slice(0, 32);
    return `\\\\.\\pipe\\auto-pomodoro-${name}`;
  }
  const uid = typeof process.getuid === 'function' ? process.getuid() : os.userInfo().username;
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Auto Pomodoro', 'control.sock');
  }
  return path.join('/tmp', `apom-${uid}`, 'control.sock');
}

function writeResponse(socket, payload) {
  if (socket.destroyed || socket.writableEnded || !socket.writable) return;
  try {
    socket.end(payload);
  } catch (error) {
    if (error.code !== 'EPIPE' && error.code !== 'ECONNRESET') throw error;
  }
}

function startAgentControl(dispatch, options = {}) {
  const address = options.address || endpoint();
  let releaseLease = () => {};
  let stopped = false;
  let stopping;
  const server = net.createServer((socket) => {
    socket.on('error', (error) => {
      if (error.code === 'EPIPE' || error.code === 'ECONNRESET') return;
      console.error('[agent-control] client socket error:', error.message);
    });
    socket.setEncoding('utf8');
    socket.setTimeout(10_000);
    let input = '';
    let inputBytes = 0;
    socket.on('data', async (chunk) => {
      inputBytes += Buffer.byteLength(chunk, 'utf8');
      if (inputBytes > MAX_REQUEST_BYTES) {
        socket.removeAllListeners('data');
        writeResponse(socket, `${JSON.stringify({ ok: false, error: 'request_too_large' })}\n`);
        return;
      }
      input += chunk;
      const newline = input.indexOf('\n');
      if (newline < 0) return;
      socket.removeAllListeners('data');
      try {
        const request = JSON.parse(input.slice(0, newline));
        if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('invalid_request');
        const result = await dispatch(request);
        const response = `${JSON.stringify(result)}\n`;
        writeResponse(socket, Buffer.byteLength(response, 'utf8') > MAX_RESPONSE_BYTES
          ? `${JSON.stringify({ ok: false, error: 'response_too_large', outcome: 'unknown' })}\n` : response);
      } catch (error) {
        writeResponse(socket, `${JSON.stringify({ ok: false, error: error?.message || String(error) })}\n`);
      }
    });
    socket.on('timeout', () => socket.destroy());
  });
  server.on('error', (error) => console.error('[agent-control] server error:', error.message));
  const ready = (async () => {
    try {
      if (process.platform !== 'win32') {
        const directory = path.dirname(address);
        fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
        const stat = fs.lstatSync(directory);
        if (!stat.isDirectory() || stat.isSymbolicLink() || !ownedByUser(stat)) throw new Error('local agent socket directory is not owned by this user');
        fs.chmodSync(directory, 0o700);
        releaseLease = acquireEndpointLease(address);
      }
      await prepareEndpoint(address);
      if (stopped) throw new Error('local agent control stopped before startup');
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(address, () => { server.removeListener('error', reject); resolve(); });
      });
      if (process.platform !== 'win32') fs.chmodSync(address, 0o600);
      console.info('[agent-control] local CLI ready');
    } catch (error) {
      if (server.listening) await new Promise(resolve => server.close(resolve));
      releaseLease();
      throw error;
    }
  })();
  // Existing callers can keep the stop callback; new consumers can await readiness.
  ready.catch(error => { if (!stopped) console.error('[agent-control] startup:', error.message); });
  const stop = () => {
    stopped = true;
    if (!stopping) stopping = ready.catch(() => {}).then(async () => {
      if (server.listening) await new Promise(resolve => server.close(resolve));
      releaseLease();
    });
    return stopping;
  };
  stop.ready = ready;
  return stop;
}

function sendAgentRequest(payload, timeoutMs = 5000, options = {}) {
  return new Promise((resolve, reject) => {
    const request = `${JSON.stringify(payload)}\n`;
    if (Buffer.byteLength(request, 'utf8') > MAX_REQUEST_BYTES) throw new Error('request_too_large');
    const socket = net.createConnection(options.address || endpoint());
    socket.setEncoding('utf8');
    let data = '';
    let responseBytes = 0;
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      callback(value);
    };
    const timer = setTimeout(() => socket.destroy(new Error('Auto Pomodoro did not respond in time')), timeoutMs);
    socket.once('connect', () => socket.write(request));
    socket.on('data', (chunk) => {
      responseBytes += Buffer.byteLength(chunk, 'utf8');
      if (responseBytes > MAX_RESPONSE_BYTES) { finish(reject, new Error('response_too_large')); return; }
      data += chunk;
      const newline = data.indexOf('\n');
      if (newline < 0) return;
      socket.end();
      try { finish(resolve, JSON.parse(data.slice(0, newline))); } catch (_) { finish(reject, new Error('App returned invalid JSON')); }
    });
    socket.once('error', (error) => {
      finish(reject, new Error(error.code === 'ENOENT' || error.code === 'ECONNREFUSED'
        ? 'Auto Pomodoro is not running. Start the app, then retry.'
        : error.message));
    });
    socket.once('close', () => {
      if (!settled) finish(reject, new Error('Auto Pomodoro closed the local control connection without a response'));
    });
  });
}

module.exports = { endpoint, sendAgentRequest, startAgentControl, writeResponse };

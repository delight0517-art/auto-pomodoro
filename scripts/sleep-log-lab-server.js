#!/usr/bin/env node
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const port = Number(process.env.SLEEP_LOG_LAB_PORT || 47832);
const files = {'/':'tools/sleep-sandbox/log-lab.html','/log-lab.html':'tools/sleep-sandbox/log-lab.html','/log-lab.js':'tools/sleep-sandbox/log-lab.js','/risesync-log-contract.js':'tools/sleep-sandbox/risesync-log-contract.js'};
const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/risesync-policy.js') {
    return fs.readFile(path.join(root, 'tools/sleep-sandbox/risesync-contract.js'), 'utf8', (error, text) => {
      if (error) { res.writeHead(500); return res.end('RiseSync policy mirror unavailable'); }
      const served = text.replace(/module\.exports\s*=\s*\{INPUTS,activityContextVerdict,napConfidence,evaluateNapEvidence,evaluateScanGate,minuteInWindow\};\s*$/, 'globalThis.RiseSyncPolicy={INPUTS,activityContextVerdict,napConfidence,evaluateNapEvidence,evaluateScanGate,minuteInWindow};');
      if (served === text) { res.writeHead(500); return res.end('Policy export adapter did not match source'); }
      res.writeHead(200, {'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"});
      res.end(req.method === 'HEAD' ? undefined : served);
    });
  }
  const relative = files[pathname];
  if (!relative) { res.writeHead(404); return res.end('Not found'); }
  fs.readFile(path.join(root, relative), (error, data) => {
    if (error) { res.writeHead(404); return res.end('Not found'); }
    const html = path.extname(relative) === '.html';
    res.writeHead(200, {'Content-Type':html?'text/html; charset=utf-8':'text/javascript; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"});
    res.end(req.method === 'HEAD' ? undefined : data);
  });
});
server.listen(port, '127.0.0.1', () => console.log(`RiseSync log lab http://127.0.0.1:${port} · virtual-only · pid=${process.pid}`));
for (const signal of ['SIGTERM','SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));

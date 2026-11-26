'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const main = fs.readFileSync('main/main.js', 'utf8');
const compactHtml = fs.readFileSync('renderer/widget-compact/index.html', 'utf8');
const compactRenderer = fs.readFileSync('renderer/widget-compact/renderer.js', 'utf8');
const compactStyle = fs.readFileSync('renderer/widget-compact/style.css', 'utf8');
const widgetHtml = fs.readFileSync('renderer/widget/index.html', 'utf8');
const widgetRenderer = fs.readFileSync('renderer/widget/renderer.js', 'utf8');
const widgetStyle = fs.readFileSync('renderer/widget/style.css', 'utf8');

assert.match(main, /function restoreAgentBreakOverlay\(event[\s\S]*event\.sender !== agentReturnWindow\?\.webContents && event\.sender !== widgetWindow\?\.webContents[\s\S]*!breakWindowHiddenForAgents[\s\S]*!physicalInputGuardReady \|\| !shouldLockPhysicalInput\(\)[\s\S]*isTemporaryUnlockActive\(\)/,
  'widget restore uses the existing strict-lock and temporary-unlock checks');
assert.match(compactHtml, /id="restoreOverlayBtn"[^>]*aria-label=/, 'compact widget has an accessible restore button');
assert.match(compactRenderer, /restoreOverlayBtn\.addEventListener\('click'[\s\S]*restoreAgentBreakOverlay\(\)/, 'compact widget calls restore IPC');
assert.match(compactStyle, /\.card\.agent-lock-active \.restore-overlay-btn \{ display: inline-grid/, 'restore action remains visible while agent controls are gated');
assert.match(widgetHtml, /id="restoreOverlayBtn"[^>]*aria-label=/, 'classic widget has an accessible restore button');
assert.match(widgetRenderer, /restoreOverlayBtn\.addEventListener\('click'[\s\S]*restoreAgentBreakOverlay\(\)/, 'classic widget calls restore IPC');
assert.match(widgetStyle, /\.widget\.agent-lock-active \.restore-overlay-btn \{ display: inline-grid/, 'classic restore action remains visible while agent controls are gated');

for (const locale of ['ko', 'en', 'ja', 'zh']) {
  const data = JSON.parse(fs.readFileSync(`locales/${locale}.json`, 'utf8'));
  assert.equal(typeof data['widget.restoreBreakOverlay'], 'string', `${locale} restore action is localized`);
}

console.log('PASS widget-break-return-smoke');

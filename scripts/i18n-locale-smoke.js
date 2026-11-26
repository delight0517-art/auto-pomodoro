'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const i18n = require('../main/i18n');

const root = path.join(__dirname, '..');
const localesDir = path.join(root, 'locales');
const catalogs = Object.fromEntries(fs.readdirSync(localesDir)
  .filter((file) => file.endsWith('.json'))
  .map((file) => [path.basename(file, '.json'), JSON.parse(fs.readFileSync(path.join(localesDir, file), 'utf8'))]));
const baseKeys = Object.keys(catalogs[i18n.FALLBACK]).sort();
const placeholders = (value) => [...String(value).matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

for (const [code, catalog] of Object.entries(catalogs)) {
  assert.equal(catalog._meta?.code, code, `${code} filename and locale metadata must match`);
  assert.deepEqual(Object.keys(catalog).sort(), baseKeys, `${code} must have exactly the fallback catalog's keys`);
  for (const key of baseKeys) {
    assert.deepEqual(placeholders(catalog[key]), placeholders(catalogs[i18n.FALLBACK][key]), `${code}.${key} placeholder mismatch`);
  }
}

assert.deepEqual(i18n.available().map(({ code }) => code).sort(), Object.keys(catalogs).sort(), 'runtime and bundled locale lists must match');
for (const [locale, expected] of [['ko-KR', 'ko'], ['en-KR', 'en'], ['ja-JP', 'ja'], ['zh-CN', 'zh'], ['fr-FR', i18n.FALLBACK], ['zh-TW', i18n.FALLBACK]]) {
  assert.equal(i18n.resolveLang('system', locale), expected, `system locale ${locale}`);
}
assert.equal(i18n.resolveLang('ja-JP', 'en-US'), 'ja', 'regional explicit settings normalize to their bundled language');
assert.equal(i18n.normalizeSetting('unsupported-locale'), 'system', 'unsupported persisted values recover to system mode');

const usedKeys = new Set();
function inspectRenderer(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) inspectRenderer(file);
    else if (/\.(html|js)$/.test(entry.name)) {
      const source = fs.readFileSync(file, 'utf8');
      const executableSource = source.split('\n').filter((line) => !/^\s*(?:\/\/|\*|<!--)/.test(line)).join('\n');
      for (const match of executableSource.matchAll(/data-i18n(?:-title|-attr)?="([^"]+)"/g)) {
        const attribute = match[0].startsWith('data-i18n-attr=');
        if (attribute) {
          for (const pair of match[1].split(',')) {
            const separator = pair.indexOf(':');
            assert(separator > 0 && separator < pair.length - 1, `${path.relative(root, file)} has malformed data-i18n-attr: ${pair}`);
            usedKeys.add(pair.slice(separator + 1).trim());
          }
        } else usedKeys.add(match[1].trim());
      }
      for (const match of executableSource.matchAll(/\b(?:T|t)\(\s*['"]([^'"]+)['"]/g)) usedKeys.add(match[1]);
    }
  }
}
inspectRenderer(path.join(root, 'renderer'));
for (const key of usedKeys) {
  for (const [code, catalog] of Object.entries(catalogs)) assert(Object.hasOwn(catalog, key), `${code} is missing used translation key ${key}`);
}


const main = fs.readFileSync(path.join(root, 'main/main.js'), 'utf8');
const snapshotSettings = main.slice(main.indexOf('function applySnapshotSettings('), main.indexOf('\nfunction reconcileCompletedFocusCountForMode'));
assert(snapshotSettings.includes('const previousLanguage = getSettings().language'), 'remote settings must compare the local language');
assert(snapshotSettings.includes('if (mergedSettings.language !== previousLanguage) applyLanguage();'), 'remote language changes must update open windows');
const startup = main.slice(main.indexOf('app.whenReady().then(() => {'));
assert(startup.indexOf('i18n.setLanguage(language, app.getLocale())') < startup.indexOf('createWidgetWindow();'), 'resolve language before creating timer windows');

console.log(`PASS i18n: ${Object.keys(catalogs).length} complete catalogs, ${baseKeys.length} keys, placeholders, UI references, system resolution, remote refresh, and startup ordering`);

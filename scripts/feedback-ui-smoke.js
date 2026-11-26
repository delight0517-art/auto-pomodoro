'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const renderer = fs.readFileSync(path.join(__dirname, '../renderer/dashboard/renderer.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../renderer/dashboard/index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../renderer/dashboard/style.css'), 'utf8');
const marker = renderer.indexOf('// Shared Brainwire feedback inbox:');
const start = renderer.indexOf('(() => {', marker);
const end = renderer.indexOf('\n})();', start) + '\n})();'.length;
assert(marker >= 0 && start > marker && end > start, 'feedback renderer module must exist');
assert.equal((html.match(/id="feedbackOpen"/g) || []).length, 1, 'one visible feedback entry point');
assert(html.includes('id="feedbackOpen" class="header-feedback-button"'), 'feedback icon must be in the top-right header');
assert(html.includes('dash.feedback.pasteHint'), 'feedback dialog explains image paste');
assert(css.includes('max-height: min(60vh, 560px)'), 'feedback image preview is large enough to inspect');

class Element {
  constructor() { this.listeners = {}; this.hidden = false; this.disabled = false; this.value = ''; this.textContent = ''; this.style = {}; this.children = []; }
  addEventListener(name, handler) { (this.listeners[name] ||= []).push(handler); }
  dispatch(name, event = {}) { return (this.listeners[name] || []).map((handler) => handler(event)); }
  removeAttribute(name) { if (name === 'src') this.src = ''; }
  append(...children) { this.children.push(...children); }
  prepend(...children) { this.children.unshift(...children); }
}
const ids = ['feedbackDialog', 'feedbackForm', 'feedbackQuota', 'feedbackMessage', 'feedbackImageInput',
  'feedbackImagePreview', 'feedbackImageRemove', 'feedbackConsent', 'feedbackSubmit', 'feedbackSubmitStatus',
  'feedbackOpen', 'feedbackClose', 'feedbackKind', 'feedbackIdentity'];
const elements = Object.fromEntries(ids.map((id) => [id, new Element()]));
let submitted;
let nativeClipboardImage = '';
elements.feedbackDialog.open = false;
elements.feedbackDialog.showModal = function showModal() { this.open = true; };
elements.feedbackDialog.close = function close() { this.open = false; };
elements.feedbackKind.value = 'bug';
class FileReader {
  readAsDataURL() { this.result = 'data:image/png;base64,source'; this.onload(); }
}
class Image {
  constructor() { this.width = 640; this.height = 480; }
  set src(value) { this._src = value; this.onload(); }
}
const context = vm.createContext({
  document: {
    addEventListener() {},
    getElementById: (id) => elements[id],
    createElement: (tag) => {
      if (tag === 'canvas') return { width: 0, height: 0, getContext: () => ({ drawImage() {} }), toDataURL: () => 'data:image/jpeg;base64,resized' };
      return new Element();
    },
  },
  window: { addEventListener() {}, api: {
    submitFeedback: async (payload) => { submitted = payload; return { ok: true, id: 'FB-TEST-1' }; },
    getFeedbackQuota: async () => ({ ok: true, isDeveloper: true, unlimited: true }),
    getCloudStatus: async () => ({ loggedIn: true, username: 'delight0517' }),
    readFeedbackClipboardImage: async () => nativeClipboardImage,
  } },
  FileReader, Image,
  T: (key, params = {}) => key === 'dash.feedback.account' ? `${key}:${params.username}` : key,
});
vm.runInContext(renderer.slice(start, end), context);

const flush = () => new Promise((resolve) => setImmediate(resolve));
async function main() {
  elements.feedbackOpen.dispatch('click');
  await flush();
  assert.equal(elements.feedbackDialog.open, true, 'feedback button opens the dialog');
  assert.equal(elements.feedbackIdentity.textContent, 'dash.feedback.account:delight0517', 'signed-in account ID is shown for server-side association');

  let prevented = false;
  elements.feedbackDialog.dispatch('paste', {
    clipboardData: { items: [{ type: 'image/png', getAsFile: () => ({ type: 'image/png', size: 128 }) }] },
    preventDefault() { prevented = true; },
  });
  await flush();
  assert(prevented, 'image paste prevents inserting clipboard text');
  assert.equal(elements.feedbackImagePreview.src, 'data:image/jpeg;base64,resized', 'pasted image uses resized JPEG attachment path');
  assert.equal(elements.feedbackImagePreview.hidden, false);
  assert.equal(elements.feedbackImageRemove.hidden, false);

  nativeClipboardImage = 'bmF0aXZlLWltYWdl';
  elements.feedbackDialog.dispatch('paste', { clipboardData: { items: [], files: [], types: ['Files'] }, preventDefault() {} });
  await flush();
  assert.equal(elements.feedbackImagePreview.src, 'data:image/jpeg;base64,resized', 'native clipboard fallback uses the resized image attachment path');

  let textPastePrevented = false;
  elements.feedbackDialog.dispatch('paste', { clipboardData: { items: [], files: [], types: ['text/plain'] }, preventDefault() { textPastePrevented = true; } });
  assert.equal(textPastePrevented, false, 'plain text clipboard paste stays native and does not query the image fallback');

  prevented = false;
  elements.feedbackDialog.dispatch('paste', {
    clipboardData: { items: [], files: [{ type: 'image/png', size: 128 }] },
    preventDefault() { prevented = true; },
  });
  await flush();
  assert(prevented, 'file-list image paste prevents inserting clipboard text');
  assert.equal(elements.feedbackImagePreview.src, 'data:image/jpeg;base64,resized', 'clipboard files fallback uses the resized JPEG attachment path');

  elements.feedbackMessage.value = 'UI bug';
  elements.feedbackConsent.checked = true;
  elements.feedbackMessage.dispatch('input');
  elements.feedbackConsent.dispatch('change');
  assert.equal(elements.feedbackSubmit.disabled, false, 'consented feedback can be submitted');
  const [submit] = elements.feedbackForm.dispatch('submit', { preventDefault() {} });
  await submit;
  assert.equal(submitted.kind, 'bug');
  assert.equal(submitted.message, 'UI bug');
  assert.equal(submitted.attachedImages[0], 'data:image/jpeg;base64,resized');
  console.log('PASS feedback UI black-box flow: open, paste image, consent, submit');
  console.log('PASS feedback white-box source checks: single visible trigger and shared resized-image path');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

// Exercise the real menu policy: removing Edit also removes native Mac paste.
const mainSource = fs.readFileSync(path.join(__dirname, '../main/main.js'), 'utf8');
const menuPolicy = mainSource.match(/function applyStrictMenuBar\(active\) \{[\s\S]*?\n\}/)[0];
for (const platform of ['darwin', 'win32']) {
  let applied;
  const menuContext = vm.createContext({ process: { platform }, Menu: {
    buildFromTemplate: (template) => template,
    setApplicationMenu: (menu) => { applied = menu; },
  } });
  vm.runInContext(menuPolicy, menuContext);
  menuContext.applyStrictMenuBar(false);
  if (platform === 'darwin') assert.equal(applied[0].role, 'editMenu');
  else assert.equal(applied, null);
  menuContext.applyStrictMenuBar(true);
  assert.equal(applied.length, 0, 'strict breaks retain an empty menu');
  menuContext.applyStrictMenuBar(false);
  if (platform === 'darwin') assert.equal(applied[0].role, 'editMenu', 'paste recovers after break');
}
assert(/const appName = devProfile\?\.appName \|\| 'Auto Pomodoro';\s*app\.setName\(appName\);\s*app\.setAppUserModelId\(appName\);\s*applyStrictMenuBar\(false\);/.test(mainSource), 'startup installs native editing roles for the selected app profile');
console.log('PASS native Mac editing menu at startup and after strict break');

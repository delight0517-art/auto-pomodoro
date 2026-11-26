'use strict';

const fs = require('fs');
const path = require('path');

function classifyChange(file) {
  const extension = path.extname(file).toLowerCase();
  if (extension === '.css') return 'style';
  if (extension === '.html' || extension === '.js') return 'reload';
  if (/\.(woff2?|ttf|otf)$/.test(extension)) return 'font';
  if (/\.(png|jpe?g|gif|svg|webp)$/.test(extension)) return 'asset';
  return null;
}

function buildRendererScript(kind, changedFile) {
  const target = JSON.stringify(path.resolve(changedFile));
  return `(() => {
    const kind = ${JSON.stringify(kind)};
    const target = ${target};
    const localPath = value => {
      try {
        const url = new URL(value, location.href);
        return url.protocol === 'file:' ? decodeURIComponent(url.pathname) : '';
      } catch (_) { return ''; }
    };
    const changed = path => path === target;
    const stylesheetReferences = (sheet, file) => {
      try {
        return Array.from(sheet.cssRules).some(rule => {
          const urls = rule.cssText.match(/url\\(["']?[^)"']+["']?\\)/gi) || [];
          return urls.some(value => {
            const raw = value.replace(/^url\\(["']?/, '').replace(/["']?\\)$/, '');
            return changed(localPath(new URL(raw, sheet.href || location.href).href));
          });
        });
      } catch (_) { return false; }
    };
    const styleLinks = Array.from(document.querySelectorAll('link[rel~="stylesheet"][href]'));
    if (kind === 'style') {
      const matches = styleLinks.filter(link => changed(localPath(link.href)));
      for (const link of matches) {
        const url = new URL(link.href);
        url.searchParams.set('__pomodoro_hmr', String(Date.now()));
        link.href = url.href;
      }
      return matches.length;
    }
    const relevant = kind === 'reload'
      ? changed(localPath(location.href)) || Array.from(document.scripts).some(script => script.src && changed(localPath(script.src))) ||
        performance.getEntriesByType('resource').some(entry => entry.initiatorType === 'script' && changed(localPath(entry.name)))
      : kind === 'font'
        ? styleLinks.some(link => stylesheetReferences(link.sheet, target))
        : kind === 'asset'
          ? Array.from(document.querySelectorAll('[src], [poster], link[rel~="icon"][href]')).some(node =>
              ['src', 'poster', 'href'].some(attribute => node.getAttribute(attribute) && changed(localPath(node[attribute])))
            ) || styleLinks.some(link => stylesheetReferences(link.sheet, target))
          : false;

    if (!window.__pomodoroHmrGuardInstalled) {
      window.__pomodoroHmrGuardInstalled = true;
      const baselines = new WeakMap();
      const fieldBaselines = new WeakMap();
      const valueOf = field => {
        if (field.type === 'file') return Array.from(field.files || []).map(file => [file.name, file.size, file.lastModified].join(':'));
        if (field.type === 'checkbox' || field.type === 'radio') return [field.checked, field.value];
        if (field instanceof HTMLSelectElement && field.multiple) return Array.from(field.selectedOptions, option => option.value);
        if (field.isContentEditable) return field.innerHTML;
        return field.value;
      };
      const nonFormFields = () => Array.from(document.querySelectorAll('input, textarea, select, [contenteditable="true"]'))
        .filter(field => !field.form);
      const snapshot = form => Array.from(form.elements).map(valueOf);
      const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
      const formDirty = form => {
        if (form.__pomodoroHmrSaved) return false;
        if (form.dataset.pomodoroHmrUnknownDirty === 'true') return true;
        const baseline = baselines.get(form);
        return baseline ? !equal(snapshot(form), baseline) : form.dataset.pomodoroHmrDirty === 'true';
      };
      const editable = element => element instanceof HTMLElement && (
        element.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName)
      );
      const applyPending = () => {
        if (!window.__pomodoroHmrReloadPending || editable(document.activeElement)) return;
        if (Array.from(document.forms).some(formDirty)) return;
        if (nonFormFields().some(field => field.dataset.pomodoroHmrUnknownDirty === 'true'
            || field.dataset.pomodoroHmrDirty === 'true')) return;
        window.__pomodoroHmrReloadPending = false;
        location.reload();
      };
      for (const form of document.forms) baselines.set(form, snapshot(form));
      document.addEventListener('focusin', event => {
        const form = event.target.form;
        if (form && !baselines.has(form)) baselines.set(form, snapshot(form));
        if (!form && editable(event.target) && !fieldBaselines.has(event.target)) {
          fieldBaselines.set(event.target, valueOf(event.target));
        }
      }, true);
      for (const eventName of ['input', 'change']) {
        document.addEventListener(eventName, event => {
          const form = event.target.form;
          if (!form) {
            if (!editable(event.target)) return;
            const baseline = fieldBaselines.get(event.target);
            if (baseline === undefined) event.target.dataset.pomodoroHmrUnknownDirty = 'true';
            else event.target.dataset.pomodoroHmrDirty = String(!equal(valueOf(event.target), baseline));
            return;
          }
          form.__pomodoroHmrSaved = false;
          if (!baselines.has(form)) form.dataset.pomodoroHmrUnknownDirty = 'true';
          else form.dataset.pomodoroHmrDirty = String(!equal(snapshot(form), baselines.get(form)));
        }, true);
      }
      document.addEventListener('submit', event => {
        if (event.target instanceof HTMLFormElement) event.target.__pomodoroHmrSubmitting = true;
      }, true);
      document.addEventListener('reset', event => setTimeout(() => {
        baselines.delete(event.target);
        delete event.target.dataset.pomodoroHmrDirty;
        delete event.target.dataset.pomodoroHmrUnknownDirty;
        applyPending();
      }, 0), true);
      document.addEventListener('focusout', () => setTimeout(applyPending, 0), true);
      window.__pomodoroHmrMarkSaved = (fields = nonFormFields()) => {
        for (const field of fields) {
          if (!editable(field)) continue;
          if (field.form) {
            baselines.set(field.form, snapshot(field.form));
            field.form.__pomodoroHmrSaved = true;
            delete field.form.dataset.pomodoroHmrDirty;
            delete field.form.dataset.pomodoroHmrUnknownDirty;
          } else {
            fieldBaselines.set(field, valueOf(field));
            delete field.dataset.pomodoroHmrDirty;
            delete field.dataset.pomodoroHmrUnknownDirty;
          }
        }
        applyPending();
      };
      new MutationObserver(() => {
        for (const form of document.forms) {
          const receipt = form.querySelector('[role="status"]')?.textContent || '';
          if (form.id === 'feedbackForm' && form.__pomodoroHmrSubmitting && receipt.includes('\\n')) {
            baselines.set(form, snapshot(form));
            form.__pomodoroHmrSaved = true;
            form.__pomodoroHmrSubmitting = false;
            delete form.dataset.pomodoroHmrDirty;
            delete form.dataset.pomodoroHmrUnknownDirty;
          }
        }
        applyPending();
      }).observe(document.documentElement, {
        attributes: true, childList: true, characterData: true, subtree: true,
      });
      window.__pomodoroHmrRequestReload = applyPending;
    }
    if (!relevant) return false;
    window.__pomodoroHmrReloadPending = true;
    window.dispatchEvent(new CustomEvent('pomodoro-hmr-pending'));
    window.__pomodoroHmrRequestReload();
    return true;
  })()`;
}

function start() {
  if (process.platform !== 'darwin' || process.env.AUTO_POMODORO_HMR !== '1') return false;
  const { app, BrowserWindow } = require('electron');
  const root = app.getAppPath();
  const rendererRoot = path.join(root, 'renderer');
  const mainRoot = path.join(root, 'main');
  const trackedWindows = new WeakSet();
  const pending = new Map();

  const attachWindow = win => {
    if (trackedWindows.has(win)) return;
    trackedWindows.add(win);
    win.webContents.on('did-finish-load', () => {
      if (!win.isDestroyed()) {
        win.webContents.executeJavaScript(buildRendererScript('init', path.join(rendererRoot, '.hmr-init'))).catch(() => {});
      }
    });
  };
  const onWindowCreated = (_event, win) => attachWindow(win);
  app.on('browser-window-created', onWindowCreated);
  app.whenReady().then(() => {
    for (const win of BrowserWindow.getAllWindows()) attachWindow(win);
    for (const rootDir of [rendererRoot, mainRoot]) {
      try {
        fs.watch(rootDir, { recursive: true }, (_event, filename) => {
          if (!filename) return;
          const absolute = path.resolve(rootDir, String(filename));
          const relative = path.relative(root, absolute);
          if (relative.startsWith('..') || path.isAbsolute(relative) || relative === 'main/devHmr.js') return;
          if (relative.startsWith('main/')) {
            // shortcut: main-process edits only log; automatic restart needs a timer-safe lifecycle hook.
            if (path.extname(relative) === '.js') console.info(`[pomodoro-hmr] Main-process change requires a safe app restart: ${relative}`);
            return;
          }
          const kind = classifyChange(relative);
          if (!kind) return;
          clearTimeout(pending.get(absolute));
          pending.set(absolute, setTimeout(() => {
            pending.delete(absolute);
            for (const win of BrowserWindow.getAllWindows()) {
              if (win.isDestroyed()) continue;
              const script = buildRendererScript(kind, absolute);
              win.webContents.executeJavaScript(script).catch(error => {
                console.warn('[pomodoro-hmr] Renderer update failed:', error.message);
              });
            }
            console.info(`[pomodoro-hmr] ${kind} change applied: ${relative}`);
          }, 80));
        });
      } catch (error) {
        console.warn(`[pomodoro-hmr] Could not watch ${rootDir}: ${error.message}`);
      }
    }
    console.info('[pomodoro-hmr] Watching renderer resources; main-process changes are logged for a safe restart.');
  });
  return true;
}

module.exports = { buildRendererScript, classifyChange, start };

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('main/main.js', 'utf8');
const fn = source.slice(source.indexOf('function updateWidgetOpacity()'), source.indexOf('function broadcast()'));
let opacity = 1, cursor = { x: 0, y: 0 }, settings = {}, calls = 0;
const context = vm.createContext({
  widgetWindow: { isDestroyed: () => false, getBounds: () => ({ x: 10, y: 20, width: 200, height: 88 }), getOpacity: () => opacity, setOpacity(v) { opacity = v; calls++; } },
  screen: { getCursorScreenPoint: () => cursor }, getSettings: () => settings,
});
vm.runInContext(fn, context);
const update = () => vm.runInContext('updateWidgetOpacity()', context);
update(); assert.equal(opacity, 0.2);
cursor = { x: 10, y: 20 }; update(); assert.equal(opacity, 0.92);
update(); assert.equal(calls, 2);
settings = { widgetOpacityHover: 1, widgetOpacityIdle: 0.35 }; update(); assert.equal(opacity, 1);
cursor = { x: 210, y: 50 }; update(); assert.equal(opacity, 0.35);
settings.widgetOpacityIdle = NaN; update(); assert.equal(opacity, 0.2);
settings.widgetOpacityIdle = -1; update(); assert.equal(opacity, 0.1);
context.widgetWindow = null; update();
console.log('native widget opacity: hover/boundaries/settings/defaults/clamp/no duplicate writes passed');

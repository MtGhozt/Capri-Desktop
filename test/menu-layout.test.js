'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
const { QUICK_MENU_ITEMS, SETTINGS_TABS, unionRects } = require('../src/renderer/js/menu.js');

test('quick menu contains only compact controls and settings entry', () => {
  assert.deepEqual(QUICK_MENU_ITEMS.map((item) => item.id), [
    'mic', 'mic-device', 'reply-mode', 'model-provider', 'fixes', 'clip-save', 'behavior', 'drone-mode', 'theme', 'settings', 'quit',
  ]);
});

test('settings tabs cover every non-quick configuration area', () => {
  assert.deepEqual(SETTINGS_TABS.map((tab) => tab.id), [
    'model', 'memory', 'hearing', 'apps', 'bubble', 'music', 'shortcuts', 'behavior',
  ]);
});

test('menu hit rect includes an open floating submenu', () => {
  assert.deepEqual(unionRects(
    { left: 100, top: 100, right: 400, bottom: 500 },
    { left: 410, top: 140, right: 630, bottom: 300 },
  ), { left: 100, top: 100, right: 630, bottom: 500 });
});

test('Capri sits above the message box without blocking its input', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'styles', 'capri.css'), 'utf8');
  assert.match(css, /\.capri\.is-on-box\s*\{[^}]*z-index:\s*5;[^}]*pointer-events:\s*none;/s);
});

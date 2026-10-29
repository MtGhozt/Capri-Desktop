'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
const { menuEscapeStep } = require('../src/renderer/js/menu.js');

test('Esc peels one menu layer at a time', () => {
  assert.equal(menuEscapeStep({ expanded: 'fixes' }), 'collapse-expanded');
  assert.equal(menuEscapeStep({ quickOpen: 'reply-mode' }), 'close-quick-submenu');
  assert.equal(menuEscapeStep({ view: 'apps' }), 'apps-to-main');
  assert.equal(menuEscapeStep({ capturing: true }), 'cancel-capture');
  assert.equal(menuEscapeStep({ settingsMode: true }), 'close-settings');
  assert.equal(menuEscapeStep({}), 'hide');
});

test('expanded submenu wins over settings root close', () => {
  assert.equal(menuEscapeStep({ settingsMode: true, expanded: 'fixes' }), 'collapse-expanded');
  assert.equal(menuEscapeStep({ settingsMode: true, expanded: null }), 'close-settings');
});

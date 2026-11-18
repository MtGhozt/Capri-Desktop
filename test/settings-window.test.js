'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createSettingsWindow } = require('../src/main/settings-window');

test('settings window is created once and focused when opened again', () => {
  const windows = [];
  class FakeWindow {
    constructor() { this.destroyed = false; this.focuses = 0; this.handlers = {}; windows.push(this); }
    isDestroyed() { return this.destroyed; }
    focus() { this.focuses++; }
    on(name, fn) { this.handlers[name] = fn; }
    loadURL(url) { this.url = url; }
  }
  const first = createSettingsWindow({ BrowserWindow: FakeWindow, existing: null, url: 'capri://app/settings.html' });
  const second = createSettingsWindow({ BrowserWindow: FakeWindow, existing: first, url: 'capri://app/settings.html' });
  assert.equal(first, second);
  assert.equal(windows.length, 1);
  assert.equal(first.focuses, 1);
});

test('settings shows Cargando… then light getMenu, then full (Oído does not stall)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', 'settings.js'), 'utf8');
  assert.match(src, /Cargando…/);
  assert.match(src, /appmenu__hint/);
  assert.match(src, /getMenu\(\{ folded: false, light: true \}\)/);
  assert.match(src, /getMenu\(\{ folded: false, light: false \}\)/);
  assert.match(src, /menu\.render\(state\)/);
  const main = require('./main-source');
  assert.match(main, /setImmediate\(\(\) => \{ try \{ voice\?\.listDevices\(\)/);
});

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
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

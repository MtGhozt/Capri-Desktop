'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  createSettingsWindow,
  hideSettingsWindow,
  IDLE_DESTROY_MS,
} = require('../src/main/settings-window');

function fakeTimers() {
  let now = 0;
  const timers = new Map();
  let nextId = 1;
  return {
    setTimeout(fn, ms) {
      const id = nextId++;
      timers.set(id, { fn, at: now + ms });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    tick(ms) {
      now += ms;
      for (const [id, t] of [...timers.entries()].sort((a, b) => a[1].at - b[1].at)) {
        if (t.at > now) continue;
        timers.delete(id);
        t.fn();
      }
    },
  };
}

function fakeBrowserWindow() {
  const windows = [];
  class FakeWindow {
    constructor() {
      this.destroyed = false;
      this.focuses = 0;
      this.visible = false;
      this.handlers = {};
      this.webContents = { isLoading: () => false };
      windows.push(this);
    }
    isDestroyed() { return this.destroyed; }
    isVisible() { return this.visible; }
    focus() { this.focuses++; }
    show() {
      this.visible = true;
      this.handlers.show?.forEach((fn) => fn());
    }
    hide() {
      this.visible = false;
      this.handlers.hide?.forEach((fn) => fn());
    }
    destroy() {
      this.destroyed = true;
      this.visible = false;
      this.handlers.closed?.forEach((fn) => fn());
    }
    on(name, fn) { (this.handlers[name] ||= []).push(fn); }
    once(name, fn) { this.on(name, fn); }
    loadURL(url) { this.url = url; }
  }
  return { FakeWindow, windows };
}

test('settings window is created once and focused when opened again', () => {
  const { FakeWindow, windows } = fakeBrowserWindow();
  const first = createSettingsWindow({ BrowserWindow: FakeWindow, existing: null, url: 'capri://app/settings.html' });
  const second = createSettingsWindow({ BrowserWindow: FakeWindow, existing: first, url: 'capri://app/settings.html' });
  assert.equal(first, second);
  assert.equal(windows.length, 1);
  assert.equal(first.focuses, 1);
});

test('hide → 60s → destroyed', () => {
  const timers = fakeTimers();
  const { FakeWindow, windows } = fakeBrowserWindow();
  const win = createSettingsWindow({
    BrowserWindow: FakeWindow,
    existing: null,
    url: 'capri://app/settings.html',
    hasUnsaved: () => false,
    setTimeoutFn: timers.setTimeout,
    clearTimeoutFn: timers.clearTimeout,
    idleMs: IDLE_DESTROY_MS,
  });
  win.handlers['ready-to-show']?.forEach((fn) => fn());
  hideSettingsWindow(win);
  assert.equal(win.destroyed, false);
  timers.tick(IDLE_DESTROY_MS - 1);
  assert.equal(win.destroyed, false);
  timers.tick(1);
  assert.equal(win.destroyed, true);
  assert.equal(windows.length, 1);
});

test('show before 60s → kept', () => {
  const timers = fakeTimers();
  const { FakeWindow } = fakeBrowserWindow();
  const win = createSettingsWindow({
    BrowserWindow: FakeWindow,
    existing: null,
    url: 'capri://app/settings.html',
    hasUnsaved: () => false,
    setTimeoutFn: timers.setTimeout,
    clearTimeoutFn: timers.clearTimeout,
    idleMs: IDLE_DESTROY_MS,
  });
  win.handlers['ready-to-show']?.forEach((fn) => fn());
  hideSettingsWindow(win);
  timers.tick(30_000);
  createSettingsWindow({
    BrowserWindow: FakeWindow,
    existing: win,
    url: 'capri://app/settings.html',
    hasUnsaved: () => false,
    setTimeoutFn: timers.setTimeout,
    clearTimeoutFn: timers.clearTimeout,
    idleMs: IDLE_DESTROY_MS,
  });
  assert.equal(win.visible, true);
  timers.tick(IDLE_DESTROY_MS);
  assert.equal(win.destroyed, false);
});

test('unsaved edits skip idle destroy', async () => {
  const timers = fakeTimers();
  const { FakeWindow } = fakeBrowserWindow();
  const win = createSettingsWindow({
    BrowserWindow: FakeWindow,
    existing: null,
    url: 'capri://app/settings.html',
    hasUnsaved: async () => true,
    setTimeoutFn: timers.setTimeout,
    clearTimeoutFn: timers.clearTimeout,
    idleMs: IDLE_DESTROY_MS,
  });
  win.handlers['ready-to-show']?.forEach((fn) => fn());
  hideSettingsWindow(win);
  timers.tick(IDLE_DESTROY_MS);
  await Promise.resolve();
  assert.equal(win.destroyed, false);
});

test('settings shows Cargando… then light getMenu, then full (Oído does not stall)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', 'settings.js'), 'utf8');
  assert.match(src, /Cargando…/);
  assert.match(src, /appmenu__hint/);
  assert.match(src, /getMenu\(\{ folded: false, light: true \}\)/);
  assert.match(src, /getMenu\(\{ folded: false, light: false \}\)/);
  assert.match(src, /menu\.render\(state\)/);
  assert.match(src, /capriSettingsHasUnsaved/);
  const main = require('./main-source');
  assert.match(main, /setImmediate\(\(\) => \{ try \{ getVoice\(\)\?\.listDevices\(\)/);
});

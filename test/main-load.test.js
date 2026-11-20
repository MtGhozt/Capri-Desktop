'use strict';

// Load smoke: require main.js with a tiny electron stub. Any top-level ReferenceError / TDZ
// (const used before init in a createX({...}) bag) or missing require fails here immediately.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const MAIN = path.resolve(__dirname, '..', 'src', 'main', 'main.js');

function electronStub() {
  const noop = () => {};
  const app = {
    getPath: (name) => path.join(os.tmpdir(), 'capri-main-load', String(name || 'userData')),
    getVersion: () => '0.0.0-test',
    getLocale: () => 'en',
    getSystemLocale: () => 'en',
    getPreferredSystemLanguages: () => ['en'],
    isPackaged: false,
    requestSingleInstanceLock: () => true,
    whenReady: () => new Promise(() => {}), // never boots the overlay
    on: noop,
    quit: noop,
    exit: noop,
    relaunch: noop,
    setAppUserModelId: noop,
    disableHardwareAcceleration: noop,
    setLoginItemSettings: noop,
    getLoginItemSettings: () => ({ openAtLogin: false }),
    commandLine: { appendSwitch: noop },
  };
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  return {
    app,
    BrowserWindow: function BrowserWindow() {},
    Menu: { buildFromTemplate: () => ({}) },
    Tray: function Tray() {},
    ipcMain: { handle: noop, on: noop },
    screen: {
      getAllDisplays: () => [{ id: 0, bounds: { x: 0, y: 0, width: 800, height: 600 }, workArea: { x: 0, y: 0, width: 800, height: 600 } }],
      getPrimaryDisplay: () => ({ id: 0, bounds: { x: 0, y: 0, width: 800, height: 600 }, workArea: { x: 0, y: 0, width: 800, height: 600 } }),
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
      on: noop,
    },
    protocol: { registerSchemesAsPrivileged: noop, handle: noop },
    net: { fetch: async () => new Response('') },
    shell: { openExternal: noop, openPath: noop, showItemInFolder: noop, writeShortcutLink: () => true },
    globalShortcut: { register: () => false, unregister: noop, unregisterAll: noop },
    powerMonitor: { on: noop },
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    safeStorage: { isEncryptionAvailable: () => false },
    clipboard: { writeText: noop },
    desktopCapturer: { getSources: async () => [] },
    nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
  };
}

test('main.js loads without TDZ or missing requires', () => {
  const orig = Module._load;
  Module._load = function stub(request, parent, ...rest) {
    if (request === 'electron') return electronStub();
    return orig.call(this, request, parent, ...rest);
  };
  // Fresh load every run: drop main and anything it pulled in under src/main.
  for (const key of Object.keys(require.cache)) {
    if (key.replace(/\\/g, '/').includes('/src/main/') || key === MAIN) delete require.cache[key];
  }
  try {
    assert.doesNotThrow(() => require(MAIN));
  } finally {
    Module._load = orig;
    delete require.cache[MAIN];
  }
});

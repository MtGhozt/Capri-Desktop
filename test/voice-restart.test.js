'use strict';

// The voice sidecar dying on its own (a native crash): she says what was playing is over, and
// brings it back a moment later; too many in a row and she stops trying and says so.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

function setup(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-voice-'));
  const dir = path.join(home, 'voice');
  fs.mkdirSync(path.join(dir, '.venv', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.venv', 'bin', 'python'), '');
  fs.writeFileSync(path.join(dir, 'server.py'), '');
  const children = [];
  const spawn = (cmd) => {
    const child = new EventEmitter();
    if (cmd === 'taskkill') return child; // stop() on Windows: not a sidecar
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.pid = 1000 + children.length;
    child.kill = () => child.emit('exit', null);
    children.push(child);
    return child;
  };
  class FakeSocket extends EventEmitter {
    constructor() { super(); this.readyState = 0; }
    addEventListener(name, fn) { this.on(name, fn); }
    send() {}
    close() {}
  }
  const savedWs = globalThis.WebSocket;
  globalThis.WebSocket = FakeSocket;
  t.after(() => { globalThis.WebSocket = savedWs; });

  const load = Module._load;
  Module._load = function stub(request, ...rest) {
    if (request === 'electron') return { app: { getPath: () => home, isPackaged: true } };
    if (request === 'node:child_process') return { spawn };
    return load.call(this, request, ...rest);
  };
  // kept for the whole test: the log asks Electron for its folder when it writes
  t.after(() => {
    Module._load = load;
    delete require.cache[require.resolve('../src/main/voice')];
  });
  for (const name of ['../src/main/voice', '../src/main/log']) delete require.cache[require.resolve(name)];
  const voiceMod = require('../src/main/voice');
  const events = [];
  const voice = voiceMod.createVoice({
    root: home,
    loadConfig: () => ({ voice: { dir } }),
    onEvent: (evt) => events.push(evt),
  });
  return { voice, children, events };
}

test('a crashed sidecar ends what was playing and comes back', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { voice, children, events } = setup(t);
  voice.start();
  assert.equal(children.length, 1);
  children[0].emit('exit', 3221226356); // 0xC0000374
  assert.ok(events.some((e) => e.type === 'talking_done' && e.crashed));
  assert.ok(events.some((e) => e.type === 'stopped' && e.crashed));
  assert.equal(voice.running(), false);
  t.mock.timers.tick(3000);
  assert.equal(children.length, 2, 'started again');
  assert.equal(voice.running(), true);
  voice.stop();
});

test('stopping on purpose is not a crash', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { voice, children, events } = setup(t);
  voice.start();
  voice.stop();
  children[0].emit('exit', 1);
  t.mock.timers.tick(5000);
  assert.equal(children.length, 1);
  assert.ok(!events.some((e) => e.crashed));
});

test('after too many crashes she stops trying and says so', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { voice, children, events } = setup(t);
  voice.start();
  for (let i = 0; i < 4; i += 1) {
    children[children.length - 1].emit('exit', 3221226356);
    t.mock.timers.tick(3000);
  }
  assert.equal(children.length, 4, 'three restarts, then no more');
  const notice = events.find((e) => e.type === 'notice' && /se cayó 4 veces/.test(e.message));
  assert.ok(notice, 'she says it in Spanish');
  voice.stop();
});

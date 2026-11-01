'use strict';

// A new install without voice/ gets one friendly notice, never the technical config path in
// the bubble. Once the flag is saved she stays quiet about it; a sidecar that fails is a
// separate error.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { TRAY } = require('../src/main/labels');

function setup(t, cfg, spawn = () => { throw new Error('spawn failed'); }) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-voice-notice-'));
  const load = Module._load;
  Module._load = function stub(request, ...rest) {
    if (request === 'electron') return { app: { getPath: () => home, isPackaged: true } };
    if (request === 'node:child_process') return { spawn };
    return load.call(this, request, ...rest);
  };
  t.after(() => {
    Module._load = load;
    for (const name of ['../src/main/voice', '../src/main/log']) delete require.cache[require.resolve(name)];
    fs.rmSync(home, { recursive: true, force: true });
  });
  for (const name of ['../src/main/voice', '../src/main/log']) delete require.cache[require.resolve(name)];

  const events = [];
  let marks = 0;
  const voice = require('../src/main/voice').createVoice({
    root: home,
    loadConfig: () => cfg,
    onEvent: (evt) => events.push(evt),
    markNoticeShown: () => { marks += 1; },
  });
  return { voice, events, marks: () => marks, home };
}

test('no voice.dir: one friendly notice, technical detail only in the log', (t) => {
  const cfg = { lang: 'es', voice: { enabled: true, dir: null, noticeShown: false } };
  const { voice, events, marks, home } = setup(t, cfg);

  voice.start();
  voice.start(); // a second start in the same session must not repeat it

  const missing = events.filter((e) => e.type === 'voice-missing');
  assert.equal(missing.length, 1);
  assert.equal(missing[0].message, undefined);
  assert.equal(marks(), 1);
  assert.match(TRAY.es.voiceMissing, /voz/i);
  assert.doesNotMatch(TRAY.es.voiceMissing, /voice\.dir|config\.json/);

  const log = fs.readFileSync(path.join(home, 'logs', 'voice.log'), 'utf8');
  assert.match(log, /voice\.dir/);
});

test('voice.noticeShown: the friendly notice never repeats', (t) => {
  const cfg = { lang: 'es', voice: { enabled: true, dir: null, noticeShown: true } };
  const { voice, events, marks } = setup(t, cfg);

  voice.start();

  assert.equal(events.length, 0);
  assert.equal(marks(), 0);
});

test('voice.dir exists but the sidecar fails: a separate friendly error', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-voice-fail-'));
  const dir = path.join(home, 'voice');
  fs.mkdirSync(path.join(dir, '.venv', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.venv', 'bin', 'python'), '');
  fs.writeFileSync(path.join(dir, 'server.py'), '');
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));

  const cfg = { lang: 'es', voice: { enabled: true, dir, noticeShown: false } };
  const { voice, events, home: logHome } = setup(t, cfg);

  voice.start();

  assert.equal(events.filter((e) => e.type === 'voice-missing').length, 0);
  assert.equal(events.filter((e) => e.type === 'voice-failed').length, 1);
  assert.match(TRAY.es.voiceFailed, /Discord/);
  const log = fs.readFileSync(path.join(logHome, 'logs', 'voice.log'), 'utf8');
  assert.match(log, /spawn failed/);
});

'use strict';

// Ajustes › AUDIO: a voice folder only counts with server.py and its own .venv (setup.ps1 makes
// both), a bad pick never reaches config.json, and a good one brings her real voice back after
// the public migration turned tts off.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

// voice.js and config.js both want Electron's app; a temp dir keeps them off the real profile.
const load = Module._load;
Module._load = function stub(request, ...rest) {
  if (request === 'electron') return { app: { getPath: () => os.tmpdir(), isPackaged: true } };
  return load.call(this, request, ...rest);
};
const { checkVoiceDir } = require('../src/main/voice');
const { reviveMigratedTts } = require('../src/main/config');
Module._load = load;

function voiceFolder(t, { server = true, venv = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-voice-dir-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  if (server) fs.writeFileSync(path.join(dir, 'server.py'), '');
  if (venv) {
    fs.mkdirSync(path.join(dir, '.venv', 'bin'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.venv', 'bin', 'python'), '');
  }
  return dir;
}

test('a folder needs server.py and its own .venv', (t) => {
  const good = checkVoiceDir(voiceFolder(t));
  assert.equal(good.ok, true);
  assert.equal(path.isAbsolute(good.dir), true);

  for (const broken of [voiceFolder(t, { server: false }), voiceFolder(t, { venv: false })]) {
    const check = checkVoiceDir(broken);
    assert.equal(check.ok, false);
    assert.match(check.message, /Falta instalar la voz: corré setup\.ps1/);
  }
});

// The two lines main.js runs after the dialog: validate, and only then save.
function pick(dir, voice) {
  const saved = [];
  const check = checkVoiceDir(dir);
  if (!check.ok) return { check, saved };
  saved.push({ voice: { dir: check.dir, ...reviveMigratedTts(voice) } });
  return { check, saved };
}

test('a bad folder is refused and nothing is saved', (t) => {
  const { check, saved } = pick(voiceFolder(t, { venv: false }), { tts: 'off', publicReplyMigrated: true });
  assert.equal(check.ok, false);
  assert.match(check.message, /setup\.ps1/);
  assert.deepEqual(saved, []); // config untouched
});

test('a good folder on a migrated config saves dir + tts auto', (t) => {
  const dir = voiceFolder(t);
  const { saved } = pick(dir, { tts: 'off', replyMode: 'blips', publicReplyMigrated: true });
  assert.equal(saved.length, 1);
  assert.equal(saved[0].voice.dir, path.resolve(dir));
  assert.equal(saved[0].voice.tts, 'auto');
});

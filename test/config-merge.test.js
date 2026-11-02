'use strict';

// config.json is edited by hand now and then, and the cloud key lives in its own encrypted file.
// A save has to merge with what is on disk (never undo an outside edit) and never drop that key.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { createTokenStore } = require('../src/main/spotify');

const KEY = 'test-key-not-a-real-one';

// the stand-in for Windows' safeStorage that llm-cloud.test.js already uses
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (text) => Buffer.from([...text].map((c) => c.charCodeAt(0) ^ 0x5a)),
  decryptString: (buf) => Buffer.from([...buf].map((b) => b ^ 0x5a)).toString(),
};

function profile(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-keys-survive-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// config.js asks Electron where userData is: point it at the temp profile
function freshConfig(dir) {
  const load = Module._load;
  Module._load = function stub(request, ...rest) {
    if (request === 'electron') return { app: { getPath: () => dir } };
    return load.call(this, request, ...rest);
  };
  try {
    const file = require.resolve('../src/main/config');
    delete require.cache[file];
    return require(file);
  } finally {
    Module._load = load;
  }
}

const configFile = (dir) => path.join(dir, 'config.json');
const keysFile = (dir) => path.join(dir, 'llm-keys');
const keys = (dir) => createTokenStore({ file: keysFile(dir), safeStorage });
const readConfig = (dir) => JSON.parse(fs.readFileSync(configFile(dir), 'utf8'));

test('a hand edit of one field is not wiped by the next save', (t) => {
  const dir = profile(t);
  const config = freshConfig(dir);
  config.save({ wander: true }); // her copy in memory, and config.json on disk
  const edited = readConfig(dir);
  edited.voice.dir = 'D:\\Capri\\voice'; // edited with the app closed
  fs.writeFileSync(configFile(dir), JSON.stringify(edited, null, 2));
  config.save({ wander: false }); // another setting, later
  assert.equal(readConfig(dir).voice.dir, 'D:\\Capri\\voice');
  assert.equal(readConfig(dir).wander, false);
  assert.equal(freshConfig(dir).load().voice.dir, 'D:\\Capri\\voice');
});

test('the cloud key survives a restart, a hand edit and a later save', (t) => {
  const dir = profile(t);
  keys(dir).write({ gemini: KEY }); // pasted in Cerebro, as 0.1.3 saved it
  freshConfig(dir).save({ llm: { provider: 'gemini' } });
  const edited = readConfig(dir);
  edited.voice.dir = 'D:\\Capri\\voice';
  fs.writeFileSync(configFile(dir), JSON.stringify(edited, null, 2)); // app closed
  // reopen: the provider is still hers, and the key file reads back after a fresh store
  const reopened = freshConfig(dir);
  assert.equal(reopened.load().llm.provider, 'gemini');
  assert.equal(keys(dir).read().gemini, KEY);
  reopened.save({ wander: false });
  assert.equal(keys(dir).read().gemini, KEY);
  assert.equal(freshConfig(dir).load().voice.dir, 'D:\\Capri\\voice');
  assert.ok(!fs.readFileSync(configFile(dir), 'utf8').includes(KEY)); // never in config.json
});

test('a config.json written by a text editor with a BOM still loads', (t) => {
  const dir = profile(t);
  const saved = { voice: { dir: 'D:\\Capri\\voice' }, wander: false };
  fs.writeFileSync(configFile(dir), `\uFEFF${JSON.stringify(saved)}`);
  const config = freshConfig(dir);
  assert.equal(config.load().voice.dir, 'D:\\Capri\\voice');
  config.save({ wander: true });
  assert.equal(readConfig(dir).voice.dir, 'D:\\Capri\\voice');
  assert.equal(fs.existsSync(`${configFile(dir)}.bak`), false); // read fine, nothing to keep
});

test('an unreadable config.json is kept as .bak instead of vanishing', (t) => {
  const dir = profile(t);
  fs.writeFileSync(configFile(dir), '{ "voice": { "dir": "D:\\\\Capri\\\\voice", } }'); // trailing comma
  freshConfig(dir).save({ wander: true });
  assert.match(fs.readFileSync(`${configFile(dir)}.bak`, 'utf8'), /voice/);
  assert.equal(readConfig(dir).wander, true);
});

test('a key file that cannot be decrypted is reported, not treated as empty', (t) => {
  const dir = profile(t);
  fs.writeFileSync(keysFile(dir), 'not-a-token-file');
  assert.equal(keys(dir).read(), null);
  assert.equal(fs.readFileSync(keysFile(dir), 'utf8'), 'not-a-token-file');
});

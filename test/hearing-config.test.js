'use strict';

// hearing.fixes in config.json: there by default, saved, and kept when other settings change.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

// config.js asks Electron where userData is: point it at a temp dir instead
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

test('no fixes by default', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-cfg-'));
  const config = freshConfig(dir);
  assert.deepEqual(config.load().hearing, { fixes: [] });
  assert.deepEqual(config.DEFAULTS.hearing.fixes, []);
});

test('saved fixes are written to config.json and read back after a restart', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-cfg-'));
  const fixes = [{ heard: 'jarbis', meant: 'Jarvis' }, { heard: 'na mida', meant: 'Namida' }];
  freshConfig(dir).save({ hearing: { fixes } });
  const raw = fs.readFileSync(path.join(dir, 'config.json'));
  assert.notEqual(raw[0], 0xef); // UTF-8, no BOM
  assert.deepEqual(JSON.parse(raw.toString('utf8')).hearing.fixes, fixes);
  const again = freshConfig(dir);
  assert.deepEqual(again.load().hearing.fixes, fixes);
  // other settings saved later keep them
  again.save({ voice: { enabled: false }, wander: false });
  assert.deepEqual(freshConfig(dir).load().hearing.fixes, fixes);
});

test('an older config.json with no hearing section gets the default', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-cfg-'));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ wander: true, voice: { enabled: true } }));
  assert.deepEqual(freshConfig(dir).load().hearing, { fixes: [] });
});

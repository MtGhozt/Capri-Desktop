'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { wakePhraseLabel, resolveWakeModel } = require('../src/main/wake-phrase');

test('hey_capri.onnx present → «hey Capri»', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-wake-'));
  fs.writeFileSync(path.join(dir, 'hey_capri.onnx'), 'x');
  assert.equal(resolveWakeModel('hey_capri', dir), path.join(dir, 'hey_capri.onnx'));
  assert.equal(wakePhraseLabel('hey_capri', dir), 'hey Capri');
});

test('missing custom model falls back to hey Jarvis', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-wake-'));
  assert.equal(resolveWakeModel('hey_capri', dir), 'hey_jarvis');
  assert.equal(wakePhraseLabel('hey_capri', dir), 'hey Jarvis');
});

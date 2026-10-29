'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('brain routes CapriArtKit to onArtKit', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/renderer/js/brain.js'), 'utf8');
  assert.match(src, /CapriArtKit/);
  assert.match(src, /onArtKit/);
});

test('demo:art script and art-kit module exist', () => {
  assert.ok(fs.existsSync(path.join(__dirname, '../scripts/demo-art.js')));
  assert.ok(fs.existsSync(path.join(__dirname, '../src/renderer/js/art-kit.js')));
  assert.ok(fs.existsSync(path.join(__dirname, '../docs/ART-HANDOFF.md')));
});

test('sleep / DORMANT steps run after satellite and FX, and wake via ensureAwake', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/renderer/js/art-kit.js'), 'utf8');
  const sat = src.indexOf("beat('satellite'");
  const zap = src.indexOf("beat('fx-zap'");
  const mask = src.indexOf("beat('mask-sleep'");
  const chip = src.indexOf("beat('biochip'");
  const dorm = src.indexOf("beat('dormant'");
  assert.ok(sat > 0 && zap > sat);
  assert.ok(mask > zap && chip > mask && dorm > chip);
  assert.match(src, /await ensureAwake\(\)/);
  assert.match(src, /await capri\.rouse\(\)/);
  assert.match(src, /unfold/);
});

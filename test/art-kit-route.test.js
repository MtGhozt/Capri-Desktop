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

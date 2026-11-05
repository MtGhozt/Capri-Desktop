'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DEFAULTS } = require('../src/main/config');

test('guide.extras defaults off and is marked shown once from the Extras step', () => {
  assert.equal(DEFAULTS.guide.extras, false);
  const guide = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', 'guide.js'), 'utf8');
  assert.match(guide, /extras\(\)/);
  assert.match(guide, /setConfig\(\{\s*guide:\s*\{\s*extras:\s*true\s*\}\s*\}\)/);
  assert.match(guide, /model-share/);
  assert.match(guide, /desktop-shortcut/);
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', 'app.js'), 'utf8');
  assert.match(app, /!config\.guide\?\.extras/);
  assert.match(app, /guide\.extras\(\)/);
});

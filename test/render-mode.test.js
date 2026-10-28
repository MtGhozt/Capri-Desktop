'use strict';

// Paso 4K: the Display option for PCs where her window shows up black. Nothing starts Chromium
// here: only what the parser accepts and the switches it asks for.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MODES, parseRenderMode, renderSwitches } = require('../src/main/render-mode');

test('only the three modes her menu offers', () => {
  assert.deepEqual(MODES, ['auto', 'gl', 'software']);
  for (const mode of MODES) assert.equal(parseRenderMode(mode), mode);
});

test('anything else falls back to Normal, never to a broken start', () => {
  for (const odd of ['', null, undefined, 'OpenGL', 'gpu', 'swiftshader', 42, {}]) {
    assert.equal(parseRenderMode(odd), 'auto', String(odd));
  }
});

test('Normal asks Chromium for nothing in particular', () => {
  assert.deepEqual(renderSwitches('auto'), { software: false, switches: [] });
  assert.deepEqual(renderSwitches('nonsense'), { software: false, switches: [] });
});

test('OpenGL and no-graphics-card each get their own switches', () => {
  assert.deepEqual(renderSwitches('gl'), { software: false, switches: [['use-angle', 'gl']] });
  assert.deepEqual(renderSwitches('software'), { software: true, switches: [['enable-unsafe-swiftshader', null]] });
});

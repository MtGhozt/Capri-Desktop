'use strict';

// Paso 4K: the Display option for PCs where her window shows up black. Nothing starts Chromium
// here: only what the parser accepts and the switches it asks for.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  MODES, HINTS, SOFTWARE_CONFIRM, parseRenderMode, renderHint, nextRenderAction, renderSwitches,
} = require('../src/main/render-mode');

test('only the three modes her menu offers', () => {
  assert.deepEqual(MODES, ['auto', 'gl', 'software']);
  for (const mode of MODES) assert.equal(parseRenderMode(mode), mode);
});

test('anything else falls back to Normal, never to a broken start', () => {
  for (const odd of ['', null, undefined, 'OpenGL', 'gpu', 'swiftshader', 42, {}]) {
    assert.equal(parseRenderMode(odd), 'auto', String(odd));
  }
});

test('hint text per mode', () => {
  assert.equal(renderHint('auto'), 'Recomendado');
  assert.equal(renderHint('gl'), 'Solo si Capri se ve negra');
  assert.equal(renderHint('software'), 'Solo si se ve negra y OpenGL no ayudó. Va más lento.');
  assert.equal(HINTS.auto, renderHint('auto'));
});

test('software mode asks before relaunch', () => {
  assert.equal(SOFTWARE_CONFIRM, 'Capri va a ir más lenta. ¿Seguro?');
  assert.deepEqual(nextRenderAction('software', 'auto'), {
    action: 'ask', mode: 'software', message: SOFTWARE_CONFIRM,
  });
  assert.deepEqual(nextRenderAction('software', 'auto', { confirmed: true }), {
    action: 'apply', mode: 'software',
  });
  assert.deepEqual(nextRenderAction('software', 'software'), { action: 'noop', mode: 'software' });
  assert.deepEqual(nextRenderAction('gl', 'auto'), { action: 'apply', mode: 'gl' });
  assert.deepEqual(nextRenderAction('auto', 'gl'), { action: 'apply', mode: 'auto' });
});

test('Normal asks Chromium for nothing in particular', () => {
  assert.deepEqual(renderSwitches('auto'), { software: false, switches: [] });
  assert.deepEqual(renderSwitches('nonsense'), { software: false, switches: [] });
});

test('OpenGL and no-graphics-card each get their own switches', () => {
  assert.deepEqual(renderSwitches('gl'), { software: false, switches: [] });
  assert.deepEqual(renderSwitches('software'), { software: true, switches: [['enable-unsafe-swiftshader', null]] });
});

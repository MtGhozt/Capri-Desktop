'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readAnswer, createConfirm, TTL_MS } = require('../src/main/app-confirm');

test('yes, no and anything else', () => {
  for (const t of ['sí', 'Sí, dale', 'dale', 'ajá', 'claro', 'sí porfa', 'de una', 'ese mismo', 'ok']) assert.equal(readAnswer(t), 'yes', t);
  for (const t of ['no', 'No, gracias', 'mejor no', 'cancela', 'déjalo', 'espera']) assert.equal(readAnswer(t), 'no', t);
  for (const t of ['abre Spotify', '¿qué hora es?', 'sí pero primero cuéntame un chiste largo', '']) assert.equal(readAnswer(t), 'other', t);
});

test('a question waits for one answer only', () => {
  const c = createConfirm();
  assert.equal(c.take('sí'), null); // nothing asked
  c.ask({ type: 'open', apps: ['x'] });
  assert.deepEqual(c.pending, { type: 'open', apps: ['x'] });
  assert.deepEqual(c.take('dale'), { kind: 'yes', action: { type: 'open', apps: ['x'] } });
  assert.equal(c.take('dale'), null);
  assert.equal(c.pending, null);
});

test('no, something else, and too late', () => {
  let t = 0;
  const c = createConfirm({ now: () => t });
  c.ask({ type: 'close' });
  assert.equal(c.take('no').explicit, true);
  c.ask({ type: 'close' });
  const other = c.take('cuéntame algo');
  assert.equal(other.kind, 'no');
  assert.equal(other.explicit, false);
  c.ask({ type: 'close' });
  t = TTL_MS + 1;
  assert.equal(c.pending, null);
  assert.equal(c.take('sí'), null);
  c.ask({ type: 'close' });
  c.cancel();
  assert.equal(c.take('sí'), null);
});

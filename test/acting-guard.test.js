'use strict';

// Unknown act names used to throw in Player (reading `.keys` of undefined) and freeze the overlay.

const { test, mock } = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../src/renderer/js/acting.js');

test('unknown act falls back to idle stand without throwing', async () => {
  const { Player, ACTS } = await load();
  const err = mock.method(console, 'error', () => {});
  const p = new Player('laugh');
  assert.equal(p.name, 'stand');
  assert.equal(p.act, ACTS.stand);
  assert.ok(p.total > 0);
  assert.ok(p.sample(p.start));
  assert.match(String(err.mock.calls[0]?.arguments?.[0] || ''), /unknown act.*"laugh"/);
  err.mock.restore();
});

test('the same unknown act only logs once', async () => {
  const { Player } = await load();
  const err = mock.method(console, 'error', () => {});
  new Player('modron-costume');
  new Player('modron-costume');
  assert.equal(err.mock.callCount(), 1);
  err.mock.restore();
});

test('known acts keep their name', async () => {
  const { Player } = await load();
  assert.equal(new Player('hop').name, 'hop');
  assert.equal(new Player('stand').name, 'stand');
});

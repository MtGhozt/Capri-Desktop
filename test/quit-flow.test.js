'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createQuitFlow, isYes, CONFIRM_MS } = require('../src/main/quit-flow');

test('isYes accepts sí / ok / dale', () => {
  for (const v of ['si', 'sí', 'yes', 'Sí', 'ok', 'dale']) assert.equal(isYes(v), true, v);
  for (const v of ['no', 'cancela', 'abre Discord', '']) assert.equal(isYes(v), false, v);
});

test('confirming with Sí / yes calls quit', () => {
  let quits = 0;
  let cancels = 0;
  const flow = createQuitFlow({
    quit: () => { quits += 1; },
    onCancel: () => { cancels += 1; },
  });
  assert.deepEqual(flow.ask(), { ok: true, asked: true });
  assert.equal(quits, 0);
  assert.deepEqual(flow.answer('si'), { ok: true, quit: true });
  assert.equal(quits, 1);
  assert.equal(cancels, 0);

  flow.ask();
  assert.deepEqual(flow.answer('yes'), { ok: true, quit: true });
  assert.equal(quits, 2);
});

test('a second Salir while she is asking quits without asking again', () => {
  let quits = 0;
  let asks = 0;
  const flow = createQuitFlow({
    quit: () => { quits += 1; },
    onAsk: () => { asks += 1; },
  });
  assert.deepEqual(flow.ask(), { ok: true, asked: true });
  assert.equal(asks, 1);
  assert.deepEqual(flow.ask(), { ok: true, quit: true });
  assert.equal(asks, 1);
  assert.equal(quits, 1);
});

test('No or timeout cancels and does not quit', () => {
  let t = 0;
  let quits = 0;
  let cancels = 0;
  const flow = createQuitFlow({
    confirmMs: 50,
    now: () => t,
    quit: () => { quits += 1; },
    onCancel: () => { cancels += 1; },
  });
  flow.ask();
  assert.deepEqual(flow.answer('no'), { ok: true, cancelled: true });
  assert.equal(quits, 0);
  assert.equal(cancels, 1);

  flow.ask();
  t = 51;
  assert.equal(flow.pending, false);
  assert.deepEqual(flow.answer('si'), { ok: false });
  assert.equal(quits, 0);
  flow.clear(); // drop the real timer so the suite can exit
});

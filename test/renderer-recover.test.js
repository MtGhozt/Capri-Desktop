'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRendererRecover } = require('../src/main/renderer-recover');

function harness() {
  const calls = [];
  const recover = createRendererRecover({
    reload: () => calls.push('reload'),
    notice: (msg) => calls.push(['notice', msg]),
    log: () => {},
    setClickThrough: (on) => calls.push(['through', on]),
  });
  return { recover, calls };
}

test('first renderer crash reloads once and frees the screen', () => {
  const { recover, calls } = harness();
  assert.equal(recover.gone('crashed'), 'reload');
  assert.deepEqual(calls, [['through', true], 'reload']);
  assert.equal(recover.reloads, 1);
});

test('a second crash shows the tray notice instead of looping', () => {
  const { recover, calls } = harness();
  recover.gone('crashed');
  calls.length = 0;
  assert.equal(recover.unresponsive(), 'notice');
  assert.equal(calls[0][0], 'through');
  assert.equal(calls[1][0], 'notice');
  assert.match(calls[1][1], /Ctrl\+Alt\+Shift\+Q/);
  assert.ok(!calls.includes('reload'));
});

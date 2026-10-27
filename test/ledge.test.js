'use strict';

// The ledge she rests on when she sits on the taskbar: the top of the bar while it is up, the
// bottom of her window while it is hidden (auto-hide) or when her screen has no bar.

const { test } = require('node:test');
const assert = require('node:assert/strict');

// the renderer is ES modules; the drawing code is never loaded here, only this little module
const load = () => import('../src/renderer/js/ledge.js');

test('the bar that is up is the ledge', async () => {
  const { ledgeY } = await load();
  assert.equal(ledgeY({ floor: 1079, bar: { y: 1031, h: 48, shown: true } }), 1031);
});

test('the hidden auto-hide bar leaves her at the bottom of her window', async () => {
  const { ledgeY } = await load();
  // the bar parked with 2 px on screen: the watcher says it is not shown
  assert.equal(ledgeY({ floor: 1079, bar: { y: 1077, h: 48, shown: false } }), 1079);
});

test('no bar on her screen is the same as a hidden one', async () => {
  const { ledgeY } = await load();
  assert.equal(ledgeY({ floor: 1079, bar: null }), 1079);
  assert.equal(ledgeY({ floor: 1079 }), 1079);
});

test('a bar that would sit below her floor never lifts her above it', async () => {
  const { ledgeY } = await load();
  assert.equal(ledgeY({ floor: 1079, bar: { y: 1080, h: 48, shown: true } }), 1079);
});

test('a bar whose top is off her window clamps to its top edge', async () => {
  const { ledgeY } = await load();
  assert.equal(ledgeY({ floor: 1079, bar: { y: -40, h: 48, shown: true } }), 0);
});

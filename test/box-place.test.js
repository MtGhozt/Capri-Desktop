'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../src/renderer/js/box-place.js');
const view = { w: 1920, h: 1080 };
const size = { w: 420, h: 190 };

test('the box opens centred above her mane', async () => {
  const { boxAbove } = await load();
  const at = boxAbove({ x: 900, y: 800, top: 700 }, view, size);
  assert.deepEqual(at, { left: 690, top: 700 - 190 - 8 });
});

test('no room above her: it goes under her head; never off screen', async () => {
  const { boxAbove } = await load();
  assert.equal(boxAbove({ x: 900, y: 120, top: 60 }, view, size).top, 168);
  assert.equal(boxAbove({ x: 1900, y: 800, top: 700 }, view, size).left, 1920 - 420 - 14);
  assert.equal(boxAbove({ x: 10, y: 800, top: 700 }, view, size).left, 14);
});

test('a dragged box stays inside the screen', async () => {
  const { clampBox } = await load();
  assert.deepEqual(clampBox({ left: -50, top: 2000 }, view, size), { left: 14, top: 1080 - 190 - 14 });
  assert.deepEqual(clampBox({ left: 300, top: 200 }, view, size), { left: 300, top: 200 });
});

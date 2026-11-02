'use strict';

// Gamepad push-to-talk: Xbox/PlayStation button combo matcher (LB+RB default).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buttonsHeld, anyPadCombo, normalizeCombo } = require('../src/main/gamepad-ptt');

function pad(pressed) {
  return {
    buttons: pressed.map((on) => ({ pressed: Boolean(on) })),
  };
}

test('LB+RB (6+7) counts as held; missing one does not', () => {
  const buttons = Array(16).fill(false);
  buttons[6] = true;
  buttons[7] = true;
  assert.equal(buttonsHeld(pad(buttons), [6, 7]), true);
  buttons[7] = false;
  assert.equal(buttonsHeld(pad(buttons), [6, 7]), false);
  assert.equal(buttonsHeld(null, [6, 7]), false);
});

test('any connected pad can trigger the combo', () => {
  const buttons = Array(16).fill(false);
  buttons[6] = true;
  buttons[7] = true;
  assert.equal(anyPadCombo([null, pad(buttons)], [6, 7]), true);
  assert.equal(anyPadCombo([null, null], [6, 7]), false);
});

test('default combo is LB+RB indexes', () => {
  assert.deepEqual(normalizeCombo(undefined), [6, 7]);
  assert.deepEqual(normalizeCombo([4]), [4]);
});

'use strict';

// OÍDO settings (src/main/hearing.js, Paso 4B): sensitivity ↔ threshold, push-to-talk combos.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  thresholdFromPct, pctFromThreshold, normalizeAccelerator, acceleratorFromKey, sameCombo, SENS_MIN, SENS_MAX,
} = require('../src/main/hearing');

test('sensitivity % is the wake word threshold, kept inside the slider range', () => {
  assert.equal(pctFromThreshold(0.2), 20); // today's default stays as it is
  assert.equal(thresholdFromPct(20), 0.2);
  assert.equal(thresholdFromPct(55), 0.55);
  assert.equal(thresholdFromPct(90), 0.9);
  assert.equal(thresholdFromPct(150), SENS_MAX / 100);
  assert.equal(thresholdFromPct(0), SENS_MIN / 100);
  assert.equal(thresholdFromPct('abc'), 0.2);
  assert.equal(pctFromThreshold(undefined), 20);
  assert.equal(pctFromThreshold(1.5), 20);
  assert.equal(pctFromThreshold(0.95), SENS_MAX);
  for (let p = SENS_MIN; p <= SENS_MAX; p += 5) assert.equal(pctFromThreshold(thresholdFromPct(p)), p);
});

test('combos are written the way Electron wants them', () => {
  assert.equal(normalizeAccelerator('ctrl+alt+v'), 'Ctrl+Alt+V');
  assert.equal(normalizeAccelerator(' Alt + Ctrl + v '), 'Ctrl+Alt+V');
  assert.equal(normalizeAccelerator('Control+Shift+F5'), 'Ctrl+Shift+F5');
  assert.equal(normalizeAccelerator('Win+Space'), 'Super+Space');
  assert.equal(normalizeAccelerator('Alt+F10'), 'Alt+F10');
  assert.equal(normalizeAccelerator('F9'), 'F9');
  assert.equal(normalizeAccelerator('CmdOrCtrl+Alt+1'), 'Ctrl+Alt+1');
});

test('combos that would steal plain typing, or make no sense, are refused', () => {
  for (const bad of ['v', 'Shift+V', 'Ctrl+Alt', 'Ctrl+Ctrl+V', 'Ctrl+V+B', 'Ctrl+Ñ', '', null, 'Ctrl+', 'Hyper+V']) {
    assert.equal(normalizeAccelerator(bad), null, String(bad));
  }
});

test('a keydown in her menu becomes a combo', () => {
  assert.equal(acceleratorFromKey({ key: 'v', code: 'KeyV', ctrlKey: true, altKey: true }), 'Ctrl+Alt+V');
  // AltGr layouts: the key is a symbol, the code is still the key
  assert.equal(acceleratorFromKey({ key: '@', code: 'KeyQ', ctrlKey: true, altKey: true }), 'Ctrl+Alt+Q');
  assert.equal(acceleratorFromKey({ key: '1', code: 'Digit1', altKey: true, shiftKey: true }), 'Alt+Shift+1');
  assert.equal(acceleratorFromKey({ key: 'F8', code: 'F8' }), 'F8');
  assert.equal(acceleratorFromKey({ key: ' ', code: 'Space', metaKey: true }), 'Super+Space');
  assert.equal(acceleratorFromKey({ key: 'Control', code: 'ControlLeft', ctrlKey: true }), null);
  assert.equal(acceleratorFromKey({ key: 'v', code: 'KeyV' }), null);
});

test('the same combo, however it is written', () => {
  assert.equal(sameCombo('Ctrl+Alt+C', 'alt+control+c'), true);
  assert.equal(sameCombo('Ctrl+Alt+C', 'Ctrl+Alt+V'), false);
  assert.equal(sameCombo('', ''), false);
});

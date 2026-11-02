'use strict';

// OÍDO settings (src/main/hearing.js, Paso 4B): sensitivity ↔ threshold, push-to-talk combos.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  thresholdFromPct, pctFromThreshold, normalizeAccelerator, acceleratorFromKey, sameCombo, SENS_MIN, SENS_MAX,
  wakeSensitivity,
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

test('Baja / Normal / Alta are three wake knobs at once, and Normal is the old behaviour', () => {
  assert.deepEqual(wakeSensitivity('normal'), { wakeThreshold: 0.2, wakeMinSpeechMs: 200, wakeEnergy: 0.015 });
  assert.deepEqual(wakeSensitivity(undefined), wakeSensitivity('normal')); // old configs: as before
  assert.deepEqual(wakeSensitivity('nonsense'), wakeSensitivity('normal'));
  // trickier to wake from Klaxon: surer of the phrase, more speech, louder energy floor
  assert.ok(wakeSensitivity('low').wakeThreshold > wakeSensitivity('normal').wakeThreshold);
  assert.ok(wakeSensitivity('low').wakeMinSpeechMs > wakeSensitivity('normal').wakeMinSpeechMs);
  assert.ok(wakeSensitivity('low').wakeEnergy > wakeSensitivity('normal').wakeEnergy);
  // easier for him, stricter with video noise
  assert.ok(wakeSensitivity('high').wakeThreshold < wakeSensitivity('normal').wakeThreshold);
  assert.ok(wakeSensitivity('high').wakeMinSpeechMs < wakeSensitivity('normal').wakeMinSpeechMs);
  assert.ok(wakeSensitivity('high').wakeEnergy < wakeSensitivity('normal').wakeEnergy);
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

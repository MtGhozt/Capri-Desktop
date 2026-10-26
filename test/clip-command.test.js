'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isClipCommand, parseHotkey } = require('../src/main/clip-command');

const clipPhrases = [
  'guarda eso',
  'guardá eso',
  'Guarda eso!',
  'guardame eso',
  'guárdame eso',
  'guarda el clip',
  'guardá el clip',
  'guarda el replay',
  'graba eso',
  'grabá eso',
  'graba el clip',
  'clipéalo',
  'clipealo',
  'clipeá eso',
  'clipea eso',
  'clip eso',
  'Hey Jarvis, guarda eso',
  'capri guardá eso',
];

const notClip = [
  'qué hora es',
  'hola capri',
  'contame un chiste',
  'guarda la calma',
  'grabá la pantalla en mi cabeza',
  'no guardes eso todavía',
  've a dormir',
];

for (const text of clipPhrases) {
  test(`treats "${text}" as a clip command`, () => {
    assert.equal(isClipCommand(text), true);
  });
}

for (const text of notClip) {
  test(`does not treat "${text}" as a clip command`, () => {
    assert.equal(isClipCommand(text), false);
  });
}

test('parses the default NVIDIA hotkey', () => {
  assert.deepEqual(parseHotkey('Alt+F10'), { mods: ['Alt'], key: 'F10' });
});

test('parses a combo with several modifiers in order', () => {
  assert.deepEqual(parseHotkey('Ctrl+Shift+F9'), { mods: ['Control', 'Shift'], key: 'F9' });
  assert.deepEqual(parseHotkey('ctrl + alt + k'), { mods: ['Control', 'Alt'], key: 'K' });
});

test('rejects hotkeys it cannot send', () => {
  assert.equal(parseHotkey(''), null);
  assert.equal(parseHotkey('Alt+'), null);
  assert.equal(parseHotkey('Hyper+F10'), null);
  assert.equal(parseHotkey('Alt+Alt+F10'), null);
  assert.equal(parseHotkey('Alt+F25'), null);
});

'use strict';

// "Hey Capri, pon música": the wake word is not part of the order, but the chat still shows
// everything he said. Typed text goes through the same normalizer.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripWakeWord, normalizeCommandText } = require('../src/main/command-text');
const { parseMusicCommand } = require('../src/main/music-command');

test('the wake word comes off the order, in any of its forms', () => {
  assert.equal(stripWakeWord('Capri, pon música'), 'pon música');
  assert.equal(stripWakeWord('Hey Capri, pon música'), 'pon música');
  assert.equal(stripWakeWord('hola capri pon música'), 'pon música');
  assert.equal(stripWakeWord('Oye, Capri: ¿qué hora es?'), '¿qué hora es?');
  assert.equal(stripWakeWord('hey jarvis abre Discord'), 'abre Discord');
  assert.equal(stripWakeWord('HÓLA CÁPRI, abre Discord'), 'abre Discord'); // accents and caps
  assert.equal(stripWakeWord('pon música'), 'pon música');
  assert.equal(stripWakeWord('hola, ¿cómo estás?'), 'hola, ¿cómo estás?'); // not a wake word
});

test('only the wake word is a greeting: nothing left, nothing to answer as an order', () => {
  assert.equal(stripWakeWord('Hola Capri'), '');
  assert.equal(stripWakeWord('Hey Capri,'), ''); // the original text is still what the chat shows
  assert.deepEqual(parseMusicCommand('Hey Capri, pon música'), parseMusicCommand('pon música'));
});

test('typed orders drop the wake word too, greeting included', () => {
  assert.equal(normalizeCommandText('Hey Capri, pon música'), 'pon musica');
  assert.equal(normalizeCommandText('Hola Capri, abre Discord'), 'abre discord');
  assert.equal(normalizeCommandText('Oye Capri… silencio'), 'silencio');
});

test('her persona never greets with the date, and knows he is a man', () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, '..', 'src', 'main', p), 'utf8');
  const persona = read('persona.md');
  assert.equal(persona, read('defaults/persona.md'));
  assert.match(persona, /he\/him/i);
  assert.match(persona, /Never open a greeting with the date or time/i);
  assert.match(persona, /Never "juntitas"/i);
  assert.equal(/first conversation of this session/i.test(persona), false);
});

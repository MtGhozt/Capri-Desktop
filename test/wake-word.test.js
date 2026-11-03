'use strict';

// "Hey Capri, pon música": the wake word is not part of the order, but the chat still shows
// everything he said. Typed text goes through the same normalizer.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripWakeWord, normalizeCommandText, wakeWordAtStart, wakeTranscriptOk } = require('../src/main/command-text');
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
  assert.equal(stripWakeWord('Hey Capri'), '');
  assert.equal(stripWakeWord('ACAPRI'), '');
  assert.equal(stripWakeWord('HEACAPRI.'), '');
  assert.deepEqual(parseMusicCommand('Hey Capri, pon música'), parseMusicCommand('pon música'));
});

test('wake strip keeps the real order after mangled or spoken greetings', () => {
  assert.equal(stripWakeWord('hey capri pon tu canción'), 'pon tu canción');
  assert.equal(stripWakeWord('oye kapri abre spotify'), 'abre spotify');
});

test('typed orders drop the wake word too, greeting included', () => {
  assert.equal(normalizeCommandText('Hey Capri, pon música'), 'pon musica');
  assert.equal(normalizeCommandText('Hola Capri, abre Discord'), 'abre discord');
  assert.equal(normalizeCommandText('Oye Capri… silencio'), 'silencio');
});

test('the wake word has to open the utterance', () => {
  for (const said of ['Capri, pon música', 'Hey Capri, abre Discord', 'hola capri pon tu canción', 'ACAPRI', 'Oye, Capri: ¿qué hora es?']) {
    assert.equal(wakeWordAtStart(said), true, said);
  }
  for (const said of [
    'pon música',
    'quiero hablar con capri',
    'estábamos viendo el video y de repente capri dijo que el otro día en el barrio pasó algo raro con la banda',
    '',
    null,
  ]) {
    assert.equal(wakeWordAtStart(said), false, String(said));
  }
});

test('a whisper wake already stripped is fine; one that still carries the wake word elsewhere is not', () => {
  assert.equal(wakeTranscriptOk('pon música'), true); // the sidecar strips a real wake before sending it
  assert.equal(wakeTranscriptOk('Capri, pon música'), true);
  assert.equal(wakeTranscriptOk('y entonces capri dijo que se fuera'), false); // video speech, not an order
});

test('voice sidecar repairs wake resources and falls back with a friendly notice', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'voice', 'server.py'), 'utf8');
  assert.match(server, /missing_resources/);
  assert.match(server, /openWakeWord resources missing after download/);
  assert.match(server, /El 'Hey Capri' no pudo arrancar; uso la detección por voz/);
});

test('her persona never greets with the date, and knows he is a man', () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, '..', 'src', 'main', p), 'utf8');
  const persona = read('persona.md');
  assert.equal(persona, read('defaults/persona.md'));
  assert.match(persona, /he\/him/i);
  assert.match(persona, /Never open a greeting with the date or time/i);
  assert.match(persona, /Never "juntitas"/i);
  assert.match(persona, /You cannot create, edit, delete or move files/i);
  assert.match(persona, /Never claim you did/i);
  assert.match(persona, /tostada de ayote|chaotic, hyper, warm/i);
  assert.match(persona, /laugh WITH him/i);
  assert.match(persona, /Use \[burla\] rarely/i);
  assert.match(persona, /voseo/i);
  assert.equal(/first conversation of this session/i.test(persona), false);
  assert.equal(/\bTeasing is mostly\b/.test(persona), false);
  assert.equal(/needle him like a sparring partner/i.test(persona), false);
});

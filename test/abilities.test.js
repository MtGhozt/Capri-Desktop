'use strict';

// "¿Qué sabés hacer?": the trigger phrases and the short list built from real commands.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isAbilitiesCommand, abilitiesLines } = require('../src/main/abilities');

test('recognizes the abilities questions, with or without the wake word', () => {
  for (const text of [
    '¿Qué sabés hacer?',
    'que sabes hacer',
    '¿qué podés hacer?',
    'que podes hacer',
    'Capri, ¿qué sabés hacer?',
    'ayuda',
    '¿Ayuda?',
    'en qué me ayudás',
    'en que me ayudas',
  ]) {
    assert.equal(isAbilitiesCommand(text), true, text);
  }
});

test('other questions stay with the model', () => {
  for (const text of [
    'me das una ayuda',
    'ayudame con esto',
    'qué haces',
    'qué hay de nuevo',
    'qué hora es',
    'pon música',
  ]) {
    assert.equal(isAbilitiesCommand(text), false, text);
  }
});

test('the summary is 4–6 short lines covering the main abilities', () => {
  const lines = abilitiesLines();
  assert.ok(lines.length >= 4 && lines.length <= 6, String(lines.length));
  for (const line of lines) assert.ok(line.length < 90, line);
  const all = lines.join(' ');
  assert.match(all, /recordatorios|Google Calendar/i);
  assert.match(all, /música|Spotify|YouTube Music|Namida/i);
  assert.match(all, /PC|volumen|ventanas|archivos/i);
  assert.match(all, /busc/i);
  assert.match(all, /juegos|No molestar/i);
});

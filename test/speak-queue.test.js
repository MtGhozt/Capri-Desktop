'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { packPhrases, createSpeakQueue } = require('../src/main/speak.js');

test('joins phrases shorter than 20 chars with the next one', () => {
  assert.deepEqual(packPhrases(['A mimir.', 'Despertame si hay quilombo.'], true), [
    'A mimir. Despertame si hay quilombo.',
  ]);
  assert.deepEqual(packPhrases(['Dale, me apago un toque. No hagas lío, choom.'], true), [
    'Dale, me apago un toque. No hagas lío, choom.',
  ]);
});

test('speak queue holds a short sentence until flush or a longer one', () => {
  const sent = [];
  const q = createSpeakQueue({ send: (msg) => sent.push(msg) });
  const id = q.start();
  q.feed('Ok. ');
  q.feed('Me duermo. ');
  q.feed('Chau, nos vemos mañana choom.');
  q.flush(id);
  const speaks = sent.filter((m) => m.type === 'speak').map((m) => m.text);
  assert.equal(speaks.length, 1);
  assert.match(speaks[0], /Ok\. Me duermo\./);
});

test('the user turn id rides the speak messages that already exist', () => {
  const sent = [];
  const q = createSpeakQueue({ send: (msg) => sent.push(msg) });
  const id = q.start(12);
  q.feed('Ya va, choom, dame un segundo.');
  q.flush(id);
  assert.deepEqual(sent.map((m) => m.type), ['speak_start', 'speak', 'speak_flush']);
  assert.ok(sent.every((m) => m.turn === 12 && m.id === id));
  const plain = [];
  const other = createSpeakQueue({ send: (msg) => plain.push(msg) });
  other.start();
  other.feed('Una frase larga para el sidecar.');
  other.flush();
  assert.ok(plain.every((m) => m.turn == null));
});

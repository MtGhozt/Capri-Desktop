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

test('first speak is emitted before the second sentence arrives', () => {
  const sent = [];
  const q = createSpeakQueue({ send: (msg) => sent.push(msg) });
  q.start();
  q.feed('Ok. ');
  const afterFirst = sent.filter((m) => m.type === 'speak');
  assert.equal(afterFirst.length, 1);
  assert.equal(afterFirst[0].text, 'Ok.');
  q.feed('Me duermo un rato más, choom.');
  const speaks = sent.filter((m) => m.type === 'speak').map((m) => m.text);
  assert.equal(speaks[0], 'Ok.');
  assert.ok(speaks.length >= 2);
  assert.match(speaks[1], /Me duermo/);
});

test('later short sentences still pack; first of the turn does not', () => {
  const sent = [];
  const q = createSpeakQueue({ send: (msg) => sent.push(msg) });
  const id = q.start();
  q.feed('Listo choom, ya arranco con esto bien. '); // first: long enough sentence
  q.feed('Ok. ');
  q.feed('Ya. ');
  q.feed('Después vemos el resto del plan juntos.');
  q.flush(id);
  const speaks = sent.filter((m) => m.type === 'speak').map((m) => m.text);
  assert.match(speaks[0], /Listo choom/);
  assert.ok(speaks.some((t) => /Ok\. Ya\./.test(t) || /Después vemos/.test(t)));
});

test('first speak can cut at a comma after ~25 chars', () => {
  const sent = [];
  const q = createSpeakQueue({ send: (msg) => sent.push(msg) });
  q.start();
  q.feed('Bueno ahora mismo te digo, ');
  const speaks = sent.filter((m) => m.type === 'speak');
  assert.equal(speaks.length, 1);
  assert.match(speaks[0].text, /Bueno ahora mismo te digo,/);
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

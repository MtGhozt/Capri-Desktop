'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MOODS, normalizeMood, stripMoodTag, createMoodStripper } = require('../src/main/mood-tag');
const { DEFAULTS } = require('../src/main/config');

test('default ttsMoods map covers the four moods', () => {
  assert.deepEqual(Object.keys(DEFAULTS.voice.ttsMoods).sort(), [...MOODS].sort());
  assert.equal(DEFAULTS.voice.ttsRefCalm, undefined);
});

test('stripMoodTag parses moods and aliases [calm] → seria', () => {
  assert.deepEqual(stripMoodTag('[burla] Jajaja, tontito.'), {
    text: 'Jajaja, tontito.', mood: 'burla',
  });
  assert.deepEqual(stripMoodTag('[emocion] ¡Genial!'), {
    text: '¡Genial!', mood: 'emocion',
  });
  assert.deepEqual(stripMoodTag('[aburrida] Qué flojera.'), {
    text: 'Qué flojera.', mood: 'aburrida',
  });
  assert.deepEqual(stripMoodTag('[seria] Solo un retraso.'), {
    text: 'Solo un retraso.', mood: 'seria',
  });
  assert.deepEqual(stripMoodTag('[calm] Una muerte rápida sería aburrida.'), {
    text: 'Una muerte rápida sería aburrida.', mood: 'seria',
  });
  assert.deepEqual(stripMoodTag('  [CALM]  Hola.'), { text: 'Hola.', mood: 'seria' });
  assert.deepEqual(stripMoodTag('Sin tag.'), { text: 'Sin tag.', mood: null });
  assert.deepEqual(stripMoodTag('[calmish] no'), { text: '[calmish] no', mood: null });
});

test('normalizeMood aliases and rejects unknowns', () => {
  assert.equal(normalizeMood('calm'), 'seria');
  assert.equal(normalizeMood('BURLA'), 'burla');
  assert.equal(normalizeMood('nope'), null);
});

test('stream stripper holds until a mood tag is decided', () => {
  const out = [];
  let mood = null;
  const s = createMoodStripper({
    onText: (p) => out.push(p),
    onMood: (name) => { mood = name; },
  });
  s.push('[');
  s.push('aburrida');
  assert.deepEqual(out, []);
  s.push('] Spoiler: no.');
  assert.equal(mood, 'aburrida');
  assert.deepEqual(out, ['Spoiler: no.']);
  s.flush();
  assert.equal(s.mood, 'aburrida');
});

test('stream [calm] alias fires onMood(seria)', () => {
  const out = [];
  let mood = null;
  const s = createMoodStripper({
    onText: (p) => out.push(p),
    onMood: (name) => { mood = name; },
  });
  s.push('[calm] Oscuro.');
  assert.equal(mood, 'seria');
  assert.equal(out.join(''), 'Oscuro.');
});

test('stream without tag passes through (fallback to ttsRef)', () => {
  const out = [];
  const s = createMoodStripper({ onText: (p) => out.push(p) });
  s.push('Hola, ');
  s.push('choom.');
  s.flush();
  assert.equal(s.mood, null);
  assert.equal(out.join(''), 'Hola, choom.');
});

'use strict';

// "cuando digo X quiero decir Y" and friends (src/main/fix-command.js, Paso 4A).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseFixCommand, isFixCommand } = require('../src/main/fix-command');

const ADD = [
  ['cuando digo jarbis quiero decir Jarvis', 'jarbis', 'Jarvis'],
  ['Cuando digo Jarbis, quiero decir Jarvis.', 'Jarbis', 'Jarvis'],
  ['Capri, cuando digo «na mida» me refiero a Namida', 'na mida', 'Namida'],
  ['Hey Jarvis. Cuando oigas "cabri", es Capri.', 'cabri', 'Capri'],
  ['cuando oigas jarbis es Jarvis', 'jarbis', 'Jarvis'],
  ['oye, cuando escuches na mida, es Namida, por favor', 'na mida', 'Namida'],
  ['Cuando yo digo cursos me refiero a Cursor.', 'cursos', 'Cursor'],
  ['si digo open code quiero decir OpenCode', 'open code', 'OpenCode'],
  ['cuando digo jarbis significa Jarvis gracias', 'jarbis', 'Jarvis'],
  ['Cuando oigas Spoti, lee Spotify', 'Spoti', 'Spotify'],
];

const REMOVE = [
  ['olvida la corrección de jarbis', 'jarbis'],
  ['Capri, borra la corrección de «na mida».', 'na mida'],
  ['ya no corrijas cabri', 'cabri'],
  ['deja de corregir Spoti', 'Spoti'],
];

const NOT = [
  '¿qué quiere decir jarbis?',
  '¿Cuando digo jarbis quiero decir Jarvis?',
  'cuando digo que estoy cansado es porque quiero dormir',
  'cuando digo hola quiero decir que te quiero',
  'cuando digo esto quiero decir otra cosa completamente diferente',
  'cuando escuchas música es mejor con audífonos',
  'cuando oyes eso es raro',
  'cuando oigas música avisame',
  'no sé qué quiero decir',
  'cuando era niño quería decir palabras raras',
  'olvida la conversación',
  'borra la memoria',
  'quiero decir algo',
  'jarbis es Jarvis',
  'cuando digo jarbis quiero decir jarbis',
  '',
];

test('teaching her a word: "cuando digo X quiero decir Y" and the like', () => {
  for (const [line, heard, meant] of ADD) {
    assert.deepEqual(parseFixCommand(line), { action: 'add', heard, meant }, line);
  }
});

test('making her forget one: "olvida la corrección de X"', () => {
  for (const [line, heard] of REMOVE) {
    assert.deepEqual(parseFixCommand(line), { action: 'remove', heard }, line);
  }
});

test('questions and talk about words are not orders', () => {
  for (const line of NOT) assert.equal(isFixCommand(line), false, line);
});

const { readTranscript } = require('../src/main/fix-command');

test('a transcript is read with her fixes before anything else sees it', () => {
  const fixes = [{ heard: 'jarbis', meant: 'Jarvis' }];
  assert.deepEqual(readTranscript('oye jarbis, apaga el micro', fixes), {
    text: 'oye Jarvis, apaga el micro',
    heard: 'oye jarbis, apaga el micro',
    order: false,
  });
  assert.deepEqual(readTranscript('nada que cambiar', fixes), { text: 'nada que cambiar', heard: null, order: false });
});

test('an order about her fixes is left as said, so it still names the wrong word', () => {
  const fixes = [{ heard: 'jarbis', meant: 'Jarvis' }];
  const read = readTranscript('cuando digo jarbis quiero decir Yarvis', fixes);
  assert.equal(read.text, 'cuando digo jarbis quiero decir Yarvis');
  assert.equal(read.order, true);
  assert.deepEqual(parseFixCommand(read.text), { action: 'add', heard: 'jarbis', meant: 'Yarvis' });
});

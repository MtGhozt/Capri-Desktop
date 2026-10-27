'use strict';

// What she hears wrong, read as what you meant (src/main/fixes.js, Paso 4A).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { applyFixes, addFix, removeFix, cleanFixes, makeFix, fold } = require('../src/main/fixes');

const FIXES = [
  { heard: 'jarbis', meant: 'Jarvis' },
  { heard: 'na mida', meant: 'Namida' },
  { heard: 'cabri', meant: 'Capri' },
];

test('whole words only: never inside another word', () => {
  assert.equal(applyFixes('jarbis', FIXES), 'Jarvis');
  assert.equal(applyFixes('ojarbis jarbisito superjarbis', FIXES), 'ojarbis jarbisito superjarbis');
  assert.equal(applyFixes('cabrito y cabri', FIXES), 'cabrito y Capri');
  assert.equal(applyFixes('jarbis2 jarbis_', FIXES), 'jarbis2 Jarvis_'); // a digit is part of the word; _ is not
});

test('any case, with or without accents, both ways', () => {
  assert.equal(applyFixes('JARBIS ya', FIXES), 'Jarvis ya');
  assert.equal(applyFixes('Járbis, ¿estás?', FIXES), 'Jarvis, ¿estás?');
  const accented = [{ heard: 'canción', meant: 'Namida' }];
  assert.equal(applyFixes('pon una cancion', accented), 'pon una Namida');
  assert.equal(applyFixes('pon una CANCIÓN', accented), 'pon una Namida');
});

test('a phrase of several words, with whatever Whisper put between them', () => {
  assert.equal(applyFixes('abre na mida porfa', FIXES), 'abre Namida porfa');
  assert.equal(applyFixes('abre na, mida', FIXES), 'abre Namida');
  assert.equal(applyFixes('abre na  mida', FIXES), 'abre Namida');
  assert.equal(applyFixes('nada mida', FIXES), 'nada mida');
});

test('the longest phrase wins over a shorter one inside it', () => {
  const fixes = [
    { heard: 'na', meant: 'ene a' },
    { heard: 'na mida', meant: 'Namida' },
    { heard: 'na mida dos', meant: 'Namida 2' },
  ];
  assert.equal(applyFixes('na mida dos y na mida y na', fixes), 'Namida 2 y Namida y ene a');
});

test('one pass: a fix never runs on what another one wrote', () => {
  const fixes = [{ heard: 'a', meant: 'b' }, { heard: 'b', meant: 'c' }];
  assert.equal(applyFixes('a b', fixes), 'b c');
});

test('the rest of the text stays exactly as it was', () => {
  const text = '  Hola, Járbis…  ¿qué tal? 😀 todo bien.  ';
  assert.equal(applyFixes(text, FIXES), '  Hola, Jarvis…  ¿qué tal? 😀 todo bien.  ');
  assert.equal(applyFixes(text, []), text);
  assert.equal(applyFixes('', FIXES), '');
});

test('a capital where it was heard with one, unless the fix has its own', () => {
  const fixes = [{ heard: 'nami da', meant: 'namida' }];
  assert.equal(applyFixes('Nami da, abre', fixes), 'Namida, abre');
  assert.equal(applyFixes('abre nami da', fixes), 'abre namida');
});

test('characters that mean something in a regex are just text', () => {
  const fixes = [{ heard: 'c++', meant: 'C plus plus' }, { heard: 'a.b', meant: 'AB' }];
  assert.equal(applyFixes('axb', fixes), 'axb');
  assert.equal(applyFixes('a.b', fixes), 'AB');
});

test('folding keeps the length, so positions line up with the original', () => {
  const text = 'Árbol ÑANDÚ çà 😀 ok';
  assert.equal(fold(text).length, text.length);
  assert.equal(fold('Árbol ÑANDÚ'), 'arbol nandu');
});

test('adding a fix for a phrase she already fixes updates it (case and accents do not count)', () => {
  let { fixes, updated } = addFix([], 'jarbis', 'Jarvis');
  assert.equal(updated, false);
  ({ fixes, updated } = addFix(fixes, 'JÁRBIS', 'Yarvis'));
  assert.equal(updated, true);
  assert.deepEqual(fixes, [{ heard: 'JÁRBIS', meant: 'Yarvis' }]);
});

test('fixes that make no sense are not saved', () => {
  assert.equal(makeFix('', 'x'), null);
  assert.equal(makeFix('x', ''), null);
  assert.equal(makeFix('...', 'x'), null);
  assert.equal(makeFix('Jarvis', 'jarvis'), null); // nothing would change
  assert.equal(makeFix('a'.repeat(61), 'b'), null);
  assert.deepEqual(makeFix('  «jarbis»  ', ' Jarvis. '), { heard: 'jarbis', meant: 'Jarvis' });
  assert.equal(addFix([], '', 'x').fix, null);
});

test('removing a fix by what she heard, any case or accents', () => {
  const { fixes, removed } = removeFix(FIXES, 'Na Mída');
  assert.deepEqual(removed, { heard: 'na mida', meant: 'Namida' });
  assert.equal(fixes.length, 2);
  assert.equal(removeFix(FIXES, 'nope').removed, null);
});

test('bad entries in config are skipped; the last of two for the same phrase wins', () => {
  const list = [null, 'x', { heard: '', meant: 'a' }, { heard: 'jarbis', meant: 'A' }, { heard: 'Jarbis', meant: 'Jarvis' }];
  assert.deepEqual(cleanFixes(list), [{ heard: 'Jarbis', meant: 'Jarvis' }]);
  assert.deepEqual(cleanFixes(undefined), []);
  assert.equal(applyFixes('jarbis', list), 'Jarvis');
});

'use strict';

// "llamame Mati" / "decime Matías": a name for her to call you, without the LLM.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseNameCommand, cleanName } = require('../src/main/name-command');

const yes = [
  ['llamame Mati', 'Mati'],
  ['decime Matías', 'Matías'],
  ['llámame así Mati', 'Mati'],
  ['Capri, llamame Mati', 'Mati'],
  ['oye Capri, decime Mati.', 'Mati'],
  ['Llamame Ana María', 'Ana María'],
];

const no = [
  'llamame',
  'decime así',
  'llamame cuando llegues',
  'decime si te escucho',
  'dime qué hora es',
  '¿cómo te llamás?',
  'me llamo Mati',
  'llamame a la oficina ahora mismo',
];

for (const [text, name] of yes) {
  test(`"${text}" names him ${name}`, () => {
    assert.equal(parseNameCommand(text), name);
  });
}

for (const text of no) {
  test(`"${text}" is not a name`, () => {
    assert.equal(parseNameCommand(text), null);
  });
}

test('a name too long or empty is refused', () => {
  assert.equal(cleanName(''), null);
  assert.equal(cleanName('   '), null);
  assert.equal(cleanName('x'.repeat(25)), null);
  assert.equal(cleanName('  Mati  '), 'Mati');
});

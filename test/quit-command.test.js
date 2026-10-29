'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isQuitCommand } = require('../src/main/quit-command');
const { isSleepCommand } = require('../src/main/sleep-command');

test('quit phrases map to quit', () => {
  for (const said of [
    'ciérrate',
    'Capri, ciérrate',
    'vete',
    'cierra Capri',
    'cierra a Capri',
    'Hey Capri, cierra Capri',
  ]) {
    assert.equal(isQuitCommand(said), true, said);
  }
});

test('"vete a dormir" stays sleep, not quit', () => {
  assert.equal(isSleepCommand('vete a dormir'), true);
  assert.equal(isQuitCommand('vete a dormir'), false);
  assert.equal(isQuitCommand('Capri, vete a dormir'), false);
  assert.equal(isQuitCommand('andá a dormir'), false);
});

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isSleepCommand } = require('../src/main/sleep-command');

const sleepPhrases = [
  've a dormir',
  'tú ve a dormir',
  'vete a dormir',
  'voy a dormir',
  'duérmete',
  'descansa',
  'apágate',
  'andá a dormir',
  'dormite',
  'a mimir',
  'sleep',
  'go to sleep',
  'Hey Jarvis, ve a dormir',
  'capri andá a dormir',
  '¡ve a dormir!',
];

const notSleep = [
  'qué hora es',
  'hola capri',
  'contame un chiste',
  'no te duermas todavía',
];

for (const text of sleepPhrases) {
  test(`treats "${text}" as sleep`, () => {
    assert.equal(isSleepCommand(text), true);
  });
}

for (const text of notSleep) {
  test(`does not treat "${text}" as sleep`, () => {
    assert.equal(isSleepCommand(text), false);
  });
}

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
  'duerme',
  've y duerme',
  've y duerme tú también',
  'vete a dormir ya',
  'a dormir',
  'hora de dormir',
  'es hora de dormir',
  'anda a dormir',
  'duérmete ya',
  'descansa un rato',
  'me voy a dormir',
  'a dormir, ¿sí?',
  'Capri, duérmete ya',
  'andá a dormir vos también',
  'descansá un rato, por favor',
];

const notSleep = [
  'qué hora es',
  'hola capri',
  'contame un chiste',
  'no te duermas todavía',
  '¿tú duermes?',
  'no pude dormir',
  'tengo sueño',
  'voy a dormir mal',
  'voy a dormir tarde',
  'no quiero dormir',
  '¿estás durmiendo?',
  'me gusta dormir la siesta',
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

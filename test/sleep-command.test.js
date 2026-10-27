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
  // cozy ones (Paso 4A fix)
  'Capri, duermito un rato, quieres?',
  'Capri, duérmete un rato',
  'duermito',
  'duérmete un ratito',
  'a dormir un ratito',
  'una siestita',
  'échate una siesta',
  'Tómate una siestita, ¿va?',
  'a la camita',
  've a la camita, porfa',
  'a mimir, dale',
  'Hey Jarvis. Duérmete un poquito, ¿sí?',
  'a dormir, ¿quieres?',
  // offers to her
  '¿quieres dormir un rato?',
  '¿quieres dormir?',
  '¿te quieres dormir un rato?',
  '¿por qué no duermes un rato?',
  'Capri, ¿por qué no te echas una siestita?',
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
  '¿dormiste bien?',
  '¿tienes sueño?',
  '¿cuánto duermes?',
  'yo quiero dormir pero tengo tarea',
  '¿te gusta dormir?',
  'anoche no dormí',
  '¿quieres que te cuente un chiste?',
  'yo quiero una siesta',
  'la cama está desordenada',
  '¿por qué no dormiste?',
  'quiero dormir un rato',
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

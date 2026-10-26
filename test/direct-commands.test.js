'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isMuteCommand, isUnmuteCommand } = require('../src/main/mic-command');
const { isForgetCommand } = require('../src/main/forget-command');
const { isWakeCommand } = require('../src/main/wake-command');

const cases = [
  [isMuteCommand, 'mute', [
    'apaga el micrófono',
    'mutea el micrófono',
    'mutéate',
    'deja de escucharme',
    'Capri, apagá el micrófono',
    'mutea el micro',
    'silencia el micrófono',
    'corta el mic',
  ], [
    'apaga la música',
    'apaga la luz',
    'prende el micrófono',
    '¿me escuchás?',
    'dejá de molestar',
    'pone algo de música',
  ]],
  [isUnmuteCommand, 'unmute', [
    'prende el micrófono',
    'activa el micrófono',
    'enciende el mic',
    'volvé a escucharme',
    'Capri, empezá a escucharme',
    'abrí el micrófono',
  ], [
    'apaga el micrófono',
    'prende la luz',
    'activa el bluetooth',
    'escuchame un segundo',
  ]],
  [isForgetCommand, 'forget', [
    'olvida la conversación',
    'borra la conversación',
    'olvida todo',
    'olvidate de todo',
    'limpia la memoria',
    'borrá el chat',
    'Capri, olvidá la conversación',
  ], [
    'no olvides nada',
    'no me olvido de vos',
    'borra la basura',
    'olvidate de mí',
  ]],
  [isWakeCommand, 'wake', [
    'despierta',
    'despertate',
    'despertá',
    'despertate ya',
    '¿estás ahí?',
    'Capri, despierta',
    'volviste',
  ], [
    'buenos días',
    '¿dormiste bien?',
    'despertador',
    'estás ahí en la esquina',
  ]],
];

for (const [check, name, yes, no] of cases) {
  for (const text of yes) {
    test(`treats "${text}" as ${name}`, () => {
      assert.equal(check(text), true);
    });
  }
  for (const text of no) {
    test(`does not treat "${text}" as ${name}`, () => {
      assert.equal(check(text), false);
    });
  }
}

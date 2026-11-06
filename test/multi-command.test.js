'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { splitCommands, sleepLast, planMultiCommand } = require('../src/main/multi-command');
const { isDirectCommand } = require('../src/main/direct-match');
const { APPS } = require('./apps-fixture');

const isDirect = (part) => isDirectCommand(part, APPS);

test('splits on the connectors Whisper and the chat box write', () => {
  assert.deepEqual(splitCommands('ve a dormir y minimiza todo'), ['ve a dormir', 'minimiza todo']);
  assert.deepEqual(splitCommands('ve a dormir, minimiza todo'), ['ve a dormir', 'minimiza todo']);
  assert.deepEqual(splitCommands('ve a dormir; minimiza todo'), ['ve a dormir', 'minimiza todo']);
  assert.deepEqual(splitCommands('ve a dormir luego minimiza todo'), ['ve a dormir', 'minimiza todo']);
  assert.deepEqual(splitCommands('ve a dormir después minimiza todo'), ['ve a dormir', 'minimiza todo']);
  assert.deepEqual(splitCommands('ve a dormir despues minimiza todo'), ['ve a dormir', 'minimiza todo']);
  assert.deepEqual(splitCommands('ve a dormir y luego minimiza todo'), ['ve a dormir', 'minimiza todo']);
});

test('a single order is left whole', () => {
  assert.deepEqual(splitCommands('ve a dormir'), ['ve a dormir']);
  assert.deepEqual(splitCommands('  '), []);
  // a sentence with too many connectors is not a list of orders
  assert.deepEqual(splitCommands('uno y dos y tres y cuatro y cinco'), ['uno y dos y tres y cuatro y cinco']);
});

test('sleep runs last, said first or last', () => {
  assert.deepEqual(
    planMultiCommand('ve a dormir y minimiza todo', isDirect),
    ['minimiza todo', 've a dormir'],
  );
  assert.deepEqual(
    planMultiCommand('minimiza todo y ve a dormir', isDirect),
    ['minimiza todo', 've a dormir'],
  );
  assert.deepEqual(
    planMultiCommand('minimiza todo, ve a dormir y bloquea la pc', isDirect),
    ['minimiza todo', 'bloquea la pc', 've a dormir'],
  );
  assert.deepEqual(sleepLast(['ve a dormir', 'minimiza todo']), ['minimiza todo', 've a dormir']);
});

test('a single direct order is not a multi-command', () => {
  assert.equal(planMultiCommand('ve a dormir', isDirect), null);
  assert.equal(planMultiCommand('minimiza todo', isDirect), null);
});

test('every part must be direct: no partial execution', () => {
  // "Spotify" alone is not an order (the whole line is her "abre Discord y Spotify" app call)
  assert.equal(planMultiCommand('abre Discord y Spotify', isDirect), null);
  assert.equal(planMultiCommand('saluda y ve a dormir', isDirect), null);
  // "ve y duerme" is the sleep order itself, not "ve" + "duerme"
  assert.equal(planMultiCommand('ve y duerme', isDirect), null);
  assert.deepEqual(planMultiCommand('abre Discord y cierra Spotify', isDirect), ['abre Discord', 'cierra Spotify']);
});

test('a "y" inside an app name does not split it into orders', () => {
  const apps = [...APPS, { name: 'Dungeons y Dragons', type: 'program', target: 'C:\\Games\\DD.exe', processes: ['DD'] }];
  const direct = (part) => isDirectCommand(part, apps);
  assert.equal(planMultiCommand('abre Dungeons y Dragons', direct), null);
});

test('only direct commands count as parts', () => {
  assert.equal(isDirect('minimiza todo'), true);
  assert.equal(isDirect('ve a dormir'), true);
  assert.equal(isDirect('bloquea la pc'), true);
  assert.equal(isDirect('abre Discord'), true);
  assert.equal(isDirect('Spotify'), false);
  assert.equal(isDirect('saluda'), false);
});

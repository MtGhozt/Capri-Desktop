'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { POOLS, AVOID, pickLine, fillLine, resetLines } = require('../src/main/lines-es');

const KINDS = ['dormir', 'despertar', 'clip', 'mute', 'unmute', 'olvidar', 'corregir', 'corregirOtraVez', 'olvidarCorreccion', 'sinCorreccion'];

test('every direct command has a pool of 8 to 10 lines', () => {
  for (const kind of KINDS) {
    assert.ok(Array.isArray(POOLS[kind]), `missing pool: ${kind}`);
    assert.ok(
      POOLS[kind].length >= 8 && POOLS[kind].length <= 10,
      `${kind} has ${POOLS[kind].length} lines`,
    );
    for (const line of POOLS[kind]) {
      assert.equal(typeof line, 'string');
      assert.ok(line.trim().length > 0, `${kind} has an empty line`);
    }
    assert.equal(new Set(POOLS[kind]).size, POOLS[kind].length, `${kind} repeats a line`);
  }
});

test('never repeats any of the last three lines of the same command', () => {
  resetLines();
  const picks = [];
  for (let i = 0; i < 300; i += 1) {
    const line = pickLine('dormir');
    assert.ok(POOLS.dormir.includes(line));
    for (const before of picks.slice(-AVOID)) assert.notEqual(line, before);
    picks.push(line);
  }
  assert.equal(new Set(picks).size, POOLS.dormir.length); // it still uses the whole pool
});

test('keeps the three out of play even when the draw is always the first one left', () => {
  resetLines();
  const picks = [];
  for (let i = 0; i < 40; i += 1) {
    const line = pickLine('clip', () => 0);
    for (const before of picks.slice(-AVOID)) assert.notEqual(line, before);
    picks.push(line);
  }
});

test('each command keeps its own history', () => {
  resetLines();
  assert.equal(pickLine('clip', () => 0), POOLS.clip[0]);
  assert.equal(pickLine('dormir', () => 0), POOLS.dormir[0]);
  // the clip history has clip[0] in it, the dormir history is untouched by it
  assert.equal(pickLine('clip', () => 0), POOLS.clip[1]);
  assert.equal(pickLine('dormir', () => 0), POOLS.dormir[1]);
});

test('a pool smaller than the window still gives a line', () => {
  // you can trim a pool while editing lines-es.js; she should never go silent over it
  resetLines();
  const saved = POOLS.mute;
  POOLS.mute = saved.slice(0, 2);
  try {
    for (let i = 0; i < 10; i += 1) assert.ok(POOLS.mute.includes(pickLine('mute')));
  } finally {
    POOLS.mute = saved;
    resetLines();
  }
});

test('an unknown command is a mistake, not a silent line', () => {
  assert.throws(() => pickLine('banana'), /unknown command line pool/);
});

test('fix lines name what she heard and what you meant', () => {
  for (const kind of ['corregir', 'corregirOtraVez', 'olvidarCorreccion', 'sinCorreccion']) {
    for (const line of POOLS[kind]) {
      const said = fillLine(line, { heard: 'jarbis', meant: 'Jarvis' });
      assert.ok(!/[{}]/.test(said), `${kind}: ${said}`);
    }
  }
  assert.equal(fillLine('«{heard}» es «{meant}» {other}', { heard: 'a', meant: 'b' }), '«a» es «b» {other}');
});

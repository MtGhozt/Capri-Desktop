'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { POOLS, pickLine, resetLines } = require('../src/main/lines-es');

const QUESTIONS = ['appQuisiste', 'appConfirmar', 'appForzar'];
const STATEMENTS = ['appAbrir', 'appAbrirVarias', 'appCerrar', 'appNoEncontrada', 'appFallo', 'appCancelado', 'appNoCorre', 'appProhibido', 'appNoCerrable'];

test('her app lines: 8 to 10 each, questions only where she waits for an answer', () => {
  for (const kind of [...QUESTIONS, ...STATEMENTS]) {
    assert.ok(POOLS[kind]?.length >= 8 && POOLS[kind].length <= 10, kind);
    for (const line of POOLS[kind]) {
      // a "?" at the end opens the mic for the answer (4B): only the questions may do it
      assert.equal(/\?\s*$/.test(line), QUESTIONS.includes(kind), `${kind}: ${line}`);
    }
  }
  for (const line of POOLS.appQuisiste) assert.match(line, /\{apps\}/);
  for (const line of POOLS.appAbrir) assert.match(line, /\{app\}/);
});

test('never one of the last three again', () => {
  resetLines?.();
  const seen = [];
  for (let i = 0; i < 40; i++) {
    const line = pickLine('appAbrir');
    assert.ok(!seen.slice(-3).includes(line), line);
    seen.push(line);
  }
});

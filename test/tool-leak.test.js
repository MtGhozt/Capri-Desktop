'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { absorbToolCall, TOOL_LEAK_LINE } = require('../src/main/mood-tag');

test('exact leaked tool JSON is hidden with the error line', () => {
  const raw = '{"name": "no_se_pueden_crear_archivos", "parameters": {}}';
  const leak = absorbToolCall(raw);
  assert.ok(leak);
  assert.equal(leak.text, TOOL_LEAK_LINE);
  assert.equal(leak.action, null);
  assert.equal(leak.unknown, true);
  assert.equal(leak.raw, raw);
});

test('fenced tool-call JSON is absorbed the same way', () => {
  const leak = absorbToolCall('```json\n{"name": "no_se_pueden_crear_archivos", "parameters": {}}\n```');
  assert.ok(leak);
  assert.equal(leak.text, TOOL_LEAK_LINE);
  assert.equal(leak.unknown, true);
  assert.match(leak.raw, /no_se_pueden_crear_archivos/);
});

test('known Capri tool names map to reply actions and stay silent', () => {
  assert.deepEqual(
    absorbToolCall('{"name":"volume","parameters":{"value":"mute"}}'),
    {
      raw: '{"name":"volume","parameters":{"value":"mute"}}',
      action: { kind: 'volume', value: 'mute' },
      text: '',
      unknown: false,
    },
  );
  assert.deepEqual(
    absorbToolCall('{"name":"theme","arguments":{"mode":"dark"}}').action,
    { kind: 'theme', value: 'dark' },
  );
  assert.deepEqual(
    absorbToolCall('{"tool_calls":[{"name":"volume","parameters":{"level":30}}]}').action,
    { kind: 'volume', value: '30' },
  );
});

test('normal replies and JSON inside prose are untouched', () => {
  assert.equal(absorbToolCall('Hola choom, ¿cómo andás?'), null);
  assert.equal(
    absorbToolCall('Usa {"name": "no_se_pueden_crear_archivos", "parameters": {}} en el código.'),
    null,
  );
  assert.equal(absorbToolCall('El resultado fue {ok: true} más o menos.'), null);
  assert.equal(absorbToolCall('[emocion] ¡Dale!'), null);
});

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cleanText, createStreamCleaner } = require('../src/main/chat-text');
const { sidecarConfig } = require('../src/main/voice-config');

test('cloud text loses the safety verdict, the thinking and the Markdown', () => {
  const out = cleanText('User safety: safe\n<think>plan it</think>**Hola**, humanito.');
  assert.doesNotMatch(out, /safety|think|plan it|\*/i);
  assert.match(out, /Hola, humanito\./);
});

test('the stream is cleaned as it arrives, even split mid-tag', () => {
  let said = '';
  const c = createStreamCleaner({ onText: (t) => { said += t; } });
  for (const p of ['User safety: safe\n<th', 'ink>hmm</think>', '**Ya** lo ', 'hice. ', '*Listo*.']) c.push(p);
  c.flush();
  assert.doesNotMatch(said, /safety|hmm|\*|<|>/i);
  assert.match(said, /Ya lo hice\./);
});

test('with a cloud provider the sidecar keeps no VRAM for Gemma', () => {
  assert.equal(sidecarConfig({ llm: { provider: 'openrouter' } }).localLlm, false);
  assert.equal(sidecarConfig({ llm: { provider: 'local' } }).localLlm, true);
  assert.equal(sidecarConfig({}).localLlm, true);
});

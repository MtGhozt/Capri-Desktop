'use strict';

// Paso 4K: who answers her. Each provider's request, built by hand (no network here), and the
// sentences her failures turn into. The key only ever rides in the Authorization header.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  PROVIDERS, providerOptions, provider, isCloud, requestFor, explain,
} = require('../src/main/chat-providers');

const LOCAL = 'http://localhost:1235/v1';

test('the seven providers she offers: LM Studio and six in the cloud', () => {
  assert.deepEqual(Object.keys(PROVIDERS).sort(), [
    'deepseek', 'gemini', 'groq', 'local', 'mistral', 'openai', 'openrouter',
  ]);
  assert.deepEqual(providerOptions().map((p) => p.id), ['local', 'openrouter', 'groq', 'gemini', 'openai', 'mistral', 'deepseek']);
  assert.equal(isCloud('local'), false);
  for (const id of ['openrouter', 'groq', 'gemini', 'openai', 'mistral', 'deepseek']) assert.equal(isCloud(id), true, id);
  assert.equal(provider('nope').local, true); // an unknown id never sends anything to the web
});

test("the local request goes to LM Studio's port, no key, and asks Gemma not to think out loud", () => {
  const req = requestFor('local', { model: 'google/gemma-4-e2b', messages: [{ role: 'user', content: 'hey' }], baseUrl: LOCAL });
  assert.equal(req.url, `${LOCAL}/chat/completions`);
  assert.equal(req.headers.Authorization, undefined);
  assert.equal(req.body.model, 'google/gemma-4-e2b');
  assert.equal(req.body.stream, true);
  assert.equal(req.body.reasoning_effort, 'none');
});

test('each cloud provider gets its own address, and the key, and nothing else', () => {
  const expected = {
    openrouter: 'https://openrouter.ai/api/v1/chat/completions',
    groq: 'https://api.groq.com/openai/v1/chat/completions',
    gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    openai: 'https://api.openai.com/v1/chat/completions',
    mistral: 'https://api.mistral.ai/v1/chat/completions',
    deepseek: 'https://api.deepseek.com/v1/chat/completions',
  };
  for (const [id, url] of Object.entries(expected)) {
    const req = requestFor(id, { messages: [], key: 'sk-secret', baseUrl: LOCAL });
    assert.equal(req.url, url, id);
    assert.equal(req.headers.Authorization, 'Bearer sk-secret', id);
    assert.equal(req.body.stream, true, id);
    assert.equal(req.body.reasoning_effort, undefined, id); // a field they don't know can cost a 400
    assert.equal(req.body.model, PROVIDERS[id].model, id);
    assert.ok(!JSON.stringify(req.body).includes('sk-secret'), id); // the key never travels in the body
  }
});

test('a trailing slash in the address never doubles up', () => {
  assert.equal(
    requestFor('openai', { messages: [], baseUrl: LOCAL }).url,
    'https://api.openai.com/v1/chat/completions',
  );
  assert.equal(requestFor('local', { messages: [], baseUrl: `${LOCAL}/` }).url, `${LOCAL}/chat/completions`);
});

test('OpenRouter keeps the exact provider/model name it was given', () => {
  const req = requestFor('openrouter', { model: 'meta-llama/llama-3.3-70b-instruct', messages: [] });
  assert.equal(req.body.model, 'meta-llama/llama-3.3-70b-instruct');
});

test('what went wrong, in a sentence and in Spanish', () => {
  assert.match(explain({ status: 401 }, 'openai'), /clave de OpenAI no sirve/);
  assert.match(explain({ status: 403 }, 'groq'), /clave de Groq/);
  assert.match(explain({ status: 429 }, 'gemini'), /Gemini está saturada/);
  assert.match(explain({ status: 404 }, 'openrouter'), /Ese modelo no existe en OpenRouter/);
  assert.match(explain({ status: 503 }, 'mistral'), /problemas ahora mismo/);
  assert.match(explain({ offline: true }, 'deepseek'), /No hay conexión con DeepSeek/);
  assert.match(explain({ code: 'empty' }, 'local'), /LM Studio no contestó nada/);
  assert.match(explain({ status: 418 }, 'openai'), /no entendí \(418\)/);
});

test('no sentence ever repeats what the server said or the key', () => {
  const err = Object.assign(new Error('{"error":"Incorrect API key provided: sk-secret"}'), { status: 401 });
  const said = explain(err, 'openai');
  assert.ok(!said.includes('sk-secret'));
  assert.ok(!said.includes('{'));
});

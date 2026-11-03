'use strict';

// Who answers her. Each provider's request, built by hand (no network here), and the
// sentences her failures turn into. The key only ever rides in the Authorization header.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  PROVIDERS, BRAIN_GROUPS, FREE_KEY_LINKS, OWN_KEY_LINKS, providerOptions, provider, isCloud, usesLms, activeBrainIds,
  defaultBaseUrl, requestFor, explain, providerAfterKeyRemoved, supportsVision,
} = require('../src/main/chat-providers');

const LOCAL = 'http://localhost:1235/v1';
const OLLAMA = 'http://localhost:11434/v1';

test('providers: two local, free NVIDIA/Gemini, own-key clouds, and agent CLIs', () => {
  assert.ok(PROVIDERS.anthropic);
  assert.ok(PROVIDERS.xai);
  assert.ok(PROVIDERS['agent-claude']);
  assert.ok(PROVIDERS['agent-opencode']);
  assert.ok(PROVIDERS['agent-cursor']);
  assert.ok(PROVIDERS['agent-codex']);
  assert.ok(PROVIDERS['agent-gemini']);
  assert.equal(PROVIDERS['agent-auto'].label, 'Automático');
  assert.equal(isCloud('local'), false);
  assert.equal(isCloud('ollama'), false);
  assert.equal(isCloud('nvidia'), true);
  assert.equal(isCloud('agent-claude'), false);
  assert.equal(defaultBaseUrl('ollama'), OLLAMA);
  assert.equal(defaultBaseUrl('local'), LOCAL);
  assert.equal(provider('nope').local, true);
  assert.deepEqual(BRAIN_GROUPS.free, ['gemini', 'nvidia']);
  assert.equal(BRAIN_GROUPS.free[0], 'gemini'); // recommended free path first
  assert.deepEqual(BRAIN_GROUPS.local, ['local', 'ollama']);
  assert.ok(BRAIN_GROUPS.own.includes('openai'));
  assert.ok(BRAIN_GROUPS.own.includes('anthropic'));
  assert.ok(BRAIN_GROUPS.own.includes('xai'));
  assert.deepEqual(BRAIN_GROUPS.agent, [
    'agent-auto', 'agent-claude', 'agent-cursor', 'agent-opencode', 'agent-codex', 'agent-gemini',
  ]);
  assert.equal(FREE_KEY_LINKS.nvidia.url, 'https://build.nvidia.com/');
  assert.equal(FREE_KEY_LINKS.gemini.url, 'https://aistudio.google.com/apikey');
  assert.equal(FREE_KEY_LINKS.gemini.recommended, true); // UI: ★ on link, "recomendado" only on Gemini chip
  assert.equal(FREE_KEY_LINKS.nvidia.recommended, undefined);
  assert.deepEqual(providerOptions().map((p) => p.id), Object.keys(PROVIDERS));
});

test('vision flag: Gemini/OpenAI yes; agents and plain local Gemma no', () => {
  assert.equal(supportsVision('gemini', 'gemini-flash-lite-latest'), true);
  assert.equal(supportsVision('openai', 'gpt-4o-mini'), true);
  assert.equal(supportsVision('agent-claude', 'agent'), false);
  assert.equal(supportsVision('local', 'google/gemma-4-e2b'), false);
  assert.equal(supportsVision('local', 'llava-1.6'), true);
  assert.equal(PROVIDERS.gemini.vision, true);
});

test('active brains preserve order and fall back to the configured provider', () => {
  assert.deepEqual(activeBrainIds({ brains: ['gemini', 'agent-cursor', 'local'] }), ['gemini', 'agent-cursor', 'local']);
  assert.deepEqual(activeBrainIds({ provider: 'gemini' }), ['gemini']);
});

test('brain cards expose one key/model provider and the default order keeps LM Studio last', () => {
  assert.deepEqual(BRAIN_GROUPS.cards, ['gemini', 'nvidia', 'openai', 'anthropic', 'deepseek', 'openrouter', 'xai', 'local']);
  assert.equal(FREE_KEY_LINKS.gemini.url, 'https://aistudio.google.com/apikey');
  assert.ok(OWN_KEY_LINKS.deepseek.url);
  assert.ok(OWN_KEY_LINKS.openrouter.url);
  assert.ok(OWN_KEY_LINKS.xai.url);
});

test('LM Studio is only booted and waited for when it is the one who answers', () => {
  assert.equal(usesLms('local'), true);
  assert.equal(usesLms(undefined), true); // no provider set = default, LM Studio
  assert.equal(usesLms('ollama'), false); // its own server
  assert.equal(usesLms('agent-claude'), false);
  assert.equal(usesLms('agent-auto'), false);
  assert.equal(usesLms('agent-opencode'), false);
  assert.equal(usesLms('gemini'), false);
  // unchanged: an agent answers on this PC even though LM Studio is not needed
  assert.equal(isCloud('agent-claude'), false);
});

test("LM Studio request: home port, no key, Gemma must not think out loud", () => {
  const req = requestFor('local', { model: 'google/gemma-4-e2b', messages: [{ role: 'user', content: 'hey' }], baseUrl: LOCAL });
  assert.equal(req.url, `${LOCAL}/chat/completions`);
  assert.equal(req.headers.Authorization, undefined);
  assert.equal(req.body.stream, true);
  assert.equal(req.body.reasoning_effort, 'none');
});

test('Ollama uses its OpenAI-compatible port by default', () => {
  const req = requestFor('ollama', { messages: [{ role: 'user', content: 'hey' }] });
  assert.equal(req.url, `${OLLAMA}/chat/completions`);
  assert.equal(req.headers.Authorization, undefined);
  assert.equal(req.body.model, 'llama3.2');
});

test('NVIDIA points at integrate.api.nvidia.com with the key in the header only', () => {
  const req = requestFor('nvidia', { messages: [], key: 'nvapi-secret' });
  assert.equal(req.url, 'https://integrate.api.nvidia.com/v1/chat/completions');
  assert.equal(req.headers.Authorization, 'Bearer nvapi-secret');
  assert.equal(req.body.model, 'meta/llama-3.1-8b-instruct');
  assert.ok(!JSON.stringify(req.body).includes('nvapi-secret'));
});

test('each cloud provider gets its own address, and the key, and nothing else', () => {
  const expected = {
    openrouter: 'https://openrouter.ai/api/v1/chat/completions',
    groq: 'https://api.groq.com/openai/v1/chat/completions',
    gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    openai: 'https://api.openai.com/v1/chat/completions',
    anthropic: 'https://api.anthropic.com/v1/chat/completions',
    xai: 'https://api.x.ai/v1/chat/completions',
    mistral: 'https://api.mistral.ai/v1/chat/completions',
    deepseek: 'https://api.deepseek.com/v1/chat/completions',
    nvidia: 'https://integrate.api.nvidia.com/v1/chat/completions',
  };
  for (const [id, url] of Object.entries(expected)) {
    const req = requestFor(id, { messages: [], key: 'sk-secret', baseUrl: LOCAL });
    assert.equal(req.url, url, id);
    assert.equal(req.headers.Authorization, 'Bearer sk-secret', id);
    assert.equal(req.body.stream, true, id);
    assert.equal(req.body.reasoning_effort, undefined, id);
    assert.equal(req.body.model, PROVIDERS[id].model, id);
    assert.ok(!JSON.stringify(req.body).includes('sk-secret'), id);
    if (id === 'anthropic') assert.equal(req.headers['anthropic-version'], '2023-06-01');
  }
});

test('probe can ask for a non-streaming mini request', () => {
  const req = requestFor('openai', { messages: [], key: 'x', stream: false });
  assert.equal(req.body.stream, false);
});

test('a trailing slash in the address never doubles up', () => {
  assert.equal(
    requestFor('openai', { messages: [], baseUrl: LOCAL }).url,
    'https://api.openai.com/v1/chat/completions',
  );
  assert.equal(requestFor('local', { messages: [], baseUrl: `${LOCAL}/` }).url, `${LOCAL}/chat/completions`);
});

test('what went wrong, in a sentence and in Spanish', () => {
  assert.match(explain({ status: 401 }, 'openai'), /Key inválida/);
  assert.match(explain({ status: 403 }, 'groq'), /Key inválida/);
  assert.match(explain({ status: 429 }, 'gemini'), /Gemini está saturada/);
  assert.match(explain({ status: 404 }, 'openrouter'), /Ese modelo no existe en OpenRouter/);
  assert.match(explain({ status: 503 }, 'mistral'), /problemas ahora mismo/);
  assert.match(explain({ offline: true }, 'deepseek'), /No hay conexión con DeepSeek/);
  assert.match(explain({ offline: true }, 'ollama'), /Ollama no está abierto/);
  assert.match(explain({ offline: true }, 'local'), /LM Studio no está abierto/);
  assert.match(explain({ code: 'empty' }, 'local'), /LM Studio no contestó nada/);
  assert.match(explain({ status: 418 }, 'openai'), /no entendí \(418\)/);
});

test('no sentence ever repeats what the server said or the key', () => {
  const err = Object.assign(new Error('{"error":"Incorrect API key provided: sk-secret"}'), { status: 401 });
  const said = explain(err, 'openai');
  assert.ok(!said.includes('sk-secret'));
  assert.ok(!said.includes('{'));
});

test('removing the active provider key moves to the first one that still has a key', () => {
  const saved = { gemini: true, anthropic: true };
  // anthropic was answering, its key is gone: Gemini (free, first) answers
  assert.equal(providerAfterKeyRemoved('anthropic', 'anthropic', (id) => saved[id] && id !== 'anthropic'), 'gemini');
  // nobody else has one: back to LM Studio
  assert.equal(providerAfterKeyRemoved('anthropic', 'anthropic', () => false), 'local');
  // a key that was not the one answering changes nothing
  assert.equal(providerAfterKeyRemoved('gemini', 'anthropic', () => false), 'gemini');
});

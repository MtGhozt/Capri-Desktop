'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { probeProvider } = require('../src/main/llm-probe');
const { needsModelSetup, SETUP_HINT } = require('../src/main/setup');

test('first-run hint is needed only without keys and without a local LLM', () => {
  assert.equal(needsModelSetup({ hasAnyKey: false, localReachable: false }), true);
  assert.equal(needsModelSetup({ hasAnyKey: true, localReachable: false }), false);
  assert.equal(needsModelSetup({ hasAnyKey: false, localReachable: true }), false);
  assert.match(SETUP_HINT, /cerebro/i);
  assert.match(SETUP_HINT, /Probar/);
});

test('probe ok: non-streaming reply, key never appears in the message', async () => {
  const key = 'sk-secret-do-not-leak';
  const fetchImpl = async (url, init) => {
    assert.match(url, /openai\.com/);
    const body = JSON.parse(init.body);
    assert.equal(body.stream, false);
    assert.ok(!JSON.stringify(body).includes(key));
    assert.equal(init.headers.Authorization, `Bearer ${key}`);
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    };
  };
  const res = await probeProvider({ id: 'openai', key, fetchImpl });
  assert.equal(res.ok, true);
  assert.match(res.message, /OpenAI contesta/);
  assert.ok(!res.message.includes(key));
});

test('probe: missing cloud key fails before network', async () => {
  let called = false;
  const res = await probeProvider({
    id: 'gemini',
    key: '',
    fetchImpl: async () => { called = true; return { ok: false, status: 500 }; },
  });
  assert.equal(called, false);
  assert.equal(res.ok, false);
  assert.match(res.message, /Falta la key/);
});

test('probe: 401 becomes key inválida without server JSON', async () => {
  const res = await probeProvider({
    id: 'nvidia',
    key: 'bad',
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'Incorrect API key: bad' } }),
    }),
  });
  assert.equal(res.ok, false);
  assert.match(res.message, /Key inválida/);
  assert.ok(!res.message.includes('bad'));
  assert.ok(!res.message.includes('Incorrect'));
});

test('probe: Ollama offline uses the friendly local line', async () => {
  const res = await probeProvider({
    id: 'ollama',
    fetchImpl: async () => { throw new Error('ECONNREFUSED'); },
  });
  assert.equal(res.ok, false);
  assert.match(res.message, /Ollama no está abierto/);
});

test('probe: LM Studio offline uses its own line', async () => {
  const res = await probeProvider({
    id: 'local',
    baseUrl: 'http://localhost:1235/v1',
    fetchImpl: async () => { throw new Error('fetch failed'); },
  });
  assert.equal(res.ok, false);
  assert.match(res.message, /LM Studio no está abierto/);
});

test('probe: empty choices count as empty reply', async () => {
  const res = await probeProvider({
    id: 'openai',
    key: 'sk',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: '  ' } }] }),
    }),
  });
  assert.equal(res.ok, false);
  assert.match(res.message, /no contestó nada/);
});

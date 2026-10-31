'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { switchProvider, setProviderModel, modelForProvider } = require('../src/main/chat-models');
const { PROVIDERS } = require('../src/main/chat-providers');

const providers = {
  local: { model: 'google/gemma-4-e2b', local: true },
  openrouter: { model: 'openai/gpt-4o-mini', local: false },
};

test('remembers the last model independently for each provider', () => {
  let cfg = { provider: 'openrouter', model: 'openrouter/free', models: {} };
  cfg = switchProvider(cfg, 'local', providers);
  assert.equal(cfg.model, 'google/gemma-4-e2b');
  cfg = setProviderModel(cfg, 'local', 'google/gemma-3-4b');
  cfg = switchProvider(cfg, 'openrouter', providers);
  assert.equal(cfg.model, 'openrouter/free');
  assert.equal(modelForProvider(cfg, 'local', providers), 'google/gemma-3-4b');
});

test('switching provider uses that provider default, not the previous model', () => {
  let cfg = { provider: 'gemini', model: PROVIDERS.gemini.model, models: {} };
  cfg = switchProvider(cfg, 'nvidia', PROVIDERS);
  assert.equal(cfg.model, PROVIDERS.nvidia.model);
  assert.notEqual(cfg.model, PROVIDERS.gemini.model);
  cfg = switchProvider(cfg, 'ollama', PROVIDERS);
  assert.equal(cfg.model, PROVIDERS.ollama.model);
  cfg = setProviderModel(cfg, 'ollama', 'gemma2:2b');
  cfg = switchProvider(cfg, 'nvidia', PROVIDERS);
  assert.equal(cfg.model, PROVIDERS.nvidia.model);
  cfg = switchProvider(cfg, 'ollama', PROVIDERS);
  assert.equal(cfg.model, 'gemma2:2b');
});

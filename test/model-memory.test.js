'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { switchProvider, setProviderModel, modelForProvider } = require('../src/main/chat-models');
const { PROVIDERS } = require('../src/main/chat-providers');
const { migrateBrainOrder, migrateGeminiModel } = require('../src/main/config');

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

test('modelForProvider never falls back to another provider current model', () => {
  const isolated = {
    local: { model: 'gemma-default' },
    gemini: { model: 'gemini-default' },
  };
  assert.equal(modelForProvider({
    provider: 'gemini', model: 'gemini-custom', models: {}, localModel: 'local-custom',
  }, 'local', isolated), 'local-custom');
  assert.equal(modelForProvider({
    provider: 'local', model: 'local-custom', models: {},
  }, 'gemini', isolated), 'gemini-default');
});

test('legacy local-only brain order migrates to cloud first and local last', () => {
  const migrated = migrateBrainOrder({ brains: ['local', 'openai'] });
  assert.deepEqual(migrated.llm.brains, ['gemini', 'openai', 'local']);
  assert.equal(migrated.llm.brainOrderMigrated, true);
});

test('brain order migration runs once and preserves a later user reorder', () => {
  const migrated = migrateBrainOrder({ brains: ['local', 'gemini'] });
  assert.deepEqual(migrated.llm.brains, ['gemini', 'local']);
  assert.deepEqual(
    migrateBrainOrder({ brains: ['local', 'gemini'], brainOrderMigrated: true }).llm.brains,
    ['local', 'gemini'],
  );
});

test('saved gemini-flash-latest moves back to flash-lite', () => {
  const migrated = migrateGeminiModel({
    provider: 'gemini',
    model: 'gemini-flash-latest',
    models: { gemini: 'gemini-flash-latest' },
  });
  assert.equal(migrated.changed, true);
  assert.equal(migrated.llm.model, 'gemini-flash-lite-latest');
  assert.equal(migrated.llm.models.gemini, 'gemini-flash-lite-latest');

  // a saved model for a provider that is not answering also moves
  const inactive = migrateGeminiModel({
    provider: 'xai',
    model: 'grok-4-1-fast-non-reasoning',
    models: { gemini: 'gemini-flash-latest' },
  });
  assert.equal(inactive.llm.models.gemini, 'gemini-flash-lite-latest');
  assert.equal(inactive.llm.model, 'grok-4-1-fast-non-reasoning');
});

test('a hand-picked gemini model is left alone', () => {
  const custom = migrateGeminiModel({
    provider: 'gemini',
    model: 'gemini-2.5-pro',
    models: { gemini: 'gemini-2.5-pro' },
  });
  assert.equal(custom.changed, false);
  assert.equal(custom.llm.model, 'gemini-2.5-pro');
  assert.equal(custom.llm.models.gemini, 'gemini-2.5-pro');
});

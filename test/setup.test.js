'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PROVIDERS } = require('../src/main/chat-providers');
const { needsModelSetup, SETUP_HINT } = require('../src/main/setup');

test('Gemini default model is the flash-lite latest id', () => {
  assert.equal(PROVIDERS.gemini.model, 'gemini-flash-lite-latest');
});

test('setup hint is needed only without keys and without a local LLM', () => {
  assert.equal(needsModelSetup({ hasAnyKey: false, localReachable: false }), true);
  assert.equal(needsModelSetup({ hasAnyKey: true, localReachable: false }), false);
  assert.equal(needsModelSetup({ hasAnyKey: false, localReachable: true }), false);
  assert.match(SETUP_HINT, /aistudio\.google\.com\/apikey/);
});

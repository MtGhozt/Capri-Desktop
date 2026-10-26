'use strict';

// Mute contract: with the microphone off the sidecar gets enabled:false (no stream, no wake
// word) while spoken replies, typed chat and the input device stay exactly as they were.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { micActive, sidecarConfig } = require('../src/main/voice-config');

const base = () => ({
  muted: false,
  volume: 0.7,
  llm: { baseUrl: 'http://localhost:1235/v1' },
  voice: {
    enabled: true,
    wakeWord: true,
    inputDevice: 3,
    replyMode: 'voice',
    tts: 'auto',
  },
});

test('mic is active unless voice.enabled is exactly false', () => {
  assert.equal(micActive(base()), true);
  assert.equal(micActive({ voice: {} }), true);
  const muted = base();
  muted.voice.enabled = false;
  assert.equal(micActive(muted), false);
});

test('muting the mic reaches the sidecar as enabled:false', () => {
  const cfg = base();
  cfg.voice.enabled = false;
  const sent = sidecarConfig(cfg);
  assert.equal(sent.enabled, false);
  assert.equal(sent.wakeWord, true); // ignored anyway: the stream is gone
  assert.equal(sent.inputDevice, 3);
});

test('muting the mic does not silence her replies', () => {
  const cfg = base();
  cfg.voice.enabled = false;
  const sent = sidecarConfig(cfg);
  assert.equal(sent.replyMode, 'voice');
  assert.equal(sent.tts, 'auto');
  assert.equal(sent.muted, false);
});

test('the sidecar config carries the speaker mute and the llm url', () => {
  const cfg = base();
  cfg.muted = true;
  const sent = sidecarConfig(cfg);
  assert.equal(sent.muted, true);
  assert.equal(sent.llmBaseUrl, 'http://localhost:1235/v1');
});

test('folding her into DORMANT reaches the sidecar as sleeping:true', () => {
  assert.equal(sidecarConfig(base()).sleeping, false);
  assert.equal(sidecarConfig(base(), { sleeping: true }).sleeping, true);
  assert.equal(sidecarConfig(base(), { sleeping: false }).sleeping, false);
});

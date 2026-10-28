'use strict';

// What the voice sidecar receives in its `config` message. The microphone lives in
// voice.enabled: off means the sidecar drops the stream (no audio, no wake word) while
// TTS and typing keep working. `sleeping` lets it release TTS after a long DORMANT spell.

const { isCloud } = require('./chat-providers');

function micActive(cfg) {
  return cfg?.voice?.enabled !== false;
}

function sidecarConfig(cfg, state = {}) {
  return {
    ...(cfg?.voice || {}),
    enabled: micActive(cfg),
    muted: Boolean(cfg?.muted),
    volume: cfg?.volume,
    sleeping: Boolean(state.sleeping),
    llmBaseUrl: cfg?.llm?.baseUrl || 'http://localhost:1235/v1',
    // With a cloud provider no local model is ever loaded, so the sidecar must not keep VRAM free
    // for Gemma: it was skipping OmniVoice (her real voice) and answering in Kokoro's instead.
    localLlm: !isCloud(cfg?.llm?.provider),
  };
}

module.exports = { micActive, sidecarConfig };

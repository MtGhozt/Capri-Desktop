'use strict';

// What the voice sidecar receives in its `config` message. The microphone lives in
// voice.enabled: off means the sidecar drops the stream (no audio, no wake word) while
// TTS and typing keep working. `sleeping` lets it release TTS after a long DORMANT spell.

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
  };
}

module.exports = { micActive, sidecarConfig };

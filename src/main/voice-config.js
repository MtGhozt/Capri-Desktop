'use strict';

// What the voice sidecar receives in its `config` message. The microphone lives in
// voice.enabled: off means the sidecar drops the stream (no audio, no wake word) while
// TTS and typing keep working.

function micActive(cfg) {
  return cfg?.voice?.enabled !== false;
}

function sidecarConfig(cfg) {
  return {
    ...(cfg?.voice || {}),
    enabled: micActive(cfg),
    muted: Boolean(cfg?.muted),
    volume: cfg?.volume,
    llmBaseUrl: cfg?.llm?.baseUrl || 'http://localhost:1235/v1',
  };
}

module.exports = { micActive, sidecarConfig };

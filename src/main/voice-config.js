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

// Ajustes › AUDIO says why she is quiet when you asked for VOZ, instead of staying silent.
// A loading engine is not a failure: it gets its own wait line, and only a real one is reported.
function voiceStatus(cfg, { running = true, tts = null } = {}) {
  if (String(cfg?.voice?.replyMode || 'blips').toLowerCase() !== 'voice') return '';
  if (String(cfg?.voice?.tts || 'off').toLowerCase() === 'off') return 'Voz apagada: elegí VOZ de nuevo o una carpeta de voz.';
  if (!running) return 'El sidecar de voz no arrancó.';
  if (tts?.state === 'loading') return 'Cargando voz…';
  if (tts?.engine === 'off') return 'TTS no arrancó: revisá voice.log.';
  if (tts?.state === 'fallback') return 'Sin OmniVoice: habla con Kokoro.';
  return '';
}

module.exports = { micActive, sidecarConfig, voiceStatus };

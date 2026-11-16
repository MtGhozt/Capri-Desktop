'use strict';

// Suggest a voice / Whisper / animation profile from what this PC has. Capri never applies it
// alone: the bubble (or Ajustes › Comportamiento) asks, and only then we write config.

const os = require('node:os');
const { readVram } = require('./vram');

// One place for the thresholds.
const THRESHOLDS = {
  OMNI_VRAM_MB: 4096, // NVIDIA + this much total VRAM → OmniVoice CUDA
  LOW_RAM_MB: 8192,
  LOW_CORES: 4,
  WHISPER_OK: 'small',
  WHISPER_LOW: 'base',
};

function recommendProfile({ gpu, vramMB, ramMB, cores } = {}) {
  const nvidia = String(gpu || '').toLowerCase() === 'nvidia';
  const vram = Number(vramMB) || 0;
  const ram = Number(ramMB) || 0;
  const nCores = Number(cores) || 0;
  const voice = nvidia && vram >= THRESHOLDS.OMNI_VRAM_MB ? 'omnivoice-cuda' : 'kokoro';
  const low = (ram > 0 && ram < THRESHOLDS.LOW_RAM_MB) || (nCores > 0 && nCores < THRESHOLDS.LOW_CORES);
  const whisper = low ? THRESHOLDS.WHISPER_LOW : THRESHOLDS.WHISPER_OK;
  const lightAnimations = Boolean(low);
  const voiceLabel = voice === 'omnivoice-cuda' ? 'OmniVoice' : 'Kokoro';
  const reason = lightAnimations
    ? `${voiceLabel}, Whisper ${whisper}, animaciones ligeras`
    : `${voiceLabel}, Whisper ${whisper}`;
  return { voice, whisper, lightAnimations, reason };
}

function hardwareFingerprint({ gpu, vramMB, ramMB, cores } = {}) {
  return [
    String(gpu || 'none').toLowerCase(),
    Math.round(Number(vramMB) || 0),
    Math.round(Number(ramMB) || 0),
    Number(cores) || 0,
  ].join(':');
}

// nvidia-smi via readVram (same probe as voice-install); RAM/cores from os. Fail → null.
function detectHardware({ readVramImpl = readVram, osImpl = os } = {}) {
  try {
    const vram = readVramImpl?.() || null;
    const ramMB = Math.round((Number(osImpl.totalmem?.()) || 0) / (1024 * 1024));
    const cores = (osImpl.cpus?.() || []).length;
    if (!vram && !ramMB && !cores) return null;
    return {
      gpu: vram ? 'nvidia' : 'none',
      vramMB: vram?.totalMiB ?? 0,
      ramMB,
      cores,
    };
  } catch {
    return null;
  }
}

function ttsMatches(rec, tts) {
  const kind = String(tts || '').toLowerCase();
  if (rec.voice === 'omnivoice-cuda') return kind === 'omnivoice' || kind === 'auto';
  return kind === 'kokoro';
}

function matchesConfig(cfg, rec) {
  if (!rec) return true;
  const stt = String(cfg?.voice?.sttModel || 'auto').toLowerCase();
  const appsOn = cfg?.fx?.apps !== false;
  return ttsMatches(rec, cfg?.voice?.tts)
    && stt === rec.whisper
    && appsOn === !rec.lightAnimations;
}

// Only the keys the recommendation owns.
function applyPatch(rec) {
  return {
    voice: {
      tts: rec.voice === 'omnivoice-cuda' ? 'omnivoice' : 'kokoro',
      sttModel: rec.whisper,
    },
    fx: { apps: !rec.lightAnimations },
  };
}

function bubbleLine(rec) {
  const voice = rec.voice === 'omnivoice-cuda' ? 'OmniVoice' : 'Kokoro';
  let body = `voz ${voice} y Whisper ${rec.whisper}`;
  if (rec.lightAnimations) body += ' y animaciones ligeras';
  return `Tu PC rinde mejor con ${body}. ¿Lo aplico?`;
}

function shouldOfferBubble({
  cfg, rec, hw, force = false, firstRun = false, gameQuiet = false,
} = {}) {
  if (!rec || !hw) return false;
  if (gameQuiet) return false;
  if (!force && firstRun) return false;
  if (matchesConfig(cfg, rec)) return false;
  if (!force && cfg?.profile?.dismissedHw === hardwareFingerprint(hw)) return false;
  return true;
}

module.exports = {
  THRESHOLDS,
  recommendProfile,
  hardwareFingerprint,
  detectHardware,
  matchesConfig,
  applyPatch,
  bubbleLine,
  shouldOfferBubble,
};

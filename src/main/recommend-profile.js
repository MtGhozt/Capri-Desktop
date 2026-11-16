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

// Same cubins the voice Torch build ships (see voice/tts.py cuda_arch_reason + test_tts_cache).
const TORCH_ARCHS = ['sm_75', 'sm_80', 'sm_86', 'sm_90', 'sm_100', 'sm_120'];

function parseComputeCap(raw) {
  const m = String(raw || '').trim().match(/^(\d+)\.(\d+)$/);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]) };
}

// Forward-compat within a major: sm_86 covers sm_89; another major (or below every build) does not.
function cudaArchSupported(computeCap, archs = TORCH_ARCHS) {
  const cap = typeof computeCap === 'object' && computeCap
    ? computeCap
    : parseComputeCap(computeCap);
  if (!cap) return false;
  const built = [];
  for (const name of archs) {
    const digits = String(name).trim().toLowerCase()
      .replace(/^compute_/, '')
      .replace(/^sm_/, '')
      .replace(/a$/, '');
    if (digits.length >= 2 && /^\d+$/.test(digits)) {
      built.push({ major: Number(digits.slice(0, -1)), minor: Number(digits.slice(-1)) });
    }
  }
  return built.some((b) => b.major === cap.major && b.minor <= cap.minor);
}

function recommendProfile({ gpu, vramMB, ramMB, cores, computeCap } = {}) {
  const nvidia = String(gpu || '').toLowerCase() === 'nvidia';
  const vram = Number(vramMB) || 0;
  const ram = Number(ramMB) || 0;
  const nCores = Number(cores) || 0;
  const low = (ram > 0 && ram < THRESHOLDS.LOW_RAM_MB) || (nCores > 0 && nCores < THRESHOLDS.LOW_CORES);
  const whisper = low ? THRESHOLDS.WHISPER_LOW : THRESHOLDS.WHISPER_OK;
  const lightAnimations = Boolean(low);

  let voice = 'kokoro';
  let archReason = '';
  if (nvidia && vram >= THRESHOLDS.OMNI_VRAM_MB) {
    const cap = parseComputeCap(computeCap);
    if (!cap) {
      archReason = 'No pude leer la arquitectura CUDA de la GPU; mejor Kokoro';
    } else if (!cudaArchSupported(cap)) {
      archReason = `La GPU (sm_${cap.major}${cap.minor}) no es compatible con OmniVoice; mejor Kokoro`;
    } else {
      voice = 'omnivoice-cuda';
    }
  }

  const voiceLabel = voice === 'omnivoice-cuda' ? 'OmniVoice' : 'Kokoro';
  const bits = lightAnimations
    ? `${voiceLabel}, Whisper ${whisper}, animaciones ligeras`
    : `${voiceLabel}, Whisper ${whisper}`;
  const reason = archReason || bits;
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
      computeCap: vram?.computeCap || null,
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
  TORCH_ARCHS,
  parseComputeCap,
  cudaArchSupported,
  recommendProfile,
  hardwareFingerprint,
  detectHardware,
  matchesConfig,
  applyPatch,
  bubbleLine,
  shouldOfferBubble,
};

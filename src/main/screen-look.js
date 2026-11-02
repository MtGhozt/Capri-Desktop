'use strict';

// Phase 6C: on-demand (and optional auto) screen look. JPEG stays in memory only.

const { normalizeCommandText } = require('./command-text');

const NO_VISION = 'Este cerebro no puede ver imágenes; probá con Gemini.';
const MAX_WIDTH = 1280;
const JPEG_QUALITY = 70;
const AUTO_LOOK_MS = 10 * 60_000;
const USER_ACTIVE_IDLE_SEC = 90;

const LOOK_RE = new RegExp(
  [
    '\\bmir[aá](?:me)?\\s+(?:mi\\s+)?pantalla\\b',
    '\\bmir[aá]\\s+esto\\b',
    '\\bqu[eé]\\s+ves\\b',
    '\\bqu[eé]\\s+hay\\s+en\\s+(?:mi\\s+)?pantalla\\b',
    '\\bdescrib[eéi]\\s+(?:mi\\s+)?pantalla\\b',
    '\\bve[eé]\\s+(?:mi\\s+)?pantalla\\b',
  ].join('|'),
);

function isLookCommand(text) {
  return LOOK_RE.test(normalizeCommandText(text));
}

function consentNotice({ label, model, cloud } = {}) {
  const where = cloud ? 'nube' : 'en tu PC';
  const who = [label, model].filter(Boolean).join(' · ') || 'tu cerebro';
  return `Cuando me pidas mirar, te mando una foto de la pantalla a ${who} (${where}). Solo viaja en memoria: no la guardo en disco.`;
}

function userContentWithImage(text, jpegBase64) {
  const line = String(text || '').trim() || 'Mirá mi pantalla y contame qué ves, breve.';
  if (!jpegBase64) return line;
  return [
    { type: 'text', text: line },
    { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${jpegBase64}` } },
  ];
}

function shouldAutoLook({
  enabled = false,
  shareScreen = false,
  lastAt = 0,
  now = Date.now(),
  intervalMs = AUTO_LOOK_MS,
  gameActive = false,
  fullscreen = false,
  idleSeconds = 0,
  activeIdleSec = USER_ACTIVE_IDLE_SEC,
} = {}) {
  if (!enabled || !shareScreen) return false;
  if (gameActive || fullscreen) return false;
  if (idleSeconds > activeIdleSec) return false; // user away
  if (now - Number(lastAt || 0) < Math.max(AUTO_LOOK_MS, Number(intervalMs) || AUTO_LOOK_MS)) return false;
  return true;
}

async function captureScreenJpeg({
  getSources,
  displayId = null,
  maxWidth = MAX_WIDTH,
  quality = JPEG_QUALITY,
  beforeCapture = null,
  afterCapture = null,
} = {}) {
  if (typeof getSources !== 'function') return null;
  try {
    beforeCapture?.();
    const thumbH = Math.max(720, Math.round(maxWidth * 0.75));
    const sources = await getSources({
      types: ['screen'],
      thumbnailSize: { width: maxWidth, height: thumbH },
    });
    if (!Array.isArray(sources) || !sources.length) return null;
    let source = sources[0];
    if (displayId != null) {
      const hit = sources.find((s) => String(s.display_id) === String(displayId));
      if (hit) source = hit;
    }
    let img = source?.thumbnail;
    if (!img || typeof img.isEmpty === 'function' && img.isEmpty()) return null;
    const size = typeof img.getSize === 'function' ? img.getSize() : null;
    if (size?.width > maxWidth && typeof img.resize === 'function') {
      img = img.resize({ width: maxWidth, quality: 'better' });
    }
    if (typeof img.toJPEG !== 'function') return null;
    const buf = img.toJPEG(quality);
    if (!buf || !buf.length) return null;
    return Buffer.from(buf).toString('base64');
  } finally {
    try { afterCapture?.(); } catch { /* show overlay again even if capture failed */ }
  }
}

module.exports = {
  NO_VISION,
  MAX_WIDTH,
  JPEG_QUALITY,
  AUTO_LOOK_MS,
  USER_ACTIVE_IDLE_SEC,
  isLookCommand,
  consentNotice,
  userContentWithImage,
  shouldAutoLook,
  captureScreenJpeg,
};

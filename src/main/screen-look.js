'use strict';

// Phase 6C: on-demand (and optional auto) screen look. JPEG stays in memory only.

const { normalizeCommandText } = require('./command-text');
const crypto = require('node:crypto');
const fs = require('node:fs');

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

/**
 * Windows: setContentProtection(true) so Capri stays visible but out of the JPEG
 * (WDA_EXCLUDEFROMCAPTURE). Elsewhere (or if protection throws): hide/show fallback.
 * Always reapply click-through after — show()/hide() can desync ignoreMouseEvents.
 */
function createCaptureShield({
  platform = process.platform,
  setContentProtection = null,
  hide = null,
  show = null,
  reapplyClickThrough = null,
} = {}) {
  let mode = 'none'; // 'protect' | 'hide' | 'none'
  return {
    before() {
      if (platform === 'win32' && typeof setContentProtection === 'function') {
        try {
          setContentProtection(true);
          mode = 'protect';
          return;
        } catch { /* fall through to hide */ }
      }
      if (typeof hide === 'function') {
        try {
          hide();
          mode = 'hide';
        } catch { mode = 'none'; }
      }
    },
    after() {
      try {
        if (mode === 'protect' && typeof setContentProtection === 'function') {
          try { setContentProtection(false); } catch { /* keep going */ }
        } else if (mode === 'hide' && typeof show === 'function') {
          try { show(); } catch { /* already gone */ }
        }
      } finally {
        mode = 'none';
        try { reapplyClickThrough?.(); } catch { /* click-through best-effort */ }
      }
    },
    /** @returns {'protect'|'hide'|'none'} */
    mode: () => mode,
  };
}

// The screen the caller asked for: Electron's display_id first, the display's position second.
// With several screens and no match, nothing is better than another monitor's desktop.
function pickScreenSource(sources, displayId = null, displayIndex = null) {
  if (!Array.isArray(sources) || !sources.length) return null;
  if (displayId != null) {
    const hit = sources.find((s) => String(s.display_id) === String(displayId));
    if (hit) return hit;
  }
  if (Number.isInteger(displayIndex) && displayIndex >= 0 && sources[displayIndex]) return sources[displayIndex];
  return sources.length === 1 ? sources[0] : null;
}

// A frame that comes back flat black is the compositor with nothing to show yet (first frame
// after waking, a display change, an exclusive-fullscreen game). Anything brighter is content.
function frameIsBlank(pixels) {
  if (!pixels || !pixels.length) return false;
  for (let i = 0; i + 2 < pixels.length; i += 4) {
    if (pixels[i] > 8 || pixels[i + 1] > 8 || pixels[i + 2] > 8) return false;
  }
  return true;
}

// The consent text promises the shot stays in memory. Only voice.debugSave (off by default) keeps it
// on disk for debugging; otherwise a leftover from an older build is removed.
function keepCaptureFile({ image = null, file = null, debugSave = false } = {}) {
  if (!file) return false;
  if (!debugSave) {
    try { fs.unlinkSync(file); } catch { /* already gone */ }
    return false;
  }
  if (!image) return false;
  try {
    fs.writeFileSync(file, Buffer.from(image, 'base64'));
    return true;
  } catch {
    return false;
  }
}

async function captureScreenJpeg({
  getSources,
  displayId = null,
  displayIndex = null,
  maxWidth = MAX_WIDTH,
  quality = JPEG_QUALITY,
  attempts = 1,
  retryDelayMs = 150,
  beforeCapture = null,
  afterCapture = null,
  onCapture = null,
} = {}) {
  if (typeof getSources !== 'function') return null;
  const tries = Math.max(1, Number(attempts) || 1);
  try {
    beforeCapture?.();
    const thumbH = Math.max(720, Math.round(maxWidth * 0.75));
    for (let attempt = 0; attempt < tries; attempt++) {
      const sources = await getSources({
        types: ['screen'],
        thumbnailSize: { width: maxWidth, height: thumbH },
      });
      const source = pickScreenSource(sources, displayId, displayIndex);
      let img = source?.thumbnail;
      if (!img || typeof img.isEmpty === 'function' && img.isEmpty()) {
        if (attempt < tries - 1) {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
          continue;
        }
        return null;
      }
      const size = typeof img.getSize === 'function' ? img.getSize() : null;
      if (size?.width > maxWidth && typeof img.resize === 'function') {
        img = img.resize({ width: maxWidth, quality: 'better' });
      }
      if (typeof img.toJPEG !== 'function') return null;
      const buf = img.toJPEG(quality);
      if (!buf || !buf.length) return null;
      const pixels = typeof img.toBitmap === 'function'
        ? img.toBitmap()
        : (typeof img.getBitmap === 'function' ? img.getBitmap() : null);
      const blank = frameIsBlank(pixels);
      if (blank) {
        if (attempt < tries - 1) {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
          continue;
        }
        return null;
      }
      onCapture?.({
        displayId: source?.display_id ?? displayId,
        size,
        bytes: buf.length,
        hash: crypto.createHash('sha1').update(buf).digest('hex'),
        blank,
      });
      return Buffer.from(buf).toString('base64');
    }
    return null;
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
  createCaptureShield,
  pickScreenSource,
  frameIsBlank,
  keepCaptureFile,
  captureScreenJpeg,
};

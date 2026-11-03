'use strict';

// How her window is drawn (menu › Apariencia › Pantalla): on some PCs her see-through window
// shows up black, often NVIDIA with FXAA, MFAA or HDR on. Drawn through OpenGL, or without the
// graphics card, it comes back. Adapted from mochiiwuff/capri-desktop 4096696 (MIT).

const MODES = ['auto', 'gl', 'software'];

const HINTS = {
  auto: 'Recomendado',
  gl: 'Solo si Capri se ve negra',
  software: 'Solo si se ve negra y OpenGL no ayudó. Va más lento.',
};

const SOFTWARE_CONFIRM = 'Capri va a ir más lenta. ¿Seguro?';

function parseRenderMode(value) {
  const mode = String(value ?? '');
  return MODES.includes(mode) ? mode : 'auto';
}

function renderHint(value) {
  return HINTS[parseRenderMode(value)];
}

// What the Pantalla selector does next: same mode is a no-op; SIN GPU asks once (CONFIRMAR).
function nextRenderAction(requested, current, { confirmed = false } = {}) {
  const mode = parseRenderMode(requested);
  const from = parseRenderMode(current);
  if (mode === from) return { action: 'noop', mode };
  if (mode === 'software' && !confirmed) {
    return { action: 'ask', mode, message: SOFTWARE_CONFIRM };
  }
  return { action: 'apply', mode };
}

// What Chromium is told before it starts, so picking one only takes a restart.
function renderSwitches(value) {
  const mode = parseRenderMode(value);
  // Electron's forced ANGLE OpenGL path can leave transparent canvases blank on Windows.
  if (mode === 'gl') return { software: false, switches: [] };
  if (mode === 'software') return { software: true, switches: [['enable-unsafe-swiftshader', null]] };
  return { software: false, switches: [] };
}

module.exports = {
  MODES, HINTS, SOFTWARE_CONFIRM, parseRenderMode, renderHint, nextRenderAction, renderSwitches,
};

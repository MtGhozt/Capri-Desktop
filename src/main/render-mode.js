'use strict';

// How her window is drawn (menu › COMPORTAMIENTO › Pantalla): on some PCs her see-through window
// shows up black, often NVIDIA with FXAA, MFAA or HDR on. Drawn through OpenGL, or without the
// graphics card, it comes back. Adapted from mochiiwuff/capri-desktop 4096696 (MIT).

const MODES = ['auto', 'gl', 'software'];

function parseRenderMode(value) {
  const mode = String(value ?? '');
  return MODES.includes(mode) ? mode : 'auto';
}

// What Chromium is told before it starts, so picking one only takes a restart.
function renderSwitches(value) {
  const mode = parseRenderMode(value);
  if (mode === 'gl') return { software: false, switches: [['use-angle', 'gl']] };
  if (mode === 'software') return { software: true, switches: [['enable-unsafe-swiftshader', null]] };
  return { software: false, switches: [] };
}

module.exports = { MODES, parseRenderMode, renderSwitches };

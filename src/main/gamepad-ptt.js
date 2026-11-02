'use strict';

// Pure Gamepad API helpers (Xbox/PlayStation). Renderer polls; tests use this copy.

function buttonsHeld(pad, indexes) {
  if (!pad || !Array.isArray(indexes) || !indexes.length) return false;
  return indexes.every((i) => Boolean(pad.buttons?.[i]?.pressed));
}

function anyPadCombo(pads, indexes) {
  const list = pads || [];
  for (const pad of list) {
    if (buttonsHeld(pad, indexes)) return true;
  }
  return false;
}

function normalizeCombo(raw) {
  return (Array.isArray(raw) ? raw : [6, 7]).map(Number).filter(Number.isFinite);
}

module.exports = { buttonsHeld, anyPadCombo, normalizeCombo };

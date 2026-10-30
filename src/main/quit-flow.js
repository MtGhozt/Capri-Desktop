'use strict';

// Salir / "ciérrate": ask once, then Sí / voice yes / a second Salir within confirmMs actually quits.

const { readAnswer } = require('./app-confirm');

const CONFIRM_MS = 10_000;

function isYes(value) {
  const raw = String(value || '').trim();
  if (raw === 'yes' || raw === 'si' || raw === 'sí') return true;
  return readAnswer(raw) === 'yes';
}

function createQuitFlow({
  confirmMs = CONFIRM_MS,
  quit = () => {},
  onAsk = () => {},
  onCancel = () => {},
  onClear = () => {},
  now = Date.now,
} = {}) {
  let askedAt = null;
  let timer = null;

  function pending() {
    if (askedAt == null) return false;
    if (now() - askedAt > confirmMs) {
      askedAt = null;
      return false;
    }
    return true;
  }

  function clear() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    askedAt = null;
    onClear();
  }

  function ask() {
    if (pending()) {
      clear();
      quit();
      return { ok: true, quit: true };
    }
    clear();
    askedAt = now();
    onAsk();
    timer = setTimeout(() => {
      timer = null;
      if (askedAt == null) return;
      askedAt = null;
      onClear();
      onCancel('timeout');
    }, confirmMs);
    return { ok: true, asked: true };
  }

  function answer(value) {
    // Sí always quits (even if the confirm timer already cleared): the button must never no-op.
    if (isYes(value)) {
      clear();
      quit();
      return { ok: true, quit: true };
    }
    if (!pending()) return { ok: false };
    clear();
    onCancel('no');
    return { ok: true, cancelled: true };
  }

  return {
    ask,
    answer,
    clear,
    get pending() { return pending(); },
  };
}

module.exports = { CONFIRM_MS, isYes, createQuitFlow };

'use strict';

// Direct commands that never reach the LLM: "guarda eso" fires NVIDIA's Instant Replay
// hotkey, exactly like the sleep command folds her down.

const { normalizeCommandText } = require('./command-text');

const CLIP_RE = new RegExp(
  [
    '\\bguarda(?:me)?\\s+(?:eso|esto|el\\s+clip|el\\s+replay|este\\s+clip)\\b',
    '\\bgraba(?:me)?\\s+(?:eso|esto|el\\s+clip|el\\s+replay)\\b',
    '\\bclipea(?:lo|me|\\s+eso|\\s+esto|\\s+el\\s+clip)?\\b',
    '\\bclip\\s+(?:eso|esto)\\b',
  ].join('|'),
);

function isClipCommand(text) {
  return CLIP_RE.test(normalizeCommandText(text));
}

// "Alt+F10" -> { mods: ['Alt'], key: 'F10' }; null when the combo is not something we can send.
const MODS = {
  ctrl: 'Control',
  control: 'Control',
  alt: 'Alt',
  shift: 'Shift',
  win: 'Super',
  super: 'Super',
  meta: 'Super',
};

const NAMED = {
  printscreen: 'PrintScreen',
  prtsc: 'PrintScreen',
  insert: 'Insert',
  delete: 'Delete',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  pause: 'Pause',
  scrolllock: 'ScrollLock',
  space: 'Space',
  tab: 'Tab',
};

function keyName(key) {
  const k = String(key || '').toLowerCase();
  if (/^f(?:[1-9]|1[0-9]|2[0-4])$/.test(k)) return k.toUpperCase();
  if (/^[a-z]$/.test(k)) return k.toUpperCase();
  if (/^[0-9]$/.test(k)) return k;
  return NAMED[k] || null;
}

function parseHotkey(text) {
  const parts = String(text || '').split('+').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  const key = keyName(parts.pop());
  if (!key) return null;
  const mods = [];
  for (const part of parts) {
    const mod = MODS[part.toLowerCase()];
    if (!mod || mods.includes(mod)) return null;
    mods.push(mod);
  }
  return { mods, key };
}

module.exports = { isClipCommand, parseHotkey };

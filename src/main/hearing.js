'use strict';

// OÍDO settings (Paso 4B): wake word sensitivity and the push-to-talk hotkey.

// Sensitivity in her menu is a %, the sidecar's openWakeWord threshold is 0..1:
// 20 % = 0.20 (the old default). Higher % = she needs to be surer it was "hey Jarvis".
const SENS_MIN = 10;
const SENS_MAX = 90;
const SENS_STEP = 5;
const DEFAULT_THRESHOLD = 0.2;

function clampPct(pct) {
  const n = Math.round(Number(pct));
  if (!Number.isFinite(n)) return Math.round(DEFAULT_THRESHOLD * 100);
  return Math.min(SENS_MAX, Math.max(SENS_MIN, n));
}

function thresholdFromPct(pct) {
  return Math.round(clampPct(pct)) / 100;
}

function pctFromThreshold(threshold) {
  const t = Number(threshold);
  if (!Number.isFinite(t) || t <= 0 || t >= 1) return Math.round(DEFAULT_THRESHOLD * 100);
  return clampPct(t * 100);
}

// Electron accelerators: modifiers, then one key.
const MODS = [
  ['Ctrl', /^(?:ctrl|control|cmdorctrl|commandorcontrol)$/i],
  ['Alt', /^(?:alt|option)$/i],
  ['Shift', /^shift$/i],
  ['Super', /^(?:super|meta|win|windows|cmd|command)$/i],
];
const NAMED = {
  space: 'Space', tab: 'Tab', enter: 'Enter', return: 'Enter', backspace: 'Backspace',
  delete: 'Delete', del: 'Delete', insert: 'Insert', ins: 'Insert', home: 'Home', end: 'End',
  pageup: 'PageUp', pagedown: 'PageDown', up: 'Up', down: 'Down', left: 'Left', right: 'Right',
  arrowup: 'Up', arrowdown: 'Down', arrowleft: 'Left', arrowright: 'Right',
  plus: 'Plus', minus: '-', '-': '-', '=': '=', ',': ',', '.': '.', '/': '/', ';': ';',
  "'": "'", '[': '[', ']': ']', '\\': '\\', '`': '`', pause: 'Pause', printscreen: 'PrintScreen',
};

function normalKey(raw) {
  const k = String(raw || '').trim();
  if (!k) return null;
  if (/^[a-z0-9]$/i.test(k)) return k.toUpperCase();
  const f = /^f([1-9]|1[0-9]|2[0-4])$/i.exec(k);
  if (f) return `F${f[1]}`;
  const num = /^(?:num|numpad)([0-9])$/i.exec(k);
  if (num) return `num${num[1]}`;
  return NAMED[k.toLowerCase()] || null;
}

const isFKey = (key) => /^F\d+$/.test(key);

// "ctrl + alt + v" → "Ctrl+Alt+V"; null when it is not a combo she can register.
// A plain key (no Ctrl/Alt/Super) would steal it from every app: only F-keys may go alone.
function normalizeAccelerator(text) {
  const parts = String(text || '').split('+').map((p) => p.trim());
  if (parts.length && parts.at(-1) === '' && parts.length > 1 && parts.at(-2) === '') {
    parts.splice(-2, 2, 'Plus');
  }
  if (!parts.length || parts.some((p) => !p)) return null;
  const mods = new Set();
  let key = null;
  for (const part of parts) {
    const mod = MODS.find(([, re]) => re.test(part));
    if (mod) {
      if (mods.has(mod[0])) return null;
      mods.add(mod[0]);
      continue;
    }
    if (key) return null;
    key = normalKey(part);
    if (!key) return null;
  }
  if (!key) return null;
  const strong = mods.has('Ctrl') || mods.has('Alt') || mods.has('Super');
  if (!strong && !isFKey(key)) return null;
  return [...MODS.map(([name]) => name).filter((m) => mods.has(m)), key].join('+');
}

// A keydown from her menu → accelerator, or null while only modifiers are down.
function acceleratorFromKey({ key, code, ctrlKey, altKey, shiftKey, metaKey } = {}) {
  if (['Control', 'Alt', 'Shift', 'Meta', 'AltGraph', 'OS'].includes(key)) return null;
  // code first: Ctrl+Alt+V gives key "v" (or a symbol on some layouts), code "KeyV" always
  let base = null;
  const c = String(code || '');
  if (/^Key[A-Z]$/.test(c)) base = c.slice(3);
  else if (/^Digit[0-9]$/.test(c)) base = c.slice(5);
  else if (/^Numpad[0-9]$/.test(c)) base = `num${c.slice(6)}`;
  else base = normalKey(key === ' ' ? 'Space' : key);
  if (!base) return null;
  const mods = [ctrlKey && 'Ctrl', altKey && 'Alt', shiftKey && 'Shift', metaKey && 'Super'].filter(Boolean);
  return normalizeAccelerator([...mods, base].join('+'));
}

const sameCombo = (a, b) => {
  const x = normalizeAccelerator(a);
  return Boolean(x) && x === normalizeAccelerator(b);
};

module.exports = {
  SENS_MIN, SENS_MAX, SENS_STEP, DEFAULT_THRESHOLD,
  thresholdFromPct, pctFromThreshold, normalizeAccelerator, acceleratorFromKey, sameCombo,
};

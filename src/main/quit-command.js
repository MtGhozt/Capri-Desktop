'use strict';

// "ciérrate" / "vete" / "cierra Capri": quit with resistance (main.js asks first).
// "vete a dormir" stays sleep — isSleepCommand wins before this runs, and we refuse it here too.

const { normalizeCommandText } = require('./command-text');
const { isSleepCommand } = require('./sleep-command');

// Leading wake / filler only — do not strip a trailing "capri" ("cierra Capri" needs it).
const HEAD = /^(?:hey|oye|oi|che|dale|bueno|ok|okay|eh|mira|ya|por\s+favor|porfa|capri|jarvis)\s+/;
const TAIL = /\s+(?:por\s+favor|porfa|ya|ahora|humanito|gracias)$/;

const ORDER = [
  /^(?:cierrate|cerrate)$/,
  /^vete$/,
  /^(?:cierra|cerrar)(?:\s+a)?\s+capri$/,
];

function isQuitCommand(text) {
  if (isSleepCommand(text)) return false;
  let n = normalizeCommandText(text);
  for (let i = 0; i < 5 && n; i += 1) {
    const shorter = n.replace(HEAD, '').replace(TAIL, '').trim();
    if (shorter === n) break;
    n = shorter;
  }
  return ORDER.some((re) => re.test(n));
}

module.exports = { isQuitCommand };

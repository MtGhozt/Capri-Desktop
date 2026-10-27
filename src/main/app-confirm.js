'use strict';

// Her "¿quisiste decir Discord?" / "¿seguro que cierro Opera?" waits for your answer (Paso 4C).
// The question ends with "?", so said aloud the mic opens for it without the wake word (4B).
//
//   ask(action)   she asked: `action` is what a yes does
//   take(text)    your next message, if she is waiting:
//                   { kind: 'yes', action }                  "sí", "dale", "ajá"…: do it
//                   { kind: 'no', action, explicit: true }   "no", "mejor no", "cancela"
//                   { kind: 'no', action, explicit: false }  anything else: dropped, and the
//                                                            message is read as a new one
//                 null when she wasn't waiting (or it's been too long)

const { normalizeCommandText } = require('./command-text');

const TTL_MS = 30_000;
const YES = new Set([
  'si', 'sii', 'siii', 'sip', 'sipi', 'dale', 'aja', 'claro', 'ok', 'okay', 'oki', 'va', 'vale', 'sale', 'hazlo',
  'hacelo', 'eso', 'exacto', 'correcto', 'obvio', 'porfa', 'afirmativo', 'simon', 'yes', 'yep', 'ese', 'esa', 'ajam',
  'efectivamente', 'adelante', 'seguro', 'listo',
]);
const YES_PHRASES = /^(?:de\s+una|por\s+favor|claro\s+que\s+si|eso\s+mismo|ese\s+mismo|esa\s+misma|si\s+senora|con\s+confianza)$/;
const NO = new Set(['no', 'nop', 'nope', 'nel', 'nah', 'cancela', 'cancelalo', 'cancelar', 'deja', 'dejalo', 'olvidalo', 'para', 'nada', 'negativo', 'tampoco', 'ninguno', 'ninguna']);
const NO_PHRASES = /^(?:mejor\s+no|no\s+gracias|ni\s+loca|ni\s+loco|para\s+nada|ya\s+no|todavia\s+no|aun\s+no|espera|esperate)\b/;
// words that can ride along a yes without changing it
const FILLER = new Set(['porfa', 'favor', 'por', 'capri', 'humanito', 'gracias', 'ya', 'dale', 'si', 'claro', 'ese', 'esa', 'eso',
  'abrelo', 'abrela', 'abrilo', 'abrila', 'cierralo', 'cierrala', 'cerralo', 'cerrala', 'hazlo', 'hacelo', 'mismo', 'misma', 'ahora']);

function readAnswer(text) {
  const n = normalizeCommandText(text);
  if (!n) return 'other';
  const words = n.split(' ');
  if (NO.has(words[0]) || NO_PHRASES.test(n)) return 'no';
  if (YES_PHRASES.test(n)) return 'yes';
  if (YES.has(words[0]) && words.length <= 5 && words.slice(1).every((w) => FILLER.has(w) || YES.has(w))) return 'yes';
  return 'other';
}

function createConfirm({ now = Date.now, ttlMs = TTL_MS } = {}) {
  let pending = null; // { action, at }
  return {
    ask(action) {
      pending = { action, at: now() };
    },
    take(text) {
      if (!pending) return null;
      const { action, at } = pending;
      pending = null;
      if (now() - at > ttlMs) return null;
      const answer = readAnswer(text);
      if (answer === 'yes') return { kind: 'yes', action };
      return { kind: 'no', action, explicit: answer === 'no' };
    },
    cancel() {
      pending = null;
    },
    get pending() {
      if (pending && now() - pending.at > ttlMs) pending = null;
      return pending?.action || null;
    },
  };
}

module.exports = { TTL_MS, readAnswer, createConfirm };

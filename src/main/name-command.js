'use strict';

// Direct command that gives her a name to call you, without the LLM:
//   "llamame Mati", "decime Matías", "llamame así Mati"   → the name

const { stripWakeWord } = require('./command-text');
const { fold } = require('./fixes');

const VERBS = new Set(['llamame', 'decime', 'dime']);

// "llamame cuando llegues" is an order for later, not a name
const NOT_A_NAME = new Set([
  'cuando', 'si', 'para', 'porque', 'luego', 'despues', 'manana', 'ahora', 'ya', 'mas',
  'como', 'que', 'quien', 'tu', 'hola', 'el', 'la', 'los', 'las', 'un', 'una', 'de', 'del', 'a', 'al',
]);
const MAX_WORDS = 4;
const MAX_LENGTH = 24;

/** The name as written (case and accents kept), cleaned; null when it can't be one. */
function cleanName(raw) {
  const name = String(raw || '').normalize('NFC').replace(/[^\p{L}\p{N} .'-]+/gu, ' ')
    .replace(/\s+/g, ' ').trim().replace(/[ .'-]+$/, '');
  const words = name.split(' ').filter(Boolean);
  if (!words.length || words.length > MAX_WORDS || name.length > MAX_LENGTH) return null;
  return NOT_A_NAME.has(fold(words[0])) ? null : name;
}

/** The name a line asks her to use, or null. */
function parseNameCommand(text) {
  const words = stripWakeWord(String(text || ''))
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (!VERBS.has(fold(words[0] || ''))) return null;
  if (fold(words[1] || '') === 'asi') words.splice(1, 1);
  return cleanName(words.slice(1).join(' '));
}

module.exports = { parseNameCommand, cleanName };

'use strict';

// Normalizes what comes out of the chat box or Whisper before matching a direct command
// ("guarda eso", "ve a dormir"): no accents, lowercase, no punctuation, no wake word.

const fold = (text) => String(text || '')
  .normalize('NFD')
  .replace(/\p{M}/gu, '')
  .toLowerCase();

const WAKE_PREFIX = new Set(['hey', 'hola', 'oye', 'oi', 'ey', 'che', 'e']);
const WAKE_NAMES = new Set(['capri', 'kapri', 'cabri', 'capry', 'kapry', 'jarvis']);
// fused Whisper mangling: "acapri", "heacapri", "ecapri", …
const WAKE_MANGLED = /^(?:h?e+a?|a|e)?(?:capri|kapri|cabri|capry|kapry)$/;

const isWakeName = (w) => WAKE_NAMES.has(w) || WAKE_MANGLED.test(w);

/** The order without the wake word: "Hey Capri, pon música" -> "pon música". */
function stripWakeWord(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  const words = raw.split(/\s+/);
  const word = (i) => fold(words[i] || '').replace(/[^\p{L}\p{N}]/gu, '');
  let i = 0;
  if (WAKE_PREFIX.has(word(0)) && isWakeName(word(1))) i = 2;
  else if (isWakeName(word(0))) i = 1;
  else return raw;
  return words.slice(i).join(' ').replace(/^[\s,.:;–-]+/u, '').trim();
}

function normalizeCommandText(text) {
  return fold(stripWakeWord(text))
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = { normalizeCommandText, stripWakeWord };

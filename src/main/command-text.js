'use strict';

// Normalizes what comes out of the chat box or Whisper before matching a direct command
// ("guarda eso", "ve a dormir"): no accents, lowercase, no punctuation, no wake word.

const fold = (text) => String(text || '')
  .normalize('NFD')
  .replace(/\p{M}/gu, '')
  .toLowerCase();

// "capri, pon música", "hey capri pon música", "oye capri…": whisper keeps the greeting
const WAKE = /^(?:(?:hey|hola|oye|oi|ey|che)\s+)?(?:capri|jarvis)\b/;

/** The order without the wake word: "Hey Capri, pon música" -> "pon música". */
function stripWakeWord(text) {
  const words = String(text || '').trim().split(/\s+/);
  const word = (i) => fold(words[i]).replace(/[^\p{L}]/gu, '');
  let i = 0;
  if (['hey', 'hola', 'oye', 'oi', 'ey', 'che'].includes(word(i))) i += 1;
  if (!['capri', 'jarvis'].includes(word(i))) return String(text || '').trim();
  return words.slice(i + 1).join(' ').replace(/^[\s,.:;–-]+/u, '').trim();
}

function normalizeCommandText(text) {
  let n = fold(text)
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  while (WAKE.test(n)) n = n.replace(WAKE, '').trim();
  return n;
}

module.exports = { normalizeCommandText, stripWakeWord };

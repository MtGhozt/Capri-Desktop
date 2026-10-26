'use strict';

// Normalizes what comes out of the chat box or Whisper before matching a direct command
// ("guarda eso", "ve a dormir"): no accents, lowercase, no punctuation, no wake word.

function normalizeCommandText(text) {
  let n = String(text || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  while (/^(hey\s+jarvis|hey\s+capri|jarvis|capri)\b/.test(n)) {
    n = n.replace(/^(hey\s+jarvis|hey\s+capri|jarvis|capri)\s*/, '').trim();
  }
  return n;
}

module.exports = { normalizeCommandText };

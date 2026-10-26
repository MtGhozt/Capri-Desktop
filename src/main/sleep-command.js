'use strict';

// Chat/STT sleep command: fold to DORMANT without the LLM (main.js goSleepReply).

function normalizeSleepText(text) {
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

const SLEEP_RE = /\b(?:(?:tu|vos)\s+)?(?:andate|anda|vete|ve|voy)\s+a\s+dormir\b|\bdormite\b|\bduermete\b|\ba\s+mimir\b|\ba\s+dormir\b|\bgo\s+to\s+sleep\b|\bsleep\b|\bdescansa\b|\bapagate\b/;

function isSleepCommand(text) {
  return SLEEP_RE.test(normalizeSleepText(text));
}

module.exports = { isSleepCommand, normalizeSleepText };

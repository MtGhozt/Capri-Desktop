'use strict';

// Chat/STT sleep command: fold to DORMANT without the LLM (main.js goSleepReply).

const { normalizeCommandText } = require('./command-text');

const SLEEP_RE = /\b(?:(?:tu|vos)\s+)?(?:andate|anda|vete|ve|voy)\s+a\s+dormir\b|\bdormite\b|\bduermete\b|\ba\s+mimir\b|\ba\s+dormir\b|\bgo\s+to\s+sleep\b|\bsleep\b|\bdescansa\b|\bapagate\b/;

function isSleepCommand(text) {
  return SLEEP_RE.test(normalizeCommandText(text));
}

module.exports = { isSleepCommand, normalizeSleepText: normalizeCommandText };

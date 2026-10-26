'use strict';

// Chat/STT sleep command: fold to DORMANT without the LLM (main.js goSleepReply).
//
// Only an order to her counts: "ve y duerme", "a dormir", "duérmete ya". Talk about sleep
// ("no pude dormir", "tengo sueño", "voy a dormir mal") and questions ("¿tú duermes?") don't.

const { normalizeCommandText } = require('./command-text');

// Spoken before the order ("che, ve a dormir") and after it ("ve a dormir, ¿sí?"/"tú también").
const HEAD = /^(?:hey|oye|che|dale|bueno|ok|eh|por\s+favor|capri|jarvis)\s+/;
const TAIL = /\s+(?:ya|ahora|che|si|capri|jarvis|humanito|por\s+favor|porfa|tu\s+tambien|vos\s+tambien|tambien)$/;

// The whole phrase, once the pleasantries are off, is one of these orders.
const ORDER = [
  /^(?:me\s+)?voy\s+a\s+dormir$/,
  /^(?:tu\s+|vos\s+)?(?:anda|andate|vete|ve|vamos)\s+(?:y\s+)?(?:a\s+)?dormir$/,
  /^(?:tu\s+|vos\s+)?(?:ve|anda|vete|vamos)\s+y\s+duerme$/,
  /^(?:a\s+dormir|a\s+mimir)$/,
  /^(?:ya\s+)?(?:es\s+)?hora\s+de\s+(?:ir\s+a\s+)?dormir$/,
  /^(?:momento\s+de|toca)\s+(?:ir\s+a\s+)?dormir$/,
  /^(?:duerme|duermete|dormite|dormi)(?:\s+(?:un\s+rato|un\s+poco|un\s+toque))?$/,
  /^descansa(?:\s+(?:un\s+rato|un\s+poco|un\s+toque|tranquil[oa]))?$/,
  /^apagate$/,
  /^(?:go\s+to\s+sleep|sleep)$/,
];

function isSleepCommand(text) {
  let n = normalizeCommandText(text);
  for (let changed = true; changed && n;) {
    changed = false;
    for (const strip of [HEAD, TAIL]) {
      const shorter = n.replace(strip, '');
      if (shorter !== n) {
        n = shorter;
        changed = true;
      }
    }
  }
  return ORDER.some((re) => re.test(n));
}

module.exports = { isSleepCommand, normalizeSleepText: normalizeCommandText };

'use strict';

// Chat/STT sleep command: fold to DORMANT without the LLM (main.js goSleepReply).
//
// Only an order to her counts: "ve y duerme", "a dormir", "duérmete ya", and the cozy ones
// ("duermito un rato, ¿quieres?", "a la camita", "échate una siestita"), offers included
// ("¿quieres dormir un rato?", "¿por qué no duermes un rato?"). Talk about sleep ("no pude
// dormir", "tengo sueño", "anoche no dormí") and questions about it ("¿tú duermes?",
// "¿dormiste bien?", "¿te gusta dormir?") don't.

const { normalizeCommandText } = require('./command-text');

// Spoken before the order ("che, ve a dormir") and after it ("ve a dormir, ¿sí?"/"tú también").
const HEAD = /^(?:hey|oye|oi|che|dale|bueno|ok|okay|eh|mira|ya|por\s+favor|porfa|capri|jarvis)\s+/;
const TAIL = new RegExp(`\\s+(?:${[
  'ya', 'ahora', 'che', 'si', 'va', 'vale', 'ok', 'okay', 'dale', 'quieres', 'queres', 'capri', 'jarvis',
  'humanito', 'por\\s+favor', 'porfa', 'tu\\s+tambien', 'vos\\s+tambien', 'tambien', 'mejor',
  // how long: "un rato", "un ratito", "un poquito"...
  'un\\s+(?:rato|ratito|ratico|poco|poquito|toque|toquecito)',
].join('|')})$`);

// The whole phrase, once the pleasantries are off, is one of these orders.
const ORDER = [
  /^(?:me\s+)?voy\s+a\s+dormir$/,
  /^(?:tu\s+|vos\s+)?(?:anda|andate|vete|ve|vamos)\s+(?:y\s+)?(?:a\s+)?dormir$/,
  /^(?:tu\s+|vos\s+)?(?:ve|anda|vete|vamos)\s+y\s+duerme$/,
  /^(?:a\s+dormir|a\s+mimir)$/,
  /^(?:(?:tu\s+|vos\s+)?(?:anda|andate|vete|ve|vamos)\s+)?a\s+(?:la\s+)?(?:cama|camita|mimir)$/,
  // a nap: "una siestita", "échate una siesta", "tómate una siestita"
  /^(?:(?:echate|tomate|hacete|hace|haz|date|tirate)\s+)?una\s+(?:siesta|siestita)$/,
  /^siestita$/,
  // offers to her: "¿quieres dormir un rato?", "¿te quieres dormir?", "¿por qué no duermes?"
  /^(?:te\s+)?(?:quieres|queres)\s+(?:ir\s+a\s+)?(?:dormir|dormirte|mimir|descansar|tomarte\s+una\s+siest(?:a|ita)|echarte\s+una\s+siest(?:a|ita))$/,
  /^por\s*que\s+no\s+(?:te\s+)?(?:duermes|dormis|descansas|vas\s+a\s+dormir|te\s+vas\s+a\s+dormir|(?:te\s+)?(?:tomas|echas)\s+una\s+siest(?:a|ita))$/,
  /^(?:ya\s+)?(?:es\s+)?hora\s+de\s+(?:ir\s+a\s+)?dormir$/,
  /^(?:momento\s+de|toca)\s+(?:ir\s+a\s+)?dormir$/,
  /^(?:duerme|duermete|dormite|dormi|duermito|duermase|duermanse)(?:\s+(?:un\s+rato|un\s+poco|un\s+toque))?$/,
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

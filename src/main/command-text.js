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

const wordAt = (words, i) => fold(words[i] || '').replace(/[^\p{L}\p{N}]/gu, '');

/** How many words the wake form takes: 2 for "hey Capri", 1 for "Capri", 0 for none. */
function wakeLead(words) {
  if (WAKE_PREFIX.has(wordAt(words, 0)) && isWakeName(wordAt(words, 1))) return 2;
  return isWakeName(wordAt(words, 0)) ? 1 : 0;
}

/** The order without the wake word: "Hey Capri, pon música" -> "pon música". */
function stripWakeWord(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  const words = raw.split(/\s+/);
  const i = wakeLead(words);
  if (!i) return raw;
  return words.slice(i).join(' ').replace(/^[\s,.:;–-]+/u, '').trim();
}

/** True when the wake word opens the utterance: a video that just mentions her mid-sentence
 * is not calling her. Mirrors strip_wake_phrase() in voice/server.py. */
function wakeWordAtStart(text) {
  const raw = String(text || '').trim();
  return Boolean(raw) && wakeLead(raw.split(/\s+/)) > 0;
}

/** A whisper-wake transcript is fine when the sidecar already stripped the wake word; if it
 * still carries one, it must be the first thing said. */
function wakeTranscriptOk(text) {
  const words = String(text || '').trim().split(/\s+/);
  return !words.some((_, i) => isWakeName(wordAt(words, i))) || wakeWordAtStart(text);
}

function normalizeCommandText(text) {
  return fold(stripWakeWord(text))
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = { normalizeCommandText, stripWakeWord, wakeWordAtStart, wakeTranscriptOk };

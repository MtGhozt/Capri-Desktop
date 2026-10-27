'use strict';

// Direct commands that teach her what she hears wrong, without the LLM:
//   "cuando digo jarbis quiero decir Jarvis", "cuando digo na mida me refiero a Namida",
//   "cuando oigas jarbis es Jarvis"            → add (or update) a fix
//   "olvida la corrección de jarbis"           → remove it
// Read off what Whisper wrote (commas, quotes and dots anywhere). Questions ("¿qué quiere decir
// jarbis?") and talk ("cuando digo que estoy cansado es porque…") don't count.

const { fold, applyFixes } = require('./fixes');

// "hey jarvis", "oye capri"… before the order, "por favor" after it
const HEAD = /^(?:(?:hey|oye|oi|che|mira|bueno|ok|okay|eh|capri|jarvis)\s+)+/;
const TAIL = /(?:\s+(?:por\s+favor|porfa|ok|okay|vale|gracias))+$/;

const SAY = '(?:digo|diga|dije|decis|digas)';
const MEAN = '(?:quiero\\s+decir|me\\s+refiero\\s+a|significa|en\\s+realidad\\s+digo)';
// told to her ("cuando oigas"), not about hearing in general ("cuando oyes música es mejor…")
const HEAR = '(?:oigas|escuches|entiendas)';
const READ = '(?:es|significa|quiero\\s+decir|me\\s+refiero\\s+a|lee|leelo\\s+como|entende|entiende|escribi|escribe|pone|pon|cambialo\\s+por)';

const ADD = [
  new RegExp(`^(?:y\\s+)?(?:cuando|si)\\s+(?:yo\\s+)?${SAY}\\s+(.+?)\\s+${MEAN}\\s+(.+)$`, 'd'),
  new RegExp(`^(?:y\\s+)?(?:cuando|si)\\s+${HEAR}\\s+(.+?)\\s+${READ}\\s+(.+)$`, 'd'),
];
const REMOVE = [
  /^(?:olvida|olvidate\s+de|borra|quita|elimina|saca)\s+(?:la\s+)?correccion\s+(?:de|del|para|sobre)\s+(.+)$/d,
  /^(?:ya\s+)?no\s+(?:corrijas|cambies)\s+(?:mas\s+)?(.+)$/d,
  /^deja\s+de\s+corregir\s+(.+)$/d,
];

// what a word to fix can't start with: that's a sentence about something, not a word
const NOT_HEARD = new Set(['que', 'como', 'porque', 'cuando', 'si', 'no', 'lo', 'de', 'para', 'por', 'eso', 'esto', 'algo', 'nada', 'yo', 'me', 'te']);
const NOT_MEANT = new Set(['que', 'porque', 'como', 'muy', 'mas', 'mejor', 'peor', 'un', 'una', 'el', 'la', 'lo', 'los', 'las', 'de', 'del', 'para', 'por', 'cuando', 'si', 'no', 'otra', 'otro', 'algo', 'nada']);
const MAX_HEARD_WORDS = 4;
const MAX_MEANT_WORDS = 4;

const count = (s) => s.split(' ').filter(Boolean).length;

/**
 * What a line asks about her fixes: { action: 'add', heard, meant }, { action: 'remove', heard },
 * or null when it isn't one of these orders. `heard` and `meant` keep the case and accents said.
 */
function parseFixCommand(text) {
  const raw = String(text || '').normalize('NFC').trim();
  if (!raw || /[?¿]/.test(raw)) return null; // asking about a word is not an order
  const line = raw.replace(/[^\p{L}\p{N}\s]+/gu, ' ').replace(/\s+/g, ' ').trim();
  let folded = fold(line);
  const head = folded.match(HEAD);
  const start = head ? head[0].length : 0;
  const tail = folded.match(TAIL);
  const end = tail ? folded.length - tail[0].length : folded.length;
  if (end <= start) return null;
  const core = line.slice(start, end);
  folded = folded.slice(start, end);
  const take = (m, i) => core.slice(m.indices[i][0], m.indices[i][1]).trim();
  const ok = (part, max, stop) => {
    const n = count(part);
    return n >= 1 && n <= max && !stop.has(fold(part).split(' ')[0]);
  };
  for (const re of ADD) {
    const m = folded.match(re);
    if (!m) continue;
    const heard = take(m, 1);
    const meant = take(m, 2);
    if (!ok(heard, MAX_HEARD_WORDS, NOT_HEARD) || !ok(meant, MAX_MEANT_WORDS, NOT_MEANT)) return null;
    if (fold(heard) === fold(meant)) return null;
    return { action: 'add', heard, meant };
  }
  for (const re of REMOVE) {
    const m = folded.match(re);
    if (!m) continue;
    const heard = take(m, 1);
    if (!ok(heard, MAX_HEARD_WORDS, NOT_HEARD)) return null;
    return { action: 'remove', heard };
  }
  return null;
}

const isFixCommand = (text) => parseFixCommand(text) != null;

/**
 * A transcript as she reads it: `text` with her fixes, before any command or the model sees it.
 * An order about the fixes is left as said ("cuando digo jarbis…" must still say jarbis), and
 * `heard` (what Whisper wrote) is only there when a fix changed something.
 */
function readTranscript(said, fixes) {
  const text = String(said ?? '');
  if (!text.trim() || isFixCommand(text)) return { text, heard: null, order: Boolean(text.trim()) };
  const fixed = applyFixes(text, fixes);
  return { text: fixed, heard: fixed === text ? null : text, order: false };
}

module.exports = { parseFixCommand, isFixCommand, readTranscript };

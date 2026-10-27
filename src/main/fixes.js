'use strict';

// What she hears wrong, read as what you meant (config `hearing.fixes`: [{ heard, meant }]).
// Whisper keeps turning the same words into others ("Jarbis", "na mida"): each fix swaps a whole
// word or phrase, any case, with or without accents, the longest ones first, in one pass (a fix
// never runs on what another one put in), and leaves the rest of the text as it was.

const MAX_FIXES = 200;
const MAX_LEN = 60;

// One character at a time, so the folded text lines up with the original: no accents, lowercase.
function foldChar(ch) {
  const base = ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  return base.length === 1 ? base : ch.toLowerCase().length === 1 ? ch.toLowerCase() : ch;
}

/** Same length as `text` (in UTF-16 units), without accents and in lowercase. */
function fold(text) {
  let out = '';
  for (const ch of String(text || '')) {
    const f = foldChar(ch);
    out += f.length === ch.length ? f : ch;
  }
  return out;
}

// The words of a phrase, folded: what two fixes are compared by.
function words(text) {
  return fold(String(text || '').normalize('NFC')).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** The key a fix is stored under: its heard words, folded, one space apart. */
const fixKey = (heard) => words(heard).join(' ');

const clean = (text) => String(text ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();

/** A fix as it gets saved, or null when it makes no sense (empty, too long, nothing changes). */
function makeFix(heard, meant) {
  const h = clean(heard).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  const m = clean(meant).replace(/^[\s"'«»“”¿¡]+|[\s"'«»“”.,;:!?]+$/gu, '');
  if (!fixKey(h) || !m || h.length > MAX_LEN || m.length > MAX_LEN) return null;
  if (fixKey(h) === fixKey(m) && words(m).length) return null; // same words: nothing to fix
  return { heard: h, meant: m };
}

/** The fixes in config, cleaned: bad entries out, one per heard phrase (the last one wins). */
function cleanFixes(list) {
  const byKey = new Map();
  for (const item of Array.isArray(list) ? list : []) {
    const fix = item && makeFix(item.heard, item.meant);
    if (!fix) continue;
    byKey.delete(fixKey(fix.heard));
    byKey.set(fixKey(fix.heard), fix);
  }
  return [...byKey.values()].slice(-MAX_FIXES);
}

/** `list` with `heard` → `meant` added, or updated if she already had one for it. */
function addFix(list, heard, meant) {
  const fix = makeFix(heard, meant);
  if (!fix) return { fixes: cleanFixes(list), fix: null, updated: false };
  const before = cleanFixes(list);
  const key = fixKey(fix.heard);
  const updated = before.some((f) => fixKey(f.heard) === key);
  const fixes = [...before.filter((f) => fixKey(f.heard) !== key), fix].slice(-MAX_FIXES);
  return { fixes, fix, updated };
}

/** `list` without the fix for `heard` (matched like a transcript: case and accents don't count). */
function removeFix(list, heard) {
  const key = fixKey(heard);
  const before = cleanFixes(list);
  const removed = before.find((f) => fixKey(f.heard) === key) || null;
  return { fixes: before.filter((f) => f !== removed), removed };
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `text` with every fix applied: whole words only, longest phrase first, the rest untouched. */
function applyFixes(text, list) {
  const source = String(text ?? '').normalize('NFC');
  const fixes = cleanFixes(list);
  if (!source || !fixes.length) return source;
  const byKey = new Map(fixes.map((f) => [fixKey(f.heard), f]));
  const keys = [...byKey.keys()].sort((a, b) => b.length - a.length || a.localeCompare(b));
  // words in a phrase: any spaces or punctuation Whisper put between them ("hey, jarvis")
  const alt = keys.map((k) => k.split(' ').map(escape).join('[^\\p{L}\\p{N}]+')).join('|');
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${alt})(?![\\p{L}\\p{N}])`, 'gu');
  const folded = fold(source);
  let out = '';
  let at = 0;
  for (const m of folded.matchAll(re)) {
    const fix = byKey.get(words(m[0]).join(' '));
    if (!fix) continue;
    const said = source.slice(m.index, m.index + m[0].length);
    let meant = fix.meant;
    // a capital where it was heard with one ("Jarbis, ¿estás?"), unless the fix says otherwise
    if (/^\p{Lu}/u.test(said) && /^\p{Ll}/u.test(meant)) meant = meant[0].toUpperCase() + meant.slice(1);
    out += source.slice(at, m.index) + meant;
    at = m.index + m[0].length;
  }
  return out + source.slice(at);
}

module.exports = { applyFixes, addFix, removeFix, cleanFixes, makeFix, fixKey, fold, MAX_FIXES };

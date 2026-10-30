'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const AUDIO_EXT = new Set(['.mp3', '.flac', '.opus', '.m4a', '.wav', '.ogg', '.aac', '.wma']);

// words that say nothing about which song it is (whisper turns "my" into "mi")
const FILLER = new Set([
  'mi', 'my', 'me', 'the', 'el', 'la', 'los', 'las', 'lo', 'un', 'una', 'unos', 'unas',
  'de', 'del', 'of', 'a', 'an', 'y', 'and', 'para', 'por', 'con', 'que', 'to', 'en',
]);

function fold(s) {
  return String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

function tokens(query) {
  return fold(query).split(/[^a-z0-9]+/).filter((t) => t.length > 1 && !FILLER.has(t));
}

// how many of the query's words a file has to contain to count as the song
const MATCH_RATIO = 0.6;

/**
 * How well `filePath` answers the query: most of its words must appear, and words found in the
 * title weigh more than ones only in the artist or the file name. 0 = not that song.
 */
function scorePath(filePath, queryTokens) {
  if (!queryTokens.length) return 0;
  const { title, artist } = titleFromFile(filePath);
  const t = fold(title);
  const a = fold(artist);
  const base = fold(path.basename(filePath, path.extname(filePath)));
  let hits = 0;
  let inTitle = 0;
  for (const tok of queryTokens) {
    if (t.includes(tok)) {
      hits += 1;
      inTitle += 1;
    } else if (a.includes(tok) || base.includes(tok)) {
      hits += 1;
    }
  }
  if (hits < Math.ceil(queryTokens.length * MATCH_RATIO)) return 0;
  return (inTitle === queryTokens.length ? 1000 : 0) + hits * 100 + inTitle * 10;
}

function readScanDirs(home = os.homedir()) {
  const settings = path.join(home, '.namida', 'namida_settings.json');
  try {
    const json = JSON.parse(fs.readFileSync(settings, 'utf8'));
    const dirs = (json.directoriesToScan || [])
      .map((item) => (typeof item === 'string' ? item : item?.source))
      .filter((dir) => dir && fs.existsSync(dir));
    if (dirs.length) return dirs;
  } catch { /* no settings yet */ }
  const music = path.join(home, 'Music');
  return fs.existsSync(music) ? [music] : [];
}

function walkAudio(root, out, limit = 8000) {
  if (out.length >= limit) return;
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return; }
  for (const ent of entries) {
    if (out.length >= limit) return;
    if (ent.name.startsWith('.')) continue;
    const full = path.join(root, ent.name);
    if (ent.isDirectory()) walkAudio(full, out, limit);
    else if (AUDIO_EXT.has(path.extname(ent.name).toLowerCase())) out.push(full);
  }
}

function titleFromFile(filePath) {
  const base = path.basename(filePath, path.extname(filePath));
  const parts = base.split(' - ').map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 3 && /^\d+[a-z]?$/i.test(parts[0])) {
    return { title: parts[1], artist: parts.slice(2).join(' - ') };
  }
  if (parts.length >= 2) return { title: parts[0], artist: parts.slice(1).join(' - ') };
  return { title: base, artist: '' };
}

function listNamidaFiles({ home = os.homedir(), listFiles = walkAudio, dirs = null, limit = 8000 } = {}) {
  const files = [];
  for (const dir of (dirs || readScanDirs(home))) listFiles(dir, files, limit);
  return files;
}

function findNamidaTrack(query, { home = os.homedir(), listFiles = walkAudio, dirs = null } = {}) {
  const queryTokens = tokens(query);
  if (!queryTokens.length) return null;
  const files = listNamidaFiles({ home, listFiles, dirs });
  let best = null;
  let bestScore = 0;
  for (const file of files) {
    const score = scorePath(file, queryTokens);
    if (score > bestScore) {
      bestScore = score;
      best = file;
    }
  }
  if (!best) return null;
  return { path: best, ...titleFromFile(best), score: bestScore };
}

// Shuffle in place (Fisher–Yates); returns the same array.
function shuffleInPlace(items, rand = Math.random) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

// Temp .m3u so Namida gets a queue (next/previous move), not a lone file.
function writeNamidaM3u(paths, {
  writeFileSync = fs.writeFileSync,
  tmpdir = os.tmpdir(),
  join = path.join,
  name = `capri-namida-${Date.now()}.m3u`,
} = {}) {
  const list = (paths || []).filter(Boolean);
  if (!list.length) return null;
  const file = join(tmpdir, name);
  writeFileSync(file, `#EXTM3U\n${list.join('\n')}\n`, 'utf8');
  return file;
}

module.exports = {
  findNamidaTrack, listNamidaFiles, shuffleInPlace, writeNamidaM3u,
  fold, tokens, scorePath, readScanDirs, AUDIO_EXT,
};

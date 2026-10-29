'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const AUDIO_EXT = new Set(['.mp3', '.flac', '.opus', '.m4a', '.wav', '.ogg', '.aac', '.wma']);

function fold(s) {
  return String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

function tokens(query) {
  return fold(query).split(/[^a-z0-9]+/).filter((t) => t.length > 1);
}

function scorePath(filePath, queryTokens) {
  const base = fold(path.basename(filePath, path.extname(filePath)));
  if (!queryTokens.length) return 0;
  let hit = 0;
  for (const t of queryTokens) if (base.includes(t)) hit += 1;
  if (hit === 0) return 0;
  const full = hit === queryTokens.length;
  return (full ? 1000 : 0) + hit * 10 + Math.min(base.length, 80);
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

function findNamidaTrack(query, { home = os.homedir(), listFiles = walkAudio, dirs = null } = {}) {
  const queryTokens = tokens(query);
  if (!queryTokens.length) return null;
  const files = [];
  for (const dir of (dirs || readScanDirs(home))) listFiles(dir, files);
  let best = null;
  let bestScore = 0;
  for (const file of files) {
    const score = scorePath(file, queryTokens);
    if (score > bestScore) {
      bestScore = score;
      best = file;
    }
  }
  if (!best || bestScore < 10) return null;
  return { path: best, ...titleFromFile(best), score: bestScore };
}

module.exports = { findNamidaTrack, fold, tokens, scorePath, readScanDirs, AUDIO_EXT };

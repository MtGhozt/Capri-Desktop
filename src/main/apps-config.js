'use strict';

// Her app table (Paso 4C), config apps.list: what "abre X" / "cierra X" can reach.
//
//   { name, aliases[], type: 'program' | 'steam' | 'link', target, args, processes[], close }
//
// program: target is a path (%ENV% expanded), args its command line ("--processStart Discord.exe")
// steam:   target is the Steam app id (opened as steam://rungameid/<id>)
// link:    target is a URL or a URI (https://…, spotify:)
// processes: the exe names that are this app running ("Discord"), for closing it
// close: 'graceful' (its windows get WM_CLOSE), 'force' (taskkill /F /T), 'ask' (she asks first)
// optional: dir (its processes are whatever runs from that folder: games), title (its window's
// title, when nothing else tells), windows: 'explorer' (only File Explorer windows close, never
// explorer.exe itself)

const path = require('node:path');

const TYPES = ['program', 'steam', 'link'];
const CLOSE_MODES = ['graceful', 'force', 'ask'];
const MAX_NAME = 40;
const MAX_ALIASES = 12;
// which first-run candidates a table already got: 1 = Paso 4C, 2 = Grok, Cursor, Warp, Explorer…
const SEED_VERSION = 2;
// never something to open from a phrase: local files and scripts through a "link"
const BAD_SCHEMES = /^(?:file|javascript|vbscript|data|ms-msdt|search-ms|ms-officecmd|shell)$/i;

const plainKey = (text) => String(text || '')
  .normalize('NFD')
  .replace(/\p{M}/gu, '')
  .toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, '');

// "%LOCALAPPDATA%\Discord\Update.exe" with the variables of `env` (case-insensitive, as Windows).
function expandEnv(text, env = process.env) {
  const keys = Object.keys(env || {});
  return String(text ?? '').replace(/%([^%\s]+)%/g, (all, name) => {
    const key = keys.find((k) => k.toLowerCase() === name.toLowerCase());
    return key != null && env[key] != null ? String(env[key]) : all;
  });
}

// A command line into its arguments: spaces split, "double quotes" keep spaces in.
function splitArgs(text) {
  if (Array.isArray(text)) return text.map(String).filter(Boolean);
  const out = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(String(text || ''))) !== null) out.push(m[1] ?? m[2]);
  return out;
}

// "Discord.exe" / "C:\x\Discord.exe" -> "Discord"
function processName(text) {
  const base = String(text || '').trim().split(/[\\/]/).pop();
  return base.replace(/\.exe$/i, '').trim();
}

// A URL or URI she may hand to the shell: a scheme, and not one that runs or reads local stuff.
function linkOk(target) {
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(String(target || '').trim());
  if (!m || BAD_SCHEMES.test(m[1])) return false;
  if (/^https?$/i.test(m[1])) {
    try {
      return new URL(target).hostname.includes('.');
    } catch {
      return false;
    }
  }
  return m[1].length > 1; // "C:" is a drive, not a scheme
}

// "youtube.com" -> "https://youtube.com"
function linkTarget(text) {
  const t = String(text || '').trim();
  if (!t) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(t) && !/^[a-z]:[\\/]/i.test(t)) return t;
  return `https://${t}`;
}

function cleanList(values, { max = MAX_ALIASES, map = (v) => v } = {}) {
  const list = Array.isArray(values) ? values : String(values || '').split(',');
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const value = map(String(raw ?? '').trim().slice(0, MAX_NAME));
    const key = plainKey(value);
    if (!value || !key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= max) break;
  }
  return out;
}

// One entry as she keeps it, or null when it can't be one (no name, no target, bad link).
function normalizeApp(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = String(raw.name || '').trim().slice(0, MAX_NAME);
  if (!plainKey(name)) return null;
  let type = TYPES.includes(raw.type) ? raw.type : null;
  let target = String(raw.target ?? '').trim();
  if (!type) type = /^\d+$/.test(target) ? 'steam' : (linkOk(linkTarget(target)) && !/\.(exe|lnk|bat|cmd)$/i.test(target) ? 'link' : 'program');
  if (type === 'link') target = linkTarget(target);
  if (!target) return null;
  if (type === 'steam' && !/^\d+$/.test(target)) return null;
  if (type === 'link' && !linkOk(target)) return null;
  const aliases = cleanList(raw.aliases).filter((a) => plainKey(a) !== plainKey(name));
  const windows = raw.windows === 'explorer' ? 'explorer' : null;
  let processes = windows ? [] : cleanList(raw.processes, { max: 8, map: processName });
  if (!windows && !processes.length && type === 'program' && /\.exe$/i.test(target)) {
    const exe = processName(target);
    if (!/^update$/i.test(exe)) processes = [exe]; // Discord's Update.exe is not Discord
  }
  const app = {
    name,
    aliases,
    type,
    target,
    args: Array.isArray(raw.args) ? raw.args.join(' ') : String(raw.args || '').trim(),
    processes,
    close: CLOSE_MODES.includes(raw.close) ? raw.close : 'graceful',
  };
  if (windows) app.windows = windows;
  if (typeof raw.dir === 'string' && /^[a-z]:[\\/]/i.test(raw.dir.trim())) app.dir = raw.dir.trim();
  if (typeof raw.title === 'string' && raw.title.trim()) app.title = raw.title.trim().slice(0, 80);
  return app;
}

// The whole table: bad entries out, one entry per name (the first one wins).
function cleanApps(list) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const app = normalizeApp(raw);
    if (!app || seen.has(plainKey(app.name))) continue;
    seen.add(plainKey(app.name));
    out.push(app);
  }
  return out;
}

// Every name an entry answers to, as keys.
function appKeys(app) {
  return [app.name, ...(app.aliases || [])].map(plainKey).filter(Boolean);
}

// Her first-run table: the candidates added to what is there, never over it. A candidate whose
// name (or alias) is already some entry's name or alias is left out: yours stays as you made it.
function seedApps(existing, candidates) {
  const list = cleanApps(existing);
  const taken = new Set(list.flatMap(appKeys));
  const added = [];
  for (const raw of candidates || []) {
    const app = normalizeApp(raw);
    if (!app) continue;
    if (taken.has(plainKey(app.name))) continue;
    // an alias someone else already has is dropped from the newcomer, not from them
    app.aliases = app.aliases.filter((a) => !taken.has(plainKey(a)));
    for (const k of appKeys(app)) taken.add(k);
    list.push(app);
    added.push(app.name);
  }
  return { list, added };
}

// How far a table's seeding got: true (before versions) is 1.
function seededVersion(seeded) {
  if (seeded === true) return 1;
  const n = Number(seeded);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

// The candidates a table seeded up to `version` hasn't been offered yet.
function newCandidates(candidates, version) {
  return (candidates || []).filter((c) => (c.since || 1) > version);
}

// What can be seeded on this PC. `exists(path)` checks a path; `env` expands %VARS%;
// `found` has what main.js looked up (steamExe, namidaExe, browser { name, exe }, shortcuts:
// Start menu shortcut name -> its target). Each candidate says since which seed version it is.
function defaultCandidates({ env = process.env, exists = () => false, found = {} } = {}) {
  const has = (p) => Boolean(p) && exists(expandEnv(p, env));
  const first = (...paths) => paths.find(has) || null;
  const shortcut = (...names) => names.map((n) => found.shortcuts?.[n]).find(has) || null;
  const out = [];
  if (has('%LOCALAPPDATA%\\Discord\\Update.exe')) {
    out.push({
      name: 'Discord', aliases: ['discor', 'discordia'], type: 'program',
      target: '%LOCALAPPDATA%\\Discord\\Update.exe', args: '--processStart Discord.exe',
      processes: ['Discord'], close: 'graceful',
    });
  }
  if (has('%APPDATA%\\Spotify\\Spotify.exe')) {
    out.push({
      name: 'Spotify', aliases: ['spoti', 'espotifai', 'espotify'], type: 'program',
      target: '%APPDATA%\\Spotify\\Spotify.exe', processes: ['Spotify'], close: 'graceful',
    });
  } else if (has('%LOCALAPPDATA%\\Microsoft\\WindowsApps\\Spotify.exe')) {
    // the Store one: its own URI opens it, wherever the Store put it
    out.push({
      name: 'Spotify', aliases: ['spoti', 'espotifai', 'espotify'], type: 'link',
      target: 'spotify:', processes: ['Spotify'], close: 'graceful',
    });
  }
  if (found.namidaExe && has(found.namidaExe)) {
    out.push({ name: 'Namida', aliases: [], type: 'program', target: found.namidaExe, processes: ['namida'], close: 'graceful' });
  }
  const steam = [found.steamExe, '%ProgramFiles(x86)%\\Steam\\steam.exe', '%ProgramFiles%\\Steam\\steam.exe'].find(has);
  if (steam) {
    out.push({ name: 'Steam', aliases: ['estim', 'stim'], type: 'program', target: path.win32.normalize(steam), processes: ['steam'], close: 'graceful' });
  }
  if (found.browser?.exe && has(found.browser.exe)) {
    out.push({
      name: found.browser.name || 'Navegador',
      aliases: ['navegador', 'browser', 'internet', ...(found.browser.aliases || [])],
      type: 'program', target: found.browser.exe, processes: [processName(found.browser.exe)], close: 'ask',
    });
  }
  out.push({ name: 'YouTube', aliases: ['yutub', 'youtub', 'you tube', 'yutu'], type: 'link', target: 'https://www.youtube.com' });
  out.push({ name: 'Google', aliases: ['gugel', 'buscador'], type: 'link', target: 'https://www.google.com' });

  // seed 2 (Paso 4D)
  const grok = shortcut('Grok', 'Grok Bot') || first('%LOCALAPPDATA%\\Programs\\Grok\\Grok.exe', '%LOCALAPPDATA%\\Programs\\Grok Bot\\Grok Bot.exe');
  out.push(grok
    ? { since: 2, name: 'Grok', aliases: ['grok bot', 'grock', 'grook'], type: 'program', target: path.win32.normalize(grok), close: 'ask' }
    : { since: 2, name: 'Grok', aliases: ['grock', 'grook'], type: 'link', target: 'https://grok.com' });
  const cursor = shortcut('Cursor') || first('%LOCALAPPDATA%\\Programs\\cursor\\Cursor.exe');
  if (cursor) out.push({ since: 2, name: 'Cursor', aliases: ['corsor', 'kursor'], type: 'program', target: path.win32.normalize(cursor), close: 'graceful' });
  const warp = shortcut('Warp') || first('%LOCALAPPDATA%\\Programs\\Warp\\warp.exe', '%ProgramFiles%\\Warp\\warp.exe');
  if (warp) out.push({ since: 2, name: 'Warp', aliases: ['guarp', 'uarp', 'terminal'], type: 'program', target: path.win32.normalize(warp), close: 'graceful' });
  // explorer.exe is Windows itself: she opens a window, and closes only its windows
  out.push({
    since: 2, name: 'Explorador de archivos', aliases: ['explorador', 'archivos', 'el explorador', 'explorer', 'file explorer', 'mis archivos'],
    type: 'program', target: '%WINDIR%\\explorer.exe', windows: 'explorer', close: 'graceful',
  });
  const notion = shortcut('Notion') || first('%LOCALAPPDATA%\\Programs\\Notion\\Notion.exe');
  if (notion) out.push({ since: 2, name: 'Notion', aliases: ['nocion', 'noshon', 'notion app'], type: 'program', target: path.win32.normalize(notion), close: 'graceful' });
  const epic = shortcut('Epic Games Launcher') || first(
    '%ProgramFiles(x86)%\\Epic Games\\Launcher\\Portal\\Binaries\\Win64\\EpicGamesLauncher.exe',
    '%ProgramFiles(x86)%\\Epic Games\\Launcher\\Portal\\Binaries\\Win32\\EpicGamesLauncher.exe',
    '%ProgramFiles%\\Epic Games\\Launcher\\Portal\\Binaries\\Win64\\EpicGamesLauncher.exe',
  );
  if (epic) out.push({ since: 2, name: 'Epic Games', aliases: ['epic', 'epic games launcher', 'epic launcher', 'epik'], type: 'program', target: path.win32.normalize(epic), close: 'graceful' });
  return out;
}

// The browser's name from its exe ("…\Opera GX\opera.exe" -> Opera GX).
function browserName(exe) {
  const p = String(exe || '').toLowerCase();
  if (p.includes('opera gx')) return { name: 'Opera GX', aliases: ['opera'] };
  if (p.endsWith('opera.exe') || p.endsWith('launcher.exe')) return { name: 'Opera', aliases: [] };
  if (p.endsWith('chrome.exe')) return { name: 'Chrome', aliases: ['google chrome'] };
  if (p.endsWith('msedge.exe')) return { name: 'Edge', aliases: ['microsoft edge'] };
  if (p.endsWith('firefox.exe')) return { name: 'Firefox', aliases: ['mozilla'] };
  if (p.endsWith('brave.exe')) return { name: 'Brave', aliases: [] };
  if (p.endsWith('vivaldi.exe')) return { name: 'Vivaldi', aliases: [] };
  return { name: 'Navegador', aliases: [] };
}

// The exe out of a shell open command: "\"C:\…\opera.exe\" -noautoupdate -- \"%1\""
function exeFromCommand(command) {
  const t = String(command || '').trim();
  const m = /^"([^"]+\.exe)"/i.exec(t) || /^(\S+\.exe)/i.exec(t);
  return m ? m[1] : null;
}

const TYPE_LABEL = { program: 'programa', steam: 'juego de Steam', link: 'enlace' };
const CLOSE_LABEL = { graceful: 'con cuidado', force: 'a la fuerza', ask: 'preguntando' };

module.exports = {
  TYPES, CLOSE_MODES, TYPE_LABEL, CLOSE_LABEL, SEED_VERSION, seededVersion, newCandidates,
  plainKey, expandEnv, splitArgs, processName, linkOk, linkTarget,
  normalizeApp, cleanApps, appKeys, seedApps, defaultCandidates, browserName, exeFromCommand,
};

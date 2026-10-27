'use strict';

// What is installed on this PC (Paso 4D): games from Steam, Epic and GOG, and the Start menu's
// programs. Only what is really there: Steam games fully installed, Epic installs whose folder
// exists, GOG games whose exe exists, Start menu shortcuts minus uninstallers, help and readmes.
//
// Everything that touches the PC comes in as `deps` (the tests use a temp folder and fakes):
//   readShortcut(file)  { target, args } of a .lnk, or null
//   regQuery(key)       `reg query <key> /s` output ('' when the key isn't there)
//   regValue(key, name) one registry value, or null
//   env                 the environment (%ProgramData%, %APPDATA%…)
//
// Found items keep their own shape, made into her app entries by mergeApps():
//   { name, source: 'steam' | 'epic' | 'gog' | 'start', type, target, args, dir, exe, processes, title }

const fsp = require('node:fs/promises');
const path = require('node:path');
const { plainKey, normalizeApp, appKeys, processName, linkOk } = require('./apps-config');

const SCAN_VERSION = 1;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const SOURCES = ['steam', 'epic', 'gog', 'start'];
const SOURCE_LABEL = { steam: 'Steam', epic: 'Epic', gog: 'GOG', start: 'Inicio' };

// Steam: tools and runtimes that are not games
const STEAM_SKIP_IDS = new Set(['228980', '1070560', '1391110', '1628350', '250820', '1493710', '1826330', '2180100']);
const STEAM_SKIP = /redistributable|steamworks|\bproton\b|steamvr|steam linux runtime|dedicated server|\bsdk\b|soundtrack|\bbenchmark\b/i;
// Start menu: what is not something to open
const START_SKIP = /uninstall|desinstal|\bunins|\bhelp\b|ayuda|readme|l[eé]eme|\bmanuals?\b|documentation|documentaci[oó]n|\bdocs?\b|web ?site|sitio web|release notes|notas de la versi[oó]n|\bfaq\b|frequently asked|report a problem|\blicen[cs]e\b|licencia|changelog|what'?s new|support center|centro de soporte|telemetr|error and usage|\bsamples?\b/i;
const START_SKIP_DIRS = /^(?:startup|inicio|administrative tools|herramientas administrativas|windows kits|accessibility|accesibilidad|windows tools|herramientas de windows)$/i;
const UNINSTALL_EXE = /^(?:unins\w*|uninstall\w*)$/i;
// a shortcut through one of these doesn't tell her the app's own process: its window title does
const GENERIC_EXE = /^(?:update|setup|installer|launcher|msiexec|rundll32|mmc|cmd|wscript|cscript)$/i;
const MAX_START = 1000;

// -- Steam ----------------------------------------------------------------------------------

// Valve's KeyValues text (libraryfolders.vdf, appmanifest_*.acf) into plain objects.
function parseVdf(text) {
  const tokens = [];
  const re = /"((?:\\.|[^"\\])*)"|([{}])/g;
  let m;
  while ((m = re.exec(String(text || ''))) !== null) {
    tokens.push(m[2] ? { brace: m[2] } : { str: m[1].replace(/\\(.)/g, '$1') });
  }
  let i = 0;
  const block = () => {
    const out = {};
    while (i < tokens.length) {
      const t = tokens[i++];
      if (t.brace === '}') break;
      if (t.str == null) continue;
      const next = tokens[i];
      if (next?.brace === '{') {
        i++;
        out[t.str] = block();
      } else if (next?.str != null) {
        out[t.str] = next.str;
        i++;
      }
    }
    return out;
  };
  return block();
}

function steamLibraryPaths(vdfText, steamRoot) {
  const data = parseVdf(vdfText);
  const root = data.libraryfolders || data.LibraryFolders || {};
  const out = [];
  for (const value of Object.values(root)) {
    const p = typeof value === 'string' ? value : value?.path;
    if (p && !out.some((o) => o.toLowerCase() === p.toLowerCase())) out.push(p);
  }
  if (steamRoot && !out.some((o) => o.toLowerCase() === steamRoot.toLowerCase())) out.unshift(steamRoot);
  return out;
}

function steamGame(acfText) {
  const state = parseVdf(acfText).AppState;
  if (!state?.appid || !state.name) return null;
  const flags = Number(state.StateFlags) || 0;
  return { appid: String(state.appid), name: state.name, installdir: state.installdir || '', installed: (flags & 4) === 4 };
}

async function exists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

async function scanSteam(steamRoot) {
  if (!steamRoot) return [];
  const vdf = await fsp.readFile(path.join(steamRoot, 'steamapps', 'libraryfolders.vdf'), 'utf8').catch(() => '');
  const items = [];
  const seen = new Set();
  for (const lib of steamLibraryPaths(vdf, steamRoot)) {
    const apps = path.join(lib, 'steamapps');
    const files = await fsp.readdir(apps).catch(() => []);
    for (const file of files.filter((f) => /^appmanifest_\d+\.acf$/i.test(f))) {
      const game = steamGame(await fsp.readFile(path.join(apps, file), 'utf8').catch(() => ''));
      if (!game?.installed || seen.has(game.appid)) continue;
      if (STEAM_SKIP_IDS.has(game.appid) || STEAM_SKIP.test(game.name)) continue;
      const dir = game.installdir ? path.join(apps, 'common', game.installdir) : '';
      if (!dir || !(await exists(dir))) continue;
      seen.add(game.appid);
      items.push({ name: game.name, source: 'steam', type: 'steam', target: game.appid, dir });
    }
  }
  return items;
}

// -- Epic -----------------------------------------------------------------------------------

async function scanEpic(manifestDir) {
  const files = await fsp.readdir(manifestDir).catch(() => []);
  const items = [];
  for (const file of files.filter((f) => /\.item$/i.test(f))) {
    let m;
    try {
      m = JSON.parse(await fsp.readFile(path.join(manifestDir, file), 'utf8'));
    } catch {
      continue;
    }
    const cats = (m.AppCategories || []).map((c) => String(c).toLowerCase());
    if (!m.DisplayName || !m.AppName || !m.LaunchExecutable || cats.includes('hidden') || m.bIsIncompleteInstall) continue;
    if (cats.length && !cats.includes('games') && !cats.includes('applications')) continue;
    if (!m.InstallLocation || !(await exists(m.InstallLocation))) continue;
    // what the launcher's own shortcuts use: namespace:item:app, else the app name
    const id = m.CatalogNamespace && m.CatalogItemId ? `${m.CatalogNamespace}:${m.CatalogItemId}:${m.AppName}` : m.AppName;
    items.push({
      name: m.DisplayName,
      source: 'epic',
      type: 'link',
      target: `com.epicgames.launcher://apps/${encodeURIComponent(id)}?action=launch&silent=true`,
      dir: m.InstallLocation,
    });
  }
  return items;
}

// -- GOG ------------------------------------------------------------------------------------

// `reg query … /s` output: [{ key, values: { name: data } }]
function parseRegQuery(text) {
  const out = [];
  let current = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    if (/^HKEY_/i.test(line)) {
      current = { key: line.trim(), values: {} };
      out.push(current);
      continue;
    }
    const m = /^\s{2,}(.+?)\s{2,}REG_\w+\s{2,}(.*)$/.exec(line) || /^\s{2,}(.+?)\s{2,}REG_\w+\s*$/.exec(line);
    if (current && m) current.values[m[1].trim()] = (m[2] ?? '').trim();
  }
  return out;
}

async function scanGog(regText) {
  const items = [];
  for (const { values } of parseRegQuery(regText)) {
    const name = values.gameName || values.GAMENAME;
    const exe = values.exe || values.EXE;
    if (!name || !exe || !(await exists(exe))) continue;
    items.push({
      name,
      source: 'gog',
      type: 'program',
      target: exe,
      args: values.launchParam || '',
      dir: values.path || path.win32.dirname(exe),
      exe,
    });
  }
  return items;
}

// -- Start menu -----------------------------------------------------------------------------

function readUrlFile(text) {
  const m = /^URL=(.+)$/im.exec(String(text || ''));
  return m ? m[1].trim() : null;
}

async function walk(dir, depth, out) {
  if (depth < 0 || out.length >= MAX_START) return;
  const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!START_SKIP_DIRS.test(e.name)) await walk(full, depth - 1, out);
    } else if (/\.(lnk|url)$/i.test(e.name)) {
      out.push(full);
    }
    if (out.length >= MAX_START) return;
  }
}

async function scanStartMenu(dirs, { readShortcut = () => null, isProtected = () => false } = {}) {
  const files = [];
  for (const dir of dirs) await walk(dir, 4, files);
  const items = [];
  for (const file of files) {
    const name = path.basename(file).replace(/\.(lnk|url)$/i, '').trim();
    if (!plainKey(name) || START_SKIP.test(name) || /^capri\b/i.test(name)) continue;
    if (/\.url$/i.test(file)) {
      // Steam's and Epic's own .url files are covered by their scans (and outlive the game)
      const url = readUrlFile(await fsp.readFile(file, 'utf8').catch(() => ''));
      if (!url || /^(?:https?|steam|com\.epicgames\.launcher):/i.test(url) || !linkOk(url)) continue;
      items.push({ name, source: 'start', type: 'link', target: url });
      continue;
    }
    const link = readShortcut(file);
    // a shortcut to a document (help files, readmes) is not an app
    if (/\.(?:chm|pdf|txt|rtf|md|html?|url)$/i.test(link?.target || '')) continue;
    const exe = link?.target && /\.exe$/i.test(link.target) ? link.target : null;
    let proc = exe ? processName(exe) : '';
    if (proc && UNINSTALL_EXE.test(proc)) continue;
    if (GENERIC_EXE.test(proc) || isProtected(proc)) proc = '';
    items.push({
      name,
      source: 'start',
      type: 'program',
      target: file, // the shortcut itself: its arguments and working folder come along
      exe: exe || undefined,
      processes: proc ? [proc] : [],
      title: proc ? undefined : name, // nothing else to tell its window by
    });
  }
  return items;
}

// -- all of it ------------------------------------------------------------------------------

// Paths the scan reads, from the environment and the registry.
async function scanPlaces({ env = process.env, regValue = async () => null } = {}) {
  const programData = env.ProgramData || env.PROGRAMDATA || 'C:\\ProgramData';
  const appData = env.APPDATA || '';
  let steamRoot = await regValue('HKCU\\Software\\Valve\\Steam', 'SteamPath');
  if (steamRoot) steamRoot = path.win32.normalize(steamRoot);
  return {
    steamRoot,
    epicManifests: path.join(programData, 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests'),
    startMenus: [
      path.join(programData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
      appData && path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    ].filter(Boolean),
  };
}

// One name per item, games first: a Start menu shortcut to a game Steam already has is left out.
function dedupe(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = plainKey(item.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

async function scanAll({ places, regQuery = async () => '', readShortcut, isProtected, now = Date.now } = {}) {
  const started = now();
  const settle = (p) => p.catch(() => []);
  const [steam, epic, gog, start] = await Promise.all([
    settle(scanSteam(places.steamRoot)),
    settle(scanEpic(places.epicManifests)),
    settle(regQuery('HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games').then(scanGog)),
    settle(scanStartMenu(places.startMenus, { readShortcut, isProtected })),
  ]);
  const items = dedupe([...steam, ...epic, ...gog, ...start]);
  const counts = Object.fromEntries(SOURCES.map((s) => [s, items.filter((i) => i.source === s).length]));
  return { version: SCAN_VERSION, at: now(), ms: now() - started, counts, items };
}

// The cache is too old (or not there, or from another version): scan again.
function isStale(cache, now = Date.now(), maxAge = MAX_AGE_MS) {
  if (!cache || cache.version !== SCAN_VERSION || !Array.isArray(cache.items)) return true;
  const at = Number(cache.at);
  if (!Number.isFinite(at) || at > now + 60 * 60 * 1000) return true;
  return now - at > maxAge;
}

// The found item as one of her entries (scanned games ask before closing), or null.
function scannedApp(item) {
  const app = normalizeApp({ ...item, aliases: [], close: 'ask' });
  if (!app) return null;
  app.source = SOURCES.includes(item.source) ? item.source : 'start';
  return app;
}

// What "abre X" searches: your table first, then what was found that isn't already in it
// (same name or alias, same Steam id, same exe or same target).
function mergeApps(table, scanned) {
  const list = [...(table || [])];
  const keys = new Set(list.flatMap(appKeys));
  const targets = new Set(list.map((a) => String(a.target || '').toLowerCase()).filter(Boolean));
  const exes = new Set(list.filter((a) => /\.exe$/i.test(a.target || '')).map((a) => processName(a.target).toLowerCase()));
  for (const item of scanned || []) {
    const app = scannedApp(item);
    if (!app) continue;
    if (keys.has(plainKey(app.name)) || targets.has(String(app.target).toLowerCase())) continue;
    if (item.exe && exes.has(processName(item.exe).toLowerCase())) continue;
    keys.add(plainKey(app.name));
    list.push(app);
  }
  return list;
}

module.exports = {
  SCAN_VERSION, MAX_AGE_MS, SOURCES, SOURCE_LABEL,
  parseVdf, steamLibraryPaths, steamGame, scanSteam, scanEpic, parseRegQuery, scanGog, readUrlFile, scanStartMenu,
  scanPlaces, scanAll, isStale, scannedApp, mergeApps,
};

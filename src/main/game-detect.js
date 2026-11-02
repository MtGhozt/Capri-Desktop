'use strict';

// What counts as "a game took the screen": a fullscreen foreground window whose exe lives
// where games are installed, or an app the user listed in config.json -> gaming.apps.
// Entries may be strings (allow) or { match, ignore: true } / "!exe" (never treat as a game).

const GAME_DIRS = [
  '\\steamapps\\common\\',
  '\\epic games\\',
  '\\gog games\\',
  '\\gog galaxy\\games\\',
  '\\xboxgames\\',
  '\\windowsapps\\',
  '\\ea games\\',
  '\\electronic arts\\',
  '\\riot games\\',
  '\\ubisoft game launcher\\games\\',
  '\\ubisoft\\games\\',
  '\\itch.io\\',
  '\\itch\\apps\\',
];

const NEVER_GAME_EXES = new Set(['capri.exe', 'electron.exe', 'recordly.exe']);

function normalizePath(value) {
  return String(value ?? '').trim().replace(/\//g, '\\').toLowerCase();
}

function normalizeAppEntry(app) {
  if (app == null) return null;
  if (typeof app === 'string') {
    const raw = String(app).trim();
    if (!raw) return null;
    if (raw.startsWith('!')) {
      const match = raw.slice(1).trim();
      return match ? { match, ignore: true } : null;
    }
    return { match: raw, ignore: false };
  }
  const match = String(app.match || app.path || app.exe || '').trim();
  if (!match) return null;
  return { match, ignore: Boolean(app.ignore) };
}

function entryMatches(entry, exePath) {
  const parsed = normalizeAppEntry(entry);
  if (!parsed) return false;
  const exe = normalizePath(exePath);
  const needle = normalizePath(parsed.match);
  if (!exe || !needle) return false;
  const name = exe.split('\\').pop();
  return name === needle || exe.endsWith(needle) || exe.includes(needle);
}

function isIgnoredExe(exePath, apps = []) {
  return (Array.isArray(apps) ? apps : []).some((app) => {
    const parsed = normalizeAppEntry(app);
    return parsed?.ignore && entryMatches(parsed, exePath);
  });
}

function isAllowlistedExe(exePath, apps = []) {
  return (Array.isArray(apps) ? apps : []).some((app) => {
    const parsed = normalizeAppEntry(app);
    return parsed && !parsed.ignore && entryMatches(parsed, exePath);
  });
}

function isGameExe(exePath, apps = []) {
  const exe = normalizePath(exePath);
  if (!exe) return false;
  if (NEVER_GAME_EXES.has(exe.split('\\').pop())) return false;
  if (isIgnoredExe(exe, apps)) return false;
  if (GAME_DIRS.some((dir) => exe.includes(dir))) return true;
  return isAllowlistedExe(exe, apps);
}

/** The window watcher says whether the foreground window covers its monitor. */
function gameOnScreen(windows, apps = []) {
  return Boolean(windows?.fgFull) && isGameExe(windows?.fgExe, apps);
}

/** Exe basename suitable for gaming.apps (allow or ignore). */
function gameAppKey(exePath) {
  const exe = normalizePath(exePath);
  if (!exe) return '';
  return exe.split('\\').pop() || '';
}

/**
 * Editable allow/ignore list stored in gaming.apps.
 * action: 'allow' | 'ignore' | 'remove'
 */
function patchGamingApps(apps, exePath, action = 'allow') {
  const key = gameAppKey(exePath);
  if (!key) return Array.isArray(apps) ? [...apps] : [];
  const list = (Array.isArray(apps) ? apps : []).filter((app) => !entryMatches(app, exePath));
  if (action === 'remove') return list;
  if (action === 'ignore') {
    list.push({ match: key, ignore: true });
    return list;
  }
  list.push(key);
  return list;
}

module.exports = {
  GAME_DIRS,
  isGameExe,
  gameOnScreen,
  normalizePath,
  normalizeAppEntry,
  isIgnoredExe,
  gameAppKey,
  patchGamingApps,
};
